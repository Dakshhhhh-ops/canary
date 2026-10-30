import { liveRunStream } from "@/lib/engine/pipeline";
import { RyoClient } from "@/lib/engine/ryo";
import { clientIp, makeLimiter } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limited = makeLimiter(Number(process.env.RADAR_RUNS_PER_10_MIN) || 10);

// GET /api/radar?symbols=PEPE,WIF  → live run over RYO market tools, streamed as server-sent events.
// GET /api/radar?health=1          → is RYO reachable, and is a key configured?
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ryo = new RyoClient();
  if (url.searchParams.get("health")) {
    const h = await ryo.health();
    return Response.json({ reachable: h.ok, configured: Boolean(process.env.RYO_MCP_KEY), server: h.body ?? null, error: h.error ?? null }, { headers: { "cache-control": "no-store" } });
  }
  if (limited(clientIp(req))) return Response.json({ error: "Too many live runs from here. Try again in a few minutes." }, { status: 429 });
  const symbols = (url.searchParams.get("symbols") ?? "")
    .split(/[,\s]+/)
    .map((s) => s.replace(/[^A-Za-z0-9]/g, "").toUpperCase())
    .filter(Boolean)
    .slice(0, 5);
  if (!symbols.length) return Response.json({ error: "Give one to five token symbols, like PEPE,WIF." }, { status: 400 });
  return new Response(liveRunStream(symbols, { ryo, llm: "auto" }), {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" },
  });
}
