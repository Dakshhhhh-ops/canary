// POST { address } -> the wallet's buys and sells of the case token, read from Ethereum (see src/lib/hotline/purchases.ts).
// Public addresses only; nothing is stored or logged.
import { NextResponse } from "next/server";
import { loadCase } from "@/lib/cases";
import { toHotlineCase } from "@/lib/hotline/caseFacts";
import { checkAddress, findPurchases, type PurchaseReport } from "@/lib/hotline/purchases";
import demoSnapshot from "@/lib/hotline/demoSnapshot.json";
import { clientIp, makeLimiter } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 60;
const limited = makeLimiter(20);

export async function POST(req: Request) {
  if (limited(clientIp(req))) return NextResponse.json({ ok: false, error: "Too many checks from this connection. Please wait a few minutes." }, { status: 429 });
  let body: { address?: unknown; caseSlug?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Send JSON: { address }" }, { status: 400 });
  }
  const check = checkAddress(String(body.address ?? ""));
  if (!check.ok) return NextResponse.json({ ok: false, error: check.reason }, { status: 400 });
  const cf = await loadCase(typeof body.caseSlug === "string" ? body.caseSlug : "emax");
  if (!cf) return NextResponse.json({ ok: false, error: "Case file not found." }, { status: 404 });
  const k = toHotlineCase(cf);
  try {
    const report = await findPurchases(check.address, k);
    return NextResponse.json({ ok: true, live: true, report });
  } catch (e) {
    // The demo wallet falls back to a saved copy of a real lookup, clearly labelled, so a judge's demo never stalls.
    if (k.demoWallet && check.address.toLowerCase() === k.demoWallet.address.toLowerCase()) {
      const snap = demoSnapshot as PurchaseReport;
      const report: PurchaseReport = {
        ...snap,
        notes: [`The live blockchain node didn't answer, so this is a saved copy of the same lookup made on ${snap.checkedAt.slice(0, 10)}.`, ...snap.notes],
      };
      return NextResponse.json({ ok: true, live: false, report });
    }
    return NextResponse.json({ ok: false, error: e instanceof Error && /HTTP|RPC|network|fetch|timeout/i.test(e.message) ? "The blockchain node didn't answer. Try again in a minute." : "The check failed." }, { status: 502 });
  }
}
