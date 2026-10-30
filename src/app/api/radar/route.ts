import { runLive, sseStream } from "@/lib/engine/pipeline";
import { RyoClient } from "@/lib/engine/ryo";
import { parseLimits } from "@/lib/radar/limits";
import { HANKO_SYMBOLS, hankoReplayClient } from "@/lib/radar/replay";
import { ledgerLossToday, listRuns, readLedger, readRun, reachedRyo, saveRun } from "@/lib/radar/store";
import { clientIp, makeLimiter } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limited = makeLimiter(Number(process.env.RADAR_RUNS_PER_10_MIN) || 10);
const noStore = { "cache-control": "no-store" };
const sseHeaders = { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" };

// GET /api/radar?symbols=PEPE,WIF[&maxPositionUsd=..&minLiquidityUsd=..&maxTop10HolderPct=..&stopPct=..&dailyLossLimitUsd=..][&save=1]
//      → live run over RYO's tools, streamed as server-sent events. save=1 keeps the run in data/radar/runs and updates the paper ledger.
// GET /api/radar?replay=hanko[&limits…] → the same agents on hanko's PUBLISHED FIXTURES (recorded sample, never live, never saved)
// GET /api/radar?health=1   → is RYO reachable, and is a key configured?
// GET /api/radar?runs=1     → saved runs, newest first
// GET /api/radar?run=<file> → one saved run (trail + raw RYO replies + catalog)
// GET /api/radar?ledger=1   → the paper ledger and its trail
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams;
  if (q.get("health")) {
    const h = await new RyoClient().health();
    return Response.json({ reachable: h.ok, configured: Boolean(process.env.RYO_MCP_KEY), server: h.body ?? null, error: h.error ?? null }, { headers: noStore });
  }
  if (q.get("runs")) return Response.json(await listRuns(), { headers: noStore });
  if (q.has("run")) {
    const s = await readRun(q.get("run") ?? "");
    return s ? Response.json(s, { headers: noStore }) : Response.json({ error: "No saved run by that name." }, { status: 404 });
  }
  if (q.get("ledger")) return Response.json(await readLedger(), { headers: noStore });

  const parsed = parseLimits(q);
  if (parsed.errors.length) return Response.json({ error: `Risk limits: ${parsed.errors.join("; ")}.` }, { status: 400 });
  const replay = q.get("replay");
  if (replay !== null && replay !== "hanko") return Response.json({ error: "The only recorded sample is replay=hanko." }, { status: 400 });

  const symbols = [...new Set((q.get("symbols") ?? "").split(/[,\s]+/).map((s) => s.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12)).filter(Boolean))].slice(0, 5);
  if (replay === null && !symbols.length) return Response.json({ error: "Give one to five token symbols, like PEPE,WIF." }, { status: 400 });

  if (limited(clientIp(req))) return Response.json({ error: "Too many runs from here. Try again in a few minutes." }, { status: 429 });

  if (replay === "hanko")
    return new Response(
      sseStream((onStep) =>
        runLive(HANKO_SYMBOLS, { ryo: hankoReplayClient(), llm: null, limits: parsed.limits, dip: { stopPct: parsed.stopPct }, mode: "recorded-fixture", onStep }).then((run) => ({ ...run, notes: parsed.notes, saved: null })),
      ),
      { headers: sseHeaders },
    );

  const wantSave = q.get("save") === "1" && process.env.RADAR_UI_SAVE !== "0";
  return new Response(
    sseStream(async (onStep) => {
      const ryo = new RyoClient();
      const lossTodayUsd = await ledgerLossToday().catch(() => 0);
      const run = await runLive(symbols, { ryo, llm: "auto", limits: parsed.limits, dip: { stopPct: parsed.stopPct }, lossTodayUsd, onStep });
      let saved: { file: string; ledgerAdded: number } | { error: string } | null = null;
      if (wantSave)
        saved = reachedRyo(run)
          ? await saveRun({ run, rawRyo: ryo.log, trigger: "ui" })
              .then((r) => ({ file: r.file, ledgerAdded: r.ledger?.added ?? 0 }))
              .catch((e: unknown) => ({ error: e instanceof Error ? e.message : "could not save" }))
          : { error: "Not saved: RYO did not answer, so there is nothing real to keep." };
      return { ...run, notes: parsed.notes, saved };
    }),
    { headers: sseHeaders },
  );
}
