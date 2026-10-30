import { snapshotFor } from "@/lib/snapshot";

export const runtime = "nodejs";

// Read by the Chainlink CRE workflow (cre/canary-watch). ?case=emax picks the case; same JSON for every node.
export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("case") ?? "emax";
  const snap = await snapshotFor(slug);
  if (!snap) return Response.json({ error: "No such case." }, { status: 404 });
  return Response.json(snap, { headers: { "cache-control": "public, max-age=60" } });
}
