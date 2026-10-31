import { snapshotFor, watchList } from "@/lib/snapshot";
import { watchTokenOk } from "@/lib/watch";

export const runtime = "nodejs";

// Read by the Chainlink CRE workflow (cre/canary-watch). Same JSON for every node: no clock, no randomness.
//   ?case=emax  one documented case (public; the original contract, unchanged)
//   ?list=1     every watched case: the case files plus the radar coins that qualify (src/lib/watch.ts).
//               If WATCH_TOKEN is set, this needs "Authorization: Bearer <WATCH_TOKEN>" (the workflow reads
//               it from a CRE secret); without WATCH_TOKEN it is public.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  if (q.has("list")) {
    const token = process.env.WATCH_TOKEN;
    if (!watchTokenOk(req.headers.get("authorization"), token))
      return Response.json({ error: "This watch list needs the Chainlink workflow's token (Authorization: Bearer …)." }, { status: 401, headers: { "www-authenticate": "Bearer" } });
    const list = await watchList();
    return Response.json(list, { headers: { "cache-control": token ? "private, no-store" : "public, max-age=60" } });
  }
  const slug = q.get("case") ?? "emax";
  const snap = await snapshotFor(slug);
  if (!snap) return Response.json({ error: "No such case." }, { status: 404 });
  return Response.json(snap, { headers: { "cache-control": "public, max-age=60" } });
}
