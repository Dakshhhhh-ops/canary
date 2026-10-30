// POST { caseSlug, evidenceHash, claimantRef } -> anchors the evidence fingerprint on Sepolia, or says honestly
// that the registry isn't configured. Only hashes arrive here; nothing is logged.
import { NextResponse } from "next/server";
import { anchorClaim, validateAnchorRequest } from "@/lib/claims/anchor";
import { clientIp, makeLimiter } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 60;
const limited = makeLimiter(6);

export async function POST(req: Request) {
  if (limited(clientIp(req))) return NextResponse.json({ status: "error", message: "Too many requests. Please wait a few minutes." }, { status: 429 });
  const parsed = validateAnchorRequest(await req.json().catch(() => null));
  if (!parsed) return NextResponse.json({ status: "error", message: "Send { caseSlug, evidenceHash, claimantRef } as 0x-prefixed 32-byte hex." }, { status: 400 });
  const result = await anchorClaim(parsed);
  return NextResponse.json(result, { status: result.status === "error" ? 502 : 200 });
}
