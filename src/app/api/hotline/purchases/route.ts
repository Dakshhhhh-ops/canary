// POST { address, caseSlug? | cases? } -> the wallet's buys and sells of a case token, read from Ethereum (see src/lib/hotline/purchases.ts).
// `cases` (a list of case slugs) checks each case's pool in turn and answers with the first one the wallet bought from:
// the hotline uses it when the caller doesn't remember the coin. Public addresses only; nothing is stored or logged.
import { NextResponse } from "next/server";
import { loadCase } from "@/lib/cases";
import { CASE_SLUGS } from "@/lib/caseIndex";
import { toHotlineCase, type HotlineCase } from "@/lib/hotline/caseFacts";
import { checkAddress, findPurchases, type PurchaseReport } from "@/lib/hotline/purchases";
import emaxSnapshot from "@/lib/hotline/demoSnapshot.json";
import saitamaSnapshot from "@/lib/hotline/demoSnapshot.saitama.json";
import { clientIp, makeLimiter } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 60;
const limited = makeLimiter(20);

/** A saved copy of a real lookup of each case's demo wallet. */
const SNAPSHOTS: Record<string, PurchaseReport> = { emax: emaxSnapshot as PurchaseReport, saitama: saitamaSnapshot as PurchaseReport };

async function lookup(address: `0x${string}`, k: HotlineCase): Promise<{ report: PurchaseReport; live: boolean }> {
  try {
    return { report: await findPurchases(address, k), live: true };
  } catch (e) {
    // The demo wallet falls back to a saved copy of a real lookup, clearly labelled, so a judge's demo never stalls.
    const snap = SNAPSHOTS[k.slug];
    if (snap && k.demoWallet && address.toLowerCase() === k.demoWallet.address.toLowerCase() && snap.address.toLowerCase() === address.toLowerCase()) {
      return { live: false, report: { ...snap, notes: [`The live blockchain node didn't answer, so this is a saved copy of the same lookup made on ${snap.checkedAt.slice(0, 10)}.`, ...snap.notes] } };
    }
    throw e;
  }
}

export async function POST(req: Request) {
  if (limited(clientIp(req))) return NextResponse.json({ ok: false, error: "Too many checks from this connection. Please wait a few minutes." }, { status: 429 });
  let body: { address?: unknown; caseSlug?: unknown; cases?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Send JSON: { address }" }, { status: 400 });
  }
  const check = checkAddress(String(body.address ?? ""));
  if (!check.ok) return NextResponse.json({ ok: false, error: check.reason }, { status: 400 });
  const asked = Array.isArray(body.cases) ? body.cases.filter((s): s is string => typeof s === "string" && CASE_SLUGS.includes(s)).slice(0, CASE_SLUGS.length) : [];
  const slugs = asked.length ? [...new Set(asked)] : [typeof body.caseSlug === "string" ? body.caseSlug : "emax"];
  let last: { report: PurchaseReport; live: boolean } | null = null;
  let failed: unknown = null;
  for (const slug of slugs) {
    const cf = await loadCase(slug);
    if (!cf) {
      if (slugs.length === 1) return NextResponse.json({ ok: false, error: "Case file not found." }, { status: 404 });
      continue;
    }
    try {
      last = await lookup(check.address, toHotlineCase(cf));
      if (last.report.purchases.length) break;
    } catch (e) {
      failed = e;
    }
  }
  // a pool that couldn't be read means "not found" can't be trusted
  if (last && (last.report.purchases.length || !failed)) return NextResponse.json({ ok: true, live: last.live, report: last.report });
  const e = failed;
  return NextResponse.json({ ok: false, error: e instanceof Error && /HTTP|RPC|network|fetch|timeout/i.test(e.message) ? "The blockchain node didn't answer. Try again in a minute." : "The check failed." }, { status: 502 });
}
