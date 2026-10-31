import { caseIdOf, snapshotFor, watchList } from "@/lib/snapshot";
import { registryStatus } from "@/lib/registry";
import { radarCaseId } from "@/lib/watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// What the blockchain says about a case right now, next to what the agents concluded.
//   ?case=emax   a documented case file
//   ?radar=PEPE  a coin from the live radar (case id keccak256("canary:radar:PEPE")); `watched` says whether
//                it is on canary-watch's list today, and why not if it isn't
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const radar = q.get("radar");
  if (radar !== null) {
    const symbol = radar.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12);
    if (!symbol) return Response.json({ error: "Give a coin symbol, like ?radar=PEPE." }, { status: 400 });
    const list = await watchList();
    const entry = list.cases.find((c) => c.source === "radar" && c.symbol === symbol) ?? null;
    const skipped = list.skipped.find((s) => s.symbol === symbol) ?? null;
    const chain = await registryStatus(radarCaseId(symbol));
    return Response.json({ symbol, caseId: radarCaseId(symbol), watched: Boolean(entry), snapshot: entry, notWatchedBecause: entry ? null : (skipped?.reason ?? "no saved real radar run mentions this coin"), chain }, { headers: { "cache-control": "no-store" } });
  }
  const slug = q.get("case") ?? "emax";
  const snapshot = await snapshotFor(slug);
  if (!snapshot) return Response.json({ error: "No such case." }, { status: 404 });
  const chain = await registryStatus(caseIdOf(slug));
  return Response.json({ snapshot, chain }, { headers: { "cache-control": "no-store" } });
}
