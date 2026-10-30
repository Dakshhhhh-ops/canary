import { caseIdOf } from "@/lib/snapshot";
import { claimAnchoredAt, registryConfig } from "@/lib/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/registry/claim?case=emax&hash=<64 hex>  → was this evidence fingerprint anchored on-chain, and when?
export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get("case") ?? "emax";
  const hash = (url.searchParams.get("hash") ?? "").replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash) || !/^[a-z0-9-]+$/.test(slug)) return Response.json({ error: "Bad case or hash." }, { status: 400 });
  const cfg = registryConfig();
  if (!cfg) return Response.json({ configured: false });
  try {
    const at = await claimAnchoredAt(caseIdOf(slug), `0x${hash}`);
    return Response.json({ configured: true, anchored: Boolean(at), at, contract: cfg.address });
  } catch {
    return Response.json({ configured: true, anchored: null, error: "Couldn't reach the blockchain right now." });
  }
}
