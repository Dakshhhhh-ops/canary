// npm run radar:run [-- BTC,ETH,PEPE] [--trigger=schedule]
//
// One unattended radar run: ask RYO (catalog first, then the coins), let the agents decide on practice
// trades under the published risk limits, save everything to data/radar/runs/<time>-<coins>.json and
// apply it to the paper ledger (data/radar/ledger.json). Coins with an open practice position are always
// added, so the ledger can mark them to market and close them at their stop / take-profit / expiry.
//
// Needs RYO_MCP_KEY (env, or .env.local). OPENROUTER_API_KEY is optional (the bull/bear arguments are
// written by a model when it is set, by rules otherwise; the verdict and the risk decision are rules either way).
//
// Exit codes: 0 = run saved · 3 = RYO unavailable (no key, server down, or no tool answered): NOTHING is
// written, so a scheduler has nothing to commit and the gap is visible in its log · 1 = unexpected failure.
import { appendFileSync } from "node:fs";
import { runLive } from "../../src/lib/engine/pipeline";
import { RyoClient } from "../../src/lib/engine/ryo";
import { parseLimits } from "../../src/lib/radar/limits";
import { ledgerLossToday, openSymbols, reachedRyo, readLedger, saveRun } from "../../src/lib/radar/store";

// liquid majors, plus a couple of memecoins so the desk has something to refuse
const DEFAULT_SYMBOLS = ["BTC", "ETH", "SOL", "XRP", "PEPE", "WIF"];

for (const f of [".env.local", ".env"])
  try {
    process.loadEnvFile(f);
  } catch {
    /* not there: fine */
  }

const summary = (line: string) => {
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
};

async function main() {
  const argv = process.argv.slice(2);
  const flag = argv.find((a) => a.startsWith("--trigger="))?.slice(10);
  const arg = argv.filter((a) => !a.startsWith("--")).join(",");
  const asked = arg.split(/[,\s]+/).map((s) => s.replace(/[^A-Za-z0-9]/g, "").toUpperCase()).filter(Boolean);
  const held = await openSymbols();
  const symbols = [...new Set([...(asked.length ? asked : DEFAULT_SYMBOLS), ...held])].slice(0, 12);
  // limits: the published defaults, or RADAR_LIMITS='{"maxPositionUsd":500,...}' (validated and clamped)
  const parsed = parseLimits(process.env.RADAR_LIMITS ? (JSON.parse(process.env.RADAR_LIMITS) as Record<string, unknown>) : {});
  if (parsed.errors.length) throw new Error(`RADAR_LIMITS: ${parsed.errors.join("; ")}`);
  parsed.notes.forEach((n) => console.log(`note: ${n}`));
  const trigger = (flag || process.env.RADAR_TRIGGER || "").replace(/[^a-z-]/g, "") || (process.env.GITHUB_EVENT_NAME === "schedule" ? "schedule" : process.env.GITHUB_ACTIONS ? "manual" : "local");

  const ryo = new RyoClient();
  const health = await ryo.health();
  console.log(`RYO health: ${health.ok ? "ok" : `not ok (${health.error ?? JSON.stringify(health.body)})`} · key ${ryo.configured ? "present" : "MISSING"}`);
  if (!ryo.configured) {
    summary("### Radar: skipped\nRYO_MCP_KEY is not set, so no market data was fetched and nothing was saved.");
    return 3;
  }

  const lossTodayUsd = await ledgerLossToday();
  console.log(`Looking at ${symbols.join(", ")}${held.length ? ` (open positions: ${held.join(", ")})` : ""}; realised loss today ${lossTodayUsd}`);
  const run = await runLive(symbols, {
    ryo,
    llm: "auto",
    deep: true,
    limits: parsed.limits,
    dip: { stopPct: parsed.stopPct },
    lossTodayUsd,
    onStep: (e) => console.log(`  [${e.entry.seq}] ${e.step.padEnd(9)} ${e.entry.summary}`),
  });

  if (!reachedRyo(run)) {
    summary(`### Radar: RYO unavailable\nNo RYO tool answered (${run.gaps.slice(0, 3).map((g) => g.reason).join(" · ")}). Nothing was saved and open positions were not marked.`);
    return 3;
  }

  const saved = await saveRun({ run, rawRyo: ryo.log, trigger });
  const ledger = await readLedger();
  const accepted = run.perSymbol.filter((p) => p.trade.decision === "accepted").map((p) => p.symbol);
  summary(
    [
      `### Radar run ${run.startedAt}`,
      `- saved: data/radar/runs/${saved.file}`,
      `- RYO: ${run.ryo.calls.filter((c) => c.ok).length}/${run.ryo.calls.length} calls answered · catalog: ${run.catalog.source} (${run.catalog.tools.length} tools)`,
      `- practice trades accepted: ${accepted.join(", ") || "none"} · refused: ${run.perSymbol.length - accepted.length}`,
      `- gaps recorded: ${run.gaps.length} · trail head ${run.headHash.slice(0, 16)}… (${run.trail.length} steps, ${run.trailOk ? "verified" : "BROKEN"})`,
      ledger
        ? `- ledger: ${ledger.state.positions.length} open, ${ledger.state.closed.length} closed, realised ${ledger.state.totals.realisedUsd} USD, unrealised ${ledger.state.totals.unrealisedUsd} USD (+${saved.ledger?.added ?? 0} entries)`
        : "- ledger: not updated",
    ].join("\n"),
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
