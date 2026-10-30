import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applyPurchaseResult, complaintsFor, consentedDocs, respond, startCall, type Turn } from "../src/lib/hotline/agent";
import { toHotlineCase } from "../src/lib/hotline/caseFacts";
import { detectRecoveryScam, detectSecret, parseAmount, parsePlace, parseWhen } from "../src/lib/hotline/parse";
import type { PurchaseReport } from "../src/lib/hotline/purchases";
import type { CaseFile } from "../src/lib/types";

const k = toHotlineCase(JSON.parse(readFileSync("data/cases/emax.json", "utf8")) as CaseFile);
const snap = JSON.parse(readFileSync("src/lib/hotline/demoSnapshot.json", "utf8")) as PurchaseReport;
const WALLET = "0xac85724be118b69a9aee3b03bd2af2ac0071f26a";

function talk(lines: string[], from: Turn = startCall(k)): Turn {
  let t = from;
  for (const l of lines) {
    t = respond(t.state, l, k);
    if (t.reply.action?.type === "check-wallet") t = applyPurchaseResult(t.state, { ok: true, report: snap }, k);
  }
  return t;
}

const said = (t: Turn) => t.reply.say.join(" ");

test("greets with empathy, says it's not legal advice, asks one question", () => {
  const t = startCall(k);
  assert.equal(t.reply.step, "coin");
  assert.equal(t.reply.mood, "wave");
  assert.match(said(t), /sorry/i);
  assert.match(said(t), /isn't legal advice/i);
  assert.match(said(t), /never ask for passwords or secret words/i);
  assert.equal(said(t).match(/\?/g)?.length, 1);
});

test("full EMAX call: case recognised, promoter fact, wallet check, routing, consent, claim", () => {
  let t = talk(["I lost money on EthereumMax"]);
  assert.equal(t.state.facts.coin?.isCase, true);
  assert.match(said(t), /case file/);
  t = talk(["Kim Kardashian's instagram"], t);
  assert.deepEqual(t.state.facts.promoters?.matched, ["Kim Kardashian"]);
  assert.match(said(t), /The SEC found Kim Kardashian was paid \$250,000/);
  t = talk(["mid June 2021"], t);
  assert.equal(t.state.facts.when?.date, "2021-06-15");
  t = respond(t.state, `it's ${WALLET}`, k);
  assert.equal(t.reply.step, "checking");
  assert.deepEqual(t.reply.action, { type: "check-wallet", address: "0xAC85724Be118b69a9AeE3B03bd2af2aC0071F26a" });
  assert.equal(t.reply.mood, "think");
  t = applyPurchaseResult(t.state, { ok: true, report: snap }, k);
  assert.equal(t.reply.step, "amount");
  assert.match(said(t), new RegExp(`${snap.purchases.length} purchases of EMAX`));
  assert.match(said(t), /never sold/);
  t = talk(["about $3,000", "California", "skip", "skip"], t);
  assert.equal(t.state.facts.amount?.value, 3000);
  assert.equal(t.state.facts.place?.state, "CA");
  assert.equal(t.state.facts.name, undefined);
  assert.equal(t.reply.step, "summary");
  assert.match(said(t), /Is that right\?/);
  t = talk(["yes"], t);
  assert.equal(t.reply.step, "consent");
  assert.deepEqual(t.state.consentQueue, ["sec", "ftc", "state"]);
  t = talk(["yes", "no", "yes"], t);
  assert.equal(t.reply.step, "done");
  assert.deepEqual(t.reply.action, { type: "make-claim" });
  assert.deepEqual(consentedDocs(t.state), ["sec", "state"]);
  assert.equal(t.reply.mood, "happy");
});

test("a seed phrase is stopped, never stored, and the UI is told to hide it", () => {
  const phrase = "abandon ability able about above absent absorb abstract absurd abuse access accident";
  const before = talk(["EMAX", "Paul Pierce"]);
  const t = respond(before.state, phrase, k);
  assert.equal(t.reply.alert, "secret");
  assert.equal(t.reply.redactUser, true);
  assert.equal(t.reply.mood, "alarm");
  assert.equal(t.reply.step, before.reply.step); // nothing advanced
  assert.ok(!JSON.stringify(t.state).includes("abandon"));
  assert.match(said(t), /Never share them/);
});

test("private keys, passwords and offers are stopped too", () => {
  assert.equal(detectSecret("my key is " + "ab".repeat(32)), "private-key");
  assert.equal(detectSecret("my password is hunter2"), "password");
  assert.equal(detectSecret("do you need my seed phrase?"), "offer");
  assert.equal(detectSecret("my recovery phrase is apple banana"), "seed-phrase");
  // a transaction hash is not a secret
  assert.equal(detectSecret("0x" + "ab".repeat(32)), null);
  assert.equal(detectSecret("I bought EMAX in June after Kim Kardashian posted"), null);
  const t = respond(startCall(k).state, "my password is hunter2", k);
  assert.equal(t.reply.redactUser, true);
  assert.ok(!JSON.stringify(t.state).includes("hunter2"));
});

test("a recovery-scam mention raises the alarm and the answer still counts", () => {
  const t0 = talk(["EMAX", "Kim", "June 2021", "I don't know"]);
  assert.equal(t0.reply.step, "amount");
  const t = respond(t0.state, "about 2000 dollars, and a recovery company wants a fee to get it back", k);
  assert.equal(t.reply.alert, "recovery");
  assert.equal(t.reply.mood, "alarm");
  assert.match(said(t), /almost always scammers/);
  assert.equal(t.state.facts.amount?.value, 2000);
  assert.equal(t.state.facts.recoveryScam, true);
  assert.equal(t.reply.step, "location");
  assert.equal(detectRecoveryScam("I just want to know if I can get my money back"), false);
  assert.equal(detectRecoveryScam("they asked for a withdrawal fee"), true);
});

test("corrections: 'no, it was June' fixes the earlier answer and stays on the current question", () => {
  let t = talk(["EMAX", "Pierce", "July 2021"]);
  assert.equal(t.state.facts.when?.month, "2021-07");
  assert.equal(t.reply.step, "wallet");
  t = respond(t.state, "No, it was June.", k);
  assert.equal(t.state.facts.when?.month, "2021-06");
  assert.equal(t.reply.step, "wallet");
  assert.match(said(t), /changed the date to June 2021/);
});

test("summary: 'change something' -> pick a field -> back to the summary", () => {
  let t = talk(["EMAX", "Kim", "June 2021", "I bought on Coinbase", "500 dollars", "Texas", "skip", "skip"]);
  assert.equal(t.reply.step, "summary");
  assert.equal(t.state.facts.wallet?.exchange, "Coinbase");
  t = talk(["Change something", "the amount"], t);
  assert.equal(t.reply.step, "amount");
  t = talk(["$800"], t);
  assert.equal(t.reply.step, "summary");
  assert.equal(t.state.facts.amount?.value, 800);
  t = respond(t.state, "no, I live in New Jersey", k);
  assert.equal(t.state.facts.place?.state, "NJ");
  assert.equal(t.reply.step, "summary");
});

test("'I don't know' and 'skip' move on without inventing anything", () => {
  const t = talk(["I don't remember", "not sure", "skip", "I don't know my address", "no idea", "rather not say", "skip", "skip"]);
  assert.equal(t.reply.step, "summary");
  assert.equal(t.state.facts.amount, undefined);
  assert.equal(t.state.facts.place, undefined);
  assert.deepEqual(complaintsFor(t.state.facts), ["generic"]);
});

test("another coin still gets a complaint, with no EMAX facts mixed in", () => {
  const t = talk(["a coin called $SQUID", "a YouTube video from some crypto guy", "March 2022", `${WALLET}`, "1500 dollars", "London"]);
  assert.equal(t.state.facts.coin?.isCase, false);
  assert.equal(t.state.facts.coin?.text, "SQUID");
  assert.equal(t.state.facts.purchases, undefined); // no automatic lookup for coins without a case file
  assert.equal(t.state.facts.place?.country, "UK");
  assert.deepEqual(complaintsFor(t.state.facts), ["uk"]);
});

test("routing by place: US state, UK nation, India, elsewhere", () => {
  assert.equal(parsePlace("I'm in brooklyn")?.state, "NY");
  assert.equal(parsePlace("west virginia")?.state, "WV");
  assert.equal(parsePlace("Edinburgh, Scotland")?.ukNation, "Scotland");
  assert.equal(parsePlace("Mumbai")?.country, "IN");
  assert.equal(parsePlace("I live in Canada")?.country, "other");
  assert.equal(parsePlace("I live in a flat"), null); // "in" is not Indiana
  assert.deepEqual(complaintsFor({ coin: { text: "x", isCase: true }, place: { text: "", country: "IN", countryName: "India" } }), ["sec", "india"]);
});

test("parsers: dates and amounts in everyday words", () => {
  assert.equal(parseWhen("the 14th of June", 2021)?.date, "2021-06-14");
  assert.equal(parseWhen("late may", 2021)?.date, "2021-05-25");
  assert.equal(parseWhen("6/2/2021")?.date, "2021-06-02");
  assert.equal(parseWhen("June 2021")?.month, "2021-06");
  assert.equal(parseWhen("no idea"), null);
  assert.deepEqual(parseAmount("about 2.5k"), { text: "about 2.5k", value: 2500, currency: undefined });
  assert.equal(parseAmount("three thousand dollars")?.value, 3000);
  assert.equal(parseAmount("£1,200")?.currency, "GBP");
  assert.equal(parseAmount("2 lakh rupees")?.value, 200000);
});

test("repeat, why, legal advice and who-are-you never advance the call", () => {
  const t0 = talk(["EMAX"]);
  for (const q of ["sorry, can you repeat that?", "why do you need that?", "is this legal advice?", "are you a real person?"]) {
    const t = respond(t0.state, q, k);
    assert.equal(t.reply.step, "promoter", q);
  }
  assert.match(said(respond(t0.state, "can I sue them?", k)), /can't give legal advice/);
});

test("a bad address is explained, and the check is not started", () => {
  const t0 = talk(["EMAX", "Kim", "June 2021"]);
  const t = respond(t0.state, "0x12345", k);
  assert.equal(t.reply.step, "wallet");
  assert.equal(t.reply.action, undefined);
  assert.match(said(t), /42 characters/);
});

test("a failed blockchain check is said plainly and the call goes on", () => {
  const t0 = respond(talk(["EMAX", "Kim", "June 2021"]).state, WALLET, k);
  const t = applyPurchaseResult(t0.state, { ok: false, error: "timeout" }, k);
  assert.equal(t.reply.step, "amount");
  assert.match(said(t), /didn't answer/);
  assert.equal(t.state.facts.purchaseCheck, "failed");
});
