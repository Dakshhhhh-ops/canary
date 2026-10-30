import { loadSimulationLog, onchainSummary } from "@/lib/onchain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/onchain        → the public proof summary (registry + every tx the CRE workflow wrote), from data/onchain.json
// GET /api/onchain?log=1  → cre/SIMULATION.md, the Chainlink CRE simulator's redacted output, as plain text
export async function GET(req: Request) {
  if (new URL(req.url).searchParams.get("log")) {
    const md = loadSimulationLog();
    if (!md) return new Response("No simulation has been recorded yet.\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    return new Response(md, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  }
  return Response.json(onchainSummary(), { headers: { "cache-control": "no-store" } });
}
