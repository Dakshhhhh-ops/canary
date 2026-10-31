// Doki's hotline for Saitama buyers: the coin is recognised (from what the caller says, or from the wallet's own
// purchases), the purchase lookup runs on Saitama's pool, and the drafts cite the law of that case
// (fraud and market manipulation by the coin's own officers), never EMAX's paid-promotion facts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { allowedFacts, buildClaimPack, factGuard, guardInputs, placeFor, withPlace, type ClaimInput } from "../src/lib/claims";
import { applyPurchaseResult, consentedDocs, respond, startCall, type Turn } from "../src/lib/hotline/agent";
import { toHotlineCase, type HotlineCase } from "../src/lib/hotline/caseFacts";
import { parseCoin } from "../src/lib/hotline/parse";
import type { PurchaseReport } from "../src/lib/hotline/purchases";
import type { CaseFile } from "../src/lib/types";

const load = (slug: string) => JSON.parse(readFileSync(`data/cases/${slug}.json`, "utf8")) as CaseFile;
const emax = toHotlineCase(load("emax"));
const saitama = toHotlineCase(load("saitama"));
const CASES = [emax, saitama];
const snaps: Record<string, PurchaseReport> = {
  emax: JSON.parse(readFileSync("src/lib/hotline/demoSnapshot.json", "utf8")),
  saitama: JSON.parse(readFileSync("src/lib/hotline/demoSnapshot.saitama.json", "utf8")),
};
const SAITAMA_WALLET = "0x3dad8f9341255ceb7e129512ae790d90cec55105";
const EMAX_WALLET = "0xac85724be118b69a9aee3b03bd2af2ac0071f26a";

/** Plays a call; a wallet check answers from the saved lookup of whichever case the wallet bought. */
function call(lines: string[], cases: HotlineCase | HotlineCase[] = CASES): Turn {
  let t = startCall(cases);
  for (const l of lines) {
    t = respond(t.state, l, cases);
    if (t.reply.action?.type === "check-wallet") {
      const a = t.reply.action;
      const slugs = a.cases ?? [t.state.caseSlug];
      const hit = slugs.map((s) => snaps[s]).find((r) => r && r.address.toLowerCase() === a.address.toLowerCase());
      const report = hit ?? { ...snaps[slugs[slugs.length - 1]], address: a.address, purchases: [], sales: [] };
      t = applyPurchaseResult(t.state, { ok: true, report }, cases);
    }
  }
  return t;
}
const said = (t: Turn) => t.reply.say.join(" ");
const kaseOf = (t: Turn) => CASES.find((c) => c.slug === t.state.caseSlug)!;
const input = (t: Turn, id = "sai01"): ClaimInput => ({ id, kase: kaseOf(t), facts: t.state.facts, consents: consentedDocs(t.state), generatedAt: "2026-10-30T12:00:00.000Z", trailHead: "cd".repeat(32), origin: "https://canary.example" });

const TEXAS = ["I lost money on Saitama Inu", "Nam Tran's tweets", "November 2021", SAITAMA_WALLET, "About 1,500 dollars", "Texas", "skip", "skip", "yes", "yes", "yes", "yes"];

test("the demo wallet's saved lookup is a real Saitama purchase report", () => {
  const s = snaps.saitama;
  assert.equal(s.address.toLowerCase(), SAITAMA_WALLET);
  assert.equal(s.token.address, saitama.token.address);
  assert.equal(s.token.pair, saitama.token.pair);
  assert.equal(saitama.demoWallet?.address.toLowerCase(), SAITAMA_WALLET);
  assert.ok(load("saitama").buyersInWindow!.sample.some((x) => x.address === SAITAMA_WALLET), "the demo wallet comes from the case file's buyer sample");
  assert.ok(s.purchases.length >= 1);
  for (const p of s.purchases) assert.match(p.txHash, /^0x[0-9a-f]{64}$/);
});

test("the coin is recognised by name; EMAX is still EMAX", () => {
  for (const t of ["Saitama", "saitama inu", "I bought $SAITAMA", "the Saitama token"]) assert.equal(parseCoin(t)?.slug, "saitama", t);
  assert.equal(parseCoin("EthereumMax")?.slug, "emax");
  assert.deepEqual(parseCoin("EthereumMax"), { text: "EthereumMax (EMAX)", isCase: true, slug: "emax" });
  assert.equal(parseCoin("$SQUID")?.isCase, false);
});

test("a Saitama call: the case, its promoters, the lookup on Saitama's pool, the right documents", () => {
  let t = call(TEXAS.slice(0, 1));
  assert.equal(t.state.caseSlug, "saitama");
  assert.deepEqual(t.state.facts.coin, { text: "Saitama Inu (SAITAMA)", isCase: true, slug: "saitama" });
  assert.match(said(t), /Saitama Inu\. I know that one\./);
  assert.match(said(t), /SEC's complaint/);
  assert.ok(t.reply.suggestions.includes("Nam Tran's posts"));
  t = call(TEXAS.slice(0, 2));
  assert.deepEqual(t.state.facts.promoters?.matched, ["Nam Tran"]);
  assert.match(said(t), /The SEC's complaint quotes Nam Tran's posts/);
  assert.match(said(t), /allegation, not a ruling/);
  assert.doesNotMatch(said(t), /class-action|paid/);
  t = respond(call(TEXAS.slice(0, 3)).state, SAITAMA_WALLET, CASES);
  assert.equal(t.reply.action?.type, "check-wallet");
  assert.deepEqual(t.reply.action, { type: "check-wallet", address: "0x3DaD8f9341255Ceb7E129512aE790d90cEC55105" }); // the call's own case
  assert.match(said(t), /SAITAMA purchases/);
  t = call(TEXAS.slice(0, 4));
  assert.equal(t.reply.step, "amount");
  assert.match(said(t), /Found it\. 2 purchases of SAITAMA, from November 11, 2021 to November 13, 2021\./);
  assert.doesNotMatch(said(t), /class action/);
  t = call(TEXAS);
  assert.equal(t.reply.step, "done");
  assert.deepEqual(consentedDocs(t.state).sort(), ["ftc", "sec", "state"]);
  assert.doesNotMatch(said(t), /class action/);
});

test("Saitama drafts cite the case's own law and lawsuit, and no EMAX fact", async () => {
  const t = call(TEXAS);
  const inp = input(t);
  const pack = await buildClaimPack(inp);
  assert.equal(pack.caseSlug, "saitama");
  assert.equal(pack.headline.coin, "Saitama Inu (SAITAMA)");
  assert.deepEqual(pack.docs.map((d) => d.kind), ["sec", "ftc", "state"]);
  const sec = pack.docs.find((d) => d.kind === "sec")!.body;
  assert.match(sec, /market manipulation/i);
  assert.match(sec, /Sections 5\(a\), 5\(c\) and 17\(a\)/);
  assert.match(sec, /9\(a\)\(2\)/);
  assert.match(sec, /10\(b\), and Rule 10b-5/);
  assert.match(sec, /No\. 1:24-cv-12586/);
  assert.match(sec, /https:\/\/www\.sec\.gov\/files\/litigation\/complaints\/2024\/comp-pr2024-166-saitama\.pdf/);
  assert.match(sec, /Nam Tran \(@Ntran1234\)/);
  assert.match(sec, /allegations, not findings/i);
  for (const p of snaps.saitama.purchases) assert.ok(sec.includes(p.txHash), p.txHash);
  for (const d of pack.docs) {
    assert.doesNotMatch(d.body, /17\(b\)|77q\(b\)|touting|Kardashian|Pierce|Mayweather|EthereumMax|EMAX\b/, d.title);
    assert.doesNotMatch(d.body, /were paid and did not properly disclose|fined promoters|Whether payment was disclosed/, d.title);
    assert.doesNotMatch(d.body, /class action/i, d.title);
  }
  const ftc = pack.docs.find((d) => d.kind === "ftc")!.body;
  assert.match(ftc, /The SEC later sued the people running this token/);
  const ev = JSON.parse(pack.evidence.json).evidence;
  assert.equal(ev.case.slug, "saitama");
  assert.equal(ev.case.classAction, null);
  assert.equal(ev.purchases.address, snaps.saitama.address);
});

test("fact guard: every checkable fact in every Saitama draft comes from the inputs, in every jurisdiction", async () => {
  const t = call(TEXAS);
  const base = input(t);
  const places = [undefined, placeFor("UK", undefined), placeFor("EU", undefined, "DE"), placeFor("IN", undefined), placeFor("other", undefined)];
  for (const place of places) {
    const inp = place ? withPlace(base, place) : base;
    const pack = await buildClaimPack(inp);
    const allowed = allowedFacts(guardInputs(inp, pack.evidence.sha256));
    for (const d of pack.docs) {
      assert.deepEqual(factGuard(d.body, allowed).unknown, [], `${place?.countryName ?? "US"} / ${d.title}`);
      assert.doesNotMatch(d.body, /17\(b\)|Kardashian|EthereumMax|fined promoters/, `${place?.countryName ?? "US"} / ${d.title}`);
    }
  }
  const uk = (await buildClaimPack(withPlace(base, placeFor("UK", undefined)))).docs.find((d) => d.kind === "uk")!.body;
  assert.match(uk, /the SEC has sued the people who ran this token/);
});

test("a caller who doesn't remember the coin: the wallet's purchases tell Doki which case it is", () => {
  let t = call(["I don't remember the name", "a Telegram group", "November 2021"]);
  assert.equal(t.state.facts.coin?.isCase, false);
  t = respond(t.state, SAITAMA_WALLET, CASES);
  assert.deepEqual(t.reply.action, { type: "check-wallet", address: "0x3DaD8f9341255Ceb7E129512aE790d90cEC55105", cases: ["emax", "saitama"] });
  t = applyPurchaseResult(t.state, { ok: true, report: snaps.saitama }, CASES);
  assert.equal(t.state.caseSlug, "saitama");
  assert.deepEqual(t.state.facts.coin, { text: "Saitama Inu (SAITAMA)", isCase: true, slug: "saitama" });
  assert.match(said(t), /That wallet bought Saitama Inu/);
  assert.match(said(t), /Found it\. 2 purchases of SAITAMA/);
  // nothing found on any case pool: no case is assumed, and no empty report is kept
  let u = call(["I don't remember", "a friend", "2022"]);
  u = respond(u.state, EMAX_WALLET.replace("ac", "bd"), CASES);
  u = applyPurchaseResult(u.state, { ok: true, report: { ...snaps.saitama, address: u.state.facts.wallet!.address!, purchases: [], sales: [] } }, CASES);
  assert.equal(u.state.facts.coin?.isCase, false);
  assert.equal(u.state.facts.purchases, undefined);
  assert.match(said(u), /couldn't find purchases of the coins Canary has case files on/);
});

test("the EMAX call is unchanged when the hotline knows both cases", () => {
  const lines = ["EthereumMax", "Kim Kardashian", "I think July 2021", "No, it was June.", EMAX_WALLET, "About three thousand dollars", "New York", "Sam Taylor", "sam@example.com", "yes", "yes", "yes", "yes"];
  const both = call(lines, CASES);
  const one = call(lines, emax);
  assert.equal(both.state.caseSlug, "emax");
  assert.deepEqual(both.reply, one.reply);
  const strip = ({ cases: _c, ...s }: Turn["state"]) => s; // eslint-disable-line @typescript-eslint/no-unused-vars
  assert.deepEqual(strip(both.state), strip(one.state));
  // only the coin question's quick answers grow, by the new case
  assert.deepEqual(startCall(CASES).reply.suggestions, ["EthereumMax (EMAX)", "Saitama Inu (SAITAMA)", "A different coin", "I don't remember"]);
  assert.deepEqual(startCall(emax).reply.suggestions, ["EthereumMax (EMAX)", "A different coin", "I don't remember"]);
});

test("a hotline that only knows EMAX treats Saitama as a coin without a case file", () => {
  const t = call(["Saitama Inu"], emax);
  assert.equal(t.state.caseSlug, "emax");
  assert.equal(t.state.facts.coin?.isCase, false);
  assert.match(said(t), /I don't have a case file on that coin/);
});
