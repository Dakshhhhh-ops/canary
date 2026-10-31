import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { allowedFacts, buildClaimPack, factGuard, guardInputs, LAW, EU_NCA, placeFor, withPlace, type ClaimInput } from "../src/lib/claims";
import { applyPurchaseResult, complaintsFor, consentedDocs, respond, startCall, type Turn } from "../src/lib/hotline/agent";
import { toHotlineCase } from "../src/lib/hotline/caseFacts";
import { guardExtract } from "../src/lib/hotline/extract";
import { mentionedPlace, parsePlace } from "../src/lib/hotline/parse";
import type { PurchaseReport } from "../src/lib/hotline/purchases";
import type { CaseFile } from "../src/lib/types";

const k = toHotlineCase(JSON.parse(readFileSync("data/cases/emax.json", "utf8")) as CaseFile);
const snap = JSON.parse(readFileSync("src/lib/hotline/demoSnapshot.json", "utf8")) as PurchaseReport;
const WALLET = "0xac85724be118b69a9aee3b03bd2af2ac0071f26a";

function call(lines: string[]): Turn {
  let t = startCall(k);
  for (const l of lines) {
    t = respond(t.state, l, k);
    if (t.reply.action?.type === "check-wallet") t = applyPurchaseResult(t.state, { ok: true, report: snap }, k);
  }
  return t;
}
const input = (t: Turn, id = "jur01"): ClaimInput => ({ id, kase: k, facts: t.state.facts, consents: consentedDocs(t.state), generatedAt: "2026-10-30T12:00:00.000Z", origin: "https://canary.example" });

// ---------- detection ----------

test("places: EU member states and cities route to the EU, with the country", () => {
  assert.deepEqual([parsePlace("Germany")?.country, parsePlace("Germany")?.euState], ["EU", "DE"]);
  assert.equal(parsePlace("I live in Paris")?.euState, "FR");
  assert.equal(parsePlace("Dublin")?.euState, "IE");
  assert.equal(parsePlace("amsterdam")?.euState, "NL");
  assert.equal(parsePlace("Madrid, Spain")?.euState, "ES");
  assert.equal(parsePlace("Milan")?.euState, "IT");
  assert.equal(parsePlace("somewhere in the EU")?.country, "EU");
  // the UK and the US still win where they should
  assert.equal(parsePlace("Belfast")?.ukNation, "Northern Ireland");
  assert.equal(parsePlace("Northern Ireland")?.country, "UK");
  assert.equal(parsePlace("Paris, Texas")?.state, "TX");
  assert.equal(parsePlace("I live in Canada")?.country, "other");
});

test("a place mentioned in passing needs a clear cue", () => {
  assert.equal(mentionedPlace("I'm in London")?.ukNation, "England");
  assert.equal(mentionedPlace("from Mumbai")?.country, "IN");
  assert.equal(mentionedPlace("I'm from Mumbai, and I lost a lot")?.country, "IN");
  assert.equal(mentionedPlace("I live in Berlin and bought EMAX after Kim's post")?.euState, "DE");
  assert.equal(mentionedPlace("I am based in Dublin")?.euState, "IE");
  for (const no of ["Kim Kardashian", "a YouTube video from some crypto guy", "I bought it in June 2021", "EthereumMax", "I bought on Coinbase", "I'm in a group chat"]) assert.equal(mentionedPlace(no), null, no);
});

test("the hotline hears the place in passing and confirms it instead of asking", () => {
  const t = call(["I'm in London and I bought EMAX", "Kim Kardashian", "June 2021", WALLET, "£900"]);
  assert.equal(t.state.facts.place?.country, "UK");
  assert.equal(t.reply.step, "name"); // the location question was skipped...
  assert.ok(t.reply.say.some((l) => /You said you live in England/.test(l)), t.reply.say.join(" ")); // ...and the place read back
  assert.deepEqual(complaintsFor(t.state.facts), ["sec", "uk"]);
});

test("the hotline asks where the caller lives when it doesn't know, and EU answers name the regulator", () => {
  let t = call(["EMAX", "Paul Pierce", "June 2021", "skip", "500 euros"]);
  assert.equal(t.reply.step, "location");
  t = respond(t.state, "Berlin", k);
  assert.equal(t.state.facts.place?.euState, "DE");
  assert.ok(t.reply.say.some((l) => /BaFin/.test(l)));
  assert.deepEqual(complaintsFor(t.state.facts), ["sec", "eu"]);
  // "I'm in the US" without a state: Doki still asks which state
  const us = call(["EMAX", "I'm in the US", "Kim", "June 2021", "skip", "$100"]);
  assert.equal(us.reply.step, "state");
});

test("the optional extractor can hand in an EU country too", () => {
  const raw = { coin: null, promoters: [], month: null, day: null, amountValue: null, currency: null, country: "France", usStateCode: null };
  assert.equal(guardExtract(raw, "j'habite en France", k).place?.euState, "FR");
});

test("US calls are unchanged: same documents as before", async () => {
  const ny = call(["EthereumMax", "Kim Kardashian", "June 2021", WALLET, "About three thousand dollars", "New York", "skip", "skip", "yes", "yes", "yes", "yes"]);
  assert.deepEqual((await buildClaimPack(input(ny))).docs.map((d) => d.kind), ["sec", "ftc", "state", "classAction"]);
});

// ---------- documents ----------

const SCENARIOS: Record<string, string[]> = {
  "UK, England": ["I'm in London and I bought EMAX", "Kim Kardashian", "June 2021", WALLET, "£900", "skip", "skip", "yes", "yes", "yes"],
  "UK, Scotland": ["ethereum max", "Floyd Mayweather", "June 2021", WALLET, "£900", "Glasgow, Scotland", "skip", "skip", "yes", "yes", "yes"],
  "EU, Germany": ["EMAX", "Paul Pierce", "June 2021", "skip", "500 euros", "Berlin", "skip", "skip", "yes", "yes", "yes"],
  "EU, country not mapped": ["EMAX", "Kim", "June 2021", "skip", "800 euros", "Vienna", "skip", "skip", "yes", "yes", "yes"],
  "EU, other coin, recent": ["a coin called $PEPE2", "an influencer on TikTok", "March 2025", "skip", "300 euros", "I live in Madrid", "skip", "skip", "yes", "yes"],
  "India, exchange": ["EMAX", "Kim", "June 2021", "I bought on WazirX", "50000 rupees", "from Mumbai", "skip", "skip", "yes", "yes", "yes"],
};

const packs = new Map<string, Awaited<ReturnType<typeof buildClaimPack>>>();
async function packOf(name: string) {
  if (!packs.has(name)) packs.set(name, await buildClaimPack(input(call(SCENARIOS[name]))));
  return packs.get(name)!;
}

for (const name of Object.keys(SCENARIOS)) {
  test(`fact guard: every provision, date, phone and link comes from the inputs or the law table (${name})`, async () => {
    const t = call(SCENARIOS[name]);
    assert.equal(t.reply.step, "done", `${name}: ended at ${t.reply.step}`);
    const inp = input(t);
    const pack = await buildClaimPack(inp);
    const allowed = allowedFacts(guardInputs(inp, pack.evidence.sha256));
    for (const d of pack.docs) {
      assert.deepEqual(factGuard(d.body, allowed).unknown, [], `${name} / ${d.title}`);
      assert.match(d.body, /Nothing here is legal advice/);
    }
  });
}

test("UK: FCA and Report Fraud, the financial promotion rules with sources, and the date caveat", async () => {
  const uk = (await packOf("UK, England")).docs.find((d) => d.kind === "uk")!;
  for (const s of [
    "https://www.fca.org.uk/consumers/report-scam",
    "https://www.reportfraud.police.uk",
    "0300 123 2040",
    "Financial Services and Markets Act 2000, section 21",
    "https://www.legislation.gov.uk/ukpga/2000/8/section/21",
    "https://www.legislation.gov.uk/ukpga/2000/8/section/25",
    "SI 2023/612",
    "October 8, 2023",
    "COBS 4.12A.11R",
    "Don't invest unless you're prepared to lose all the money you invest.",
    "FG24/1",
    "https://www.fca.org.uk/publications/finalised-guidance/fg24-1-finalised-guidance-financial-promotions-social-media",
  ])
    assert.ok(uk.body.includes(s), s);
  assert.match(uk.body, /I bought before October 8, 2023/); // EMAX was 2021: the crypto rules came later
  assert.doesNotMatch(uk.body, /actionfraud/i);
  const scot = (await packOf("UK, Scotland")).docs.find((d) => d.kind === "uk")!;
  assert.match(scot.body, /Police Scotland by calling 101/);
  assert.doesNotMatch(scot.body, /call 0300 123 2040/);
});

test("EU: the national regulator, MiCA Title VI articles, UCPD point 11, and the MiCA start date", async () => {
  const de = (await packOf("EU, Germany")).docs.find((d) => d.kind === "eu")!;
  assert.equal(de.destination?.url, EU_NCA.DE.url);
  for (const s of ["BaFin", "Regulation (EU) 2023/1114", "Article 86(1)", "Article 91(2)(c)", "Article 91(3)(c)", "Article 88", "Article 89", "Article 7(1)", "Directive 2005/29/EC, Annex I, point 11", "https://eur-lex.europa.eu/eli/reg/2023/1114/oj", "December 30, 2024"])
    assert.ok(de.body.includes(s), s);
  assert.match(de.body, /I bought before December 30, 2024/);
  // a member state without a mapped authority goes to ESMA's list, never a guessed regulator
  const at = (await packOf("EU, country not mapped")).docs.find((d) => d.kind === "eu")!;
  assert.ok(at.body.includes("List_of_Competent_Authorities_notified_to_ESMA_under_MiCA.pdf"));
  assert.doesNotMatch(at.body, /BaFin|AMF|CONSOB|CNMV/);
  // a purchase after MiCA applied carries no "may not cover" caveat, and no EMAX facts
  const es = (await packOf("EU, other coin, recent")).docs.find((d) => d.kind === "eu")!;
  assert.ok(es.body.includes("CNMV"));
  assert.doesNotMatch(es.body, /I bought before/);
  assert.doesNotMatch(es.body, /Kardashian|EMAX/);
});

test("India: cybercrime portal and 1930, ASCI complaint and guidelines, the PMLA notification", async () => {
  const ind = (await packOf("India, exchange")).docs.find((d) => d.kind === "india")!;
  for (const s of [
    "https://cybercrime.gov.in",
    "1930",
    "https://www.ascionline.in/complaint-faq/",
    "Crypto products and NFTs are unregulated and can be highly risky. There may be no regulatory recourse for any loss from such transactions.",
    "February 23, 2022",
    "April 1, 2022",
    "Guidelines for Influencer Advertising in Digital Media",
    "S.O. 1072(E)",
    "Prevention of Money-laundering Act, 2002",
    "FIU-IND",
    "WazirX",
  ])
    assert.ok(ind.body.includes(s), s);
  assert.match(ind.body, /I bought before April 1, 2022/);
});

test("the guard catches an invented provision, instrument or helpline", async () => {
  const t = call(SCENARIOS["EU, Germany"]);
  const inp = input(t);
  const pack = await buildClaimPack(inp);
  const allowed = allowedFacts(guardInputs(inp, pack.evidence.sha256));
  const forged = pack.docs[1].body + "\nSee also Article 99(4) of MiCA, SI 2099/1, Directive 2031/7/EC, FG29/9, S.O. 9999(E), section 404, and call 0300 999 9999.";
  const values = factGuard(forged, allowed).unknown.map((u) => u.value);
  for (const v of ["Article 99(4)", "SI 2099/1", "Directive 2031/7/EC", "FG29/9", "S.O. 9999(E)", "section 404", "0300 999 9999"]) assert.ok(values.includes(v), `${v} in ${values.join(", ")}`);
});

test("every cited provision has an official https source and well-formed dates", () => {
  const official = /^https:\/\/(www\.)?(legislation\.gov\.uk|fca\.org\.uk|handbook\.fca\.org\.uk|reportfraud\.police\.uk|gov\.uk|eur-lex\.europa\.eu|esma\.europa\.eu|ascionline\.in|tara\.ascionline\.in|cybercrime\.gov\.in|pib\.gov\.in|egazette\.gov\.in|fiuindia\.gov\.in)\//;
  const ids = new Set<string>();
  for (const l of LAW) {
    assert.ok(!ids.has(l.id), `duplicate ${l.id}`);
    ids.add(l.id);
    assert.ok(l.sources.length >= 1, l.id);
    for (const s of l.sources) assert.match(s.url.endsWith("/") ? s.url : s.url + "/", official, `${l.id}: ${s.url}`);
    for (const d of [l.date, l.from]) if (d) assert.match(d, /^20\d\d-\d\d-\d\d$/, l.id);
  }
  for (const [code, n] of Object.entries(EU_NCA)) assert.match(n.url, /^https:\/\//, code);
});

test("changing the jurisdiction in the claim pack: same answers, the right documents, prior 'no' kept", async () => {
  const ny = call(["EMAX", "Kim", "June 2021", "skip", "$100", "Ohio", "skip", "skip", "yes", "yes", "no", "yes"]);
  const base = input(ny);
  assert.deepEqual(base.consents, ["sec", "state"]); // the FTC report was turned down
  const toUk = withPlace(base, placeFor("UK", base.facts.place));
  assert.deepEqual(toUk.consents, ["sec", "uk"]);
  const toDe = withPlace(base, placeFor("EU", base.facts.place, "DE"));
  assert.equal(toDe.facts.place?.euState, "DE");
  const pack = await buildClaimPack(toDe);
  assert.deepEqual(pack.docs.map((d) => d.kind), ["sec", "eu", "classAction"]);
  assert.equal(pack.jurisdiction, "European Union (Germany)");
  // back to the US: the FTC report the caller turned down stays out
  const back = withPlace(toDe, placeFor("US", toDe.facts.place));
  assert.ok(!back.consents.includes("ftc"));
  // the same choice gives the same pack, byte for byte
  assert.equal((await buildClaimPack(toDe)).evidence.sha256, pack.evidence.sha256);
});
