import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { canonical, sha256Hex } from "../src/lib/canonical";
import { allowedFacts, buildClaimPack, checkEvidenceFile, classAssessment, factGuard, guardInputs, type ClaimInput } from "../src/lib/claims";
import { claimantRef, evidenceHashHex } from "../src/lib/claims/claimant";
import { applyPurchaseResult, consentedDocs, respond, startCall, type Turn } from "../src/lib/hotline/agent";
import { toHotlineCase } from "../src/lib/hotline/caseFacts";
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

const input = (t: Turn, id = "test01"): ClaimInput => ({ id, kase: k, facts: t.state.facts, consents: consentedDocs(t.state), generatedAt: "2026-10-30T12:00:00.000Z", trailHead: "ab".repeat(32), origin: "https://canary.example" });

const SCENARIOS: Record<string, string[]> = {
  "EMAX, New York, wallet, recovery scam": ["EthereumMax", "Kim Kardashian", "I think July 2021", "No, it was June.", WALLET, "About three thousand dollars, and a guy wants a fee to get it back", "New York", "Sam Taylor", "sam@example.com", "yes", "yes", "yes", "yes"],
  "EMAX, Texas, exchange": ["EMAX", "Paul Pierce tweets", "late May 2021", "I bought on Coinbase", "$1,200", "Texas", "skip", "skip", "yes", "yes", "yes", "yes"],
  "EMAX, UK, Scotland": ["ethereum max", "Floyd Mayweather", "June 2021", WALLET, "£900", "Glasgow, Scotland", "skip", "skip", "yes", "yes", "yes"],
  "EMAX, India": ["EMAX", "a friend told me", "June 2021", "I don't know", "50000 rupees", "Delhi", "Priya", "skip", "yes", "yes", "yes"],
  "other coin, elsewhere": ["a coin called $SQUID", "a YouTube video", "March 2022", "I don't know", "2000 dollars", "Canada", "skip", "skip", "yes", "yes"],
};

for (const [name, lines] of Object.entries(SCENARIOS)) {
  test(`fact guard: every date, amount, hash, link and docket in the documents comes from the inputs (${name})`, async () => {
    const t = call(lines);
    assert.equal(t.reply.step, "done", `${name}: ended at ${t.reply.step}`);
    const inp = input(t);
    const pack = await buildClaimPack(inp);
    assert.ok(pack.docs.length >= 1);
    const allowed = allowedFacts(guardInputs(inp, pack.evidence.sha256));
    for (const d of pack.docs) {
      const g = factGuard(d.body, allowed);
      assert.deepEqual(g.unknown, [], `${name} / ${d.title}`);
      assert.match(d.body, /Nothing here is legal advice/, `${d.title} says it isn't legal advice`);
    }
  });
}

test("the guard catches an invented fact", async () => {
  const t = call(SCENARIOS["EMAX, New York, wallet, recovery scam"]);
  const inp = input(t);
  const pack = await buildClaimPack(inp);
  const allowed = allowedFacts(guardInputs(inp, pack.evidence.sha256));
  const forged = pack.docs[0].body + "\nThe SEC also fined her $9,999,999 on March 3, 2024 in case 2:24-cv-99999. See https://example.com/fake and tx 0x" + "9".repeat(64);
  const g = factGuard(forged, allowed);
  assert.equal(g.ok, false);
  const values = g.unknown.map((u) => u.value);
  for (const v of ["$9,999,999", "March 3, 2024", "2:24-cv-99999", "https://example.com/fake", "0x" + "9".repeat(64)]) assert.ok(values.includes(v), v);
});

test("tx hashes, dates and the wallet appear verbatim in the SEC tip", async () => {
  const t = call(SCENARIOS["EMAX, New York, wallet, recovery scam"]);
  const pack = await buildClaimPack(input(t));
  const sec = pack.docs.find((d) => d.kind === "sec")!;
  for (const p of snap.purchases) {
    assert.ok(sec.body.includes(p.txHash), p.txHash);
    assert.ok(sec.body.includes(`https://etherscan.io/tx/${p.txHash}`));
  }
  assert.ok(sec.body.includes(snap.address));
  assert.ok(sec.body.includes("June 2, 2021 at 17:26 UTC"));
  assert.ok(sec.body.includes("Section 17(b)"));
  assert.ok(sec.body.includes("https://www.sec.gov/tcr"));
  assert.ok(sec.body.includes("https://www.sec.gov/litigation/admin/2022/33-11116.pdf"));
  assert.match(sec.body, /Name: Sam Taylor/);
});

test("documents follow consent: a 'no' leaves that complaint out", async () => {
  const t = call(["EMAX", "Kim", "June 2021", "skip", "$100", "Ohio", "skip", "skip", "yes", "yes", "no", "yes"]);
  const kinds = (await buildClaimPack(input(t))).docs.map((d) => d.kind);
  assert.deepEqual(kinds, ["sec", "state", "classAction"]);
});

test("state note routes through NASAA; UK and India notes use the official sites", async () => {
  const tx = await buildClaimPack(input(call(SCENARIOS["EMAX, Texas, exchange"])));
  const st = tx.docs.find((d) => d.kind === "state")!;
  assert.ok(st.body.includes("https://www.nasaa.org/contact-your-regulator/"));
  assert.match(st.body, /Texas/);
  const uk = (await buildClaimPack(input(call(SCENARIOS["EMAX, UK, Scotland"])))).docs.find((d) => d.kind === "uk")!;
  assert.ok(uk.body.includes("https://www.fca.org.uk/consumers/report-scam")); // the FCA moved it from /report-scam-us
  assert.match(uk.body, /Police Scotland by calling 101/);
  const india = (await buildClaimPack(input(call(SCENARIOS["EMAX, India"])))).docs.find((d) => d.kind === "india")!;
  assert.ok(india.body.includes("https://cybercrime.gov.in"));
  assert.match(india.body, /1930/);
});

test("class action note: case, court, period and an honest membership read", async () => {
  const ny = call(SCENARIOS["EMAX, New York, wallet, recovery scam"]);
  const note = (await buildClaimPack(input(ny))).docs.find((d) => d.kind === "classAction")!;
  assert.match(note.body, /In re EthereumMax Investor Litigation/);
  assert.match(note.body, /Huegerich v\. Gentile et al\./);
  assert.match(note.body, /No\. 2:22-cv-00163/);
  assert.match(note.body, /May 14, 2021 to June 27, 2021/);
  assert.match(note.body, /You may be a member/);
  assert.match(note.body, /does not recommend lawyers/);
  assert.equal(classAssessment({ input: input(ny), k }).verdict, "maybe-member");
  const tx = call(SCENARIOS["EMAX, Texas, exchange"]);
  assert.equal(classAssessment({ input: input(tx), k }).verdict, "not-certified-state");
  const late = call(["EMAX", "Kim", "August 2021", "skip", "$5", "New Jersey", "skip", "skip", "yes", "yes", "yes", "yes"]);
  assert.equal(classAssessment({ input: input(late), k }).verdict, "outside-period");
});

test("a coin without a case file gets no EMAX facts", async () => {
  const pack = await buildClaimPack(input(call(SCENARIOS["other coin, elsewhere"])));
  for (const d of pack.docs) {
    assert.doesNotMatch(d.body, /Kardashian|Pierce|Mayweather|EthereumMax|EMAX/, d.title);
  }
  assert.equal(pack.docs.find((d) => d.kind === "classAction"), undefined);
});

test("evidence file: the agreed envelope, canonical fingerprint, no name or email", async () => {
  const t = call(SCENARIOS["EMAX, New York, wallet, recovery scam"]);
  const pack = await buildClaimPack(input(t));
  const env = JSON.parse(pack.evidence.json);
  assert.equal(env.kind, "canary.evidence");
  assert.equal(env.version, 1);
  assert.equal(env.sha256, pack.evidence.sha256);
  assert.equal(env.sha256, await sha256Hex(canonical(env.evidence)));
  assert.equal(pack.evidence.filename, "canary-evidence-test01.json");
  assert.ok(!pack.evidence.json.includes("Sam Taylor"));
  assert.ok(!pack.evidence.json.includes("sam@example.com"));
  assert.equal(env.evidence.trailHead, "ab".repeat(32));
  assert.equal(env.evidence.purchases.purchases[0].txHash, snap.purchases[0].txHash);
  assert.ok((await checkEvidenceFile(pack.evidence.json)).ok);
  // one changed character breaks it
  const tampered = pack.evidence.json.replaceAll(snap.purchases[0].txHash, snap.purchases[0].txHash.slice(0, -1) + (snap.purchases[0].txHash.endsWith("f") ? "e" : "f"));
  assert.equal((await checkEvidenceFile(tampered)).ok, false);
  // the same input gives the same fingerprint
  assert.equal((await buildClaimPack(input(t))).evidence.sha256, pack.evidence.sha256);
});

test("claimant reference is salted: same evidence, different salt -> different ref", () => {
  const sha = "6bced921d1244d5b705f663c35cfb55c6ad8dc72fda341b2f279e68b9960288d";
  const a = claimantRef(`0x${"01".repeat(32)}`, sha);
  const b = claimantRef(`0x${"02".repeat(32)}`, sha);
  assert.match(a, /^0x[0-9a-f]{64}$/);
  assert.notEqual(a, b);
  assert.equal(evidenceHashHex(sha), `0x${sha}`);
});
