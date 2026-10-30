import { caseIdOf, snapshotFor } from "@/lib/snapshot";
import { registryStatus } from "@/lib/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// What the blockchain says about a case right now, next to what the agents concluded.
export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("case") ?? "emax";
  const snapshot = await snapshotFor(slug);
  if (!snapshot) return Response.json({ error: "No such case." }, { status: 404 });
  const chain = await registryStatus(caseIdOf(slug));
  return Response.json({ snapshot, chain }, { headers: { "cache-control": "no-store" } });
}
