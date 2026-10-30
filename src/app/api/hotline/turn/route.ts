// POST { state?, text?, purchases? } -> { state, reply }: the same conversation engine as the web call,
// for the phone relay (voice/relay.mjs). Stateless: the caller's state travels with each request.
import { NextResponse } from "next/server";
import { loadCase } from "@/lib/cases";
import { toHotlineCase } from "@/lib/hotline/caseFacts";
import { applyPurchaseResult, respond, startCall, type HotlineState } from "@/lib/hotline/agent";
import type { PurchaseReport } from "@/lib/hotline/purchases";
import { clientIp, makeLimiter } from "@/lib/rateLimit";

export const runtime = "nodejs";
const limited = makeLimiter(200);

export async function POST(req: Request) {
  const internal = process.env.INTERNAL_TOKEN && req.headers.get("x-internal-token") === process.env.INTERNAL_TOKEN;
  if (!internal && limited(clientIp(req))) return NextResponse.json({ error: "rate limited" }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as { state?: HotlineState; text?: string; purchases?: { ok: true; report: PurchaseReport } | { ok: false; error: string } };
  const cf = await loadCase("emax");
  if (!cf) return NextResponse.json({ error: "case not found" }, { status: 500 });
  const k = toHotlineCase(cf);
  const state = body.state && body.state.v === 1 ? body.state : null;
  if (!state) return NextResponse.json(startCall(k));
  if (body.purchases) return NextResponse.json(applyPurchaseResult(state, body.purchases, k));
  return NextResponse.json(respond(state, String(body.text ?? ""), k));
}
