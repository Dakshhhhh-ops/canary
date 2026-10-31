import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildClaimPack, type ClaimInput } from "../src/lib/claims";
import { buildClaimPdf, packSources, pdfSha256, winAnsi, wrap } from "../src/lib/claims/pdf";
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
const NY = ["EthereumMax", "Kim Kardashian", "June 2021", WALLET, "About three thousand dollars", "New York", "Sam Taylor", "sam@example.com", "yes", "yes", "yes", "yes"];
const input = (t: Turn): ClaimInput => ({ id: "pdf01", kase: k, facts: t.state.facts, consents: consentedDocs(t.state), generatedAt: "2026-10-30T12:00:00.000Z", origin: "https://canary.example" });
const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");

/** The content stream of page n (1-based): objects are numbered 7, 8 for page 1, 9, 10 for page 2, ... */
function pageStream(s: string, n: number): string {
  const obj = 8 + (n - 1) * 2;
  const start = s.indexOf(`\n${obj} 0 obj\n`);
  return s.slice(start, s.indexOf("endstream", start));
}

test("PDF: a valid PDF 1.4 file, one cover + one section per document + evidence, the fingerprint on every page", async () => {
  const pack = await buildClaimPack(input(call(NY)));
  const { bytes, pages } = buildClaimPdf({ pack, origin: "https://canary.example" });
  const s = latin1(bytes);
  assert.ok(s.startsWith("%PDF-1.4\n"));
  assert.ok(s.endsWith("%%EOF\n"));
  // page count: the page tree, the page objects and the footers agree
  assert.equal(Number(/\/Count (\d+)/.exec(s)?.[1]), pages);
  assert.equal(s.match(/\/Type \/Page /g)?.length, pages);
  assert.ok(pages >= 1 + pack.docs.length + 1, `pages ${pages}`);
  for (let i = 1; i <= pages; i++) {
    const p = pageStream(s, i);
    assert.ok(p.includes(`(Page ${i} of ${pages})`), `page ${i} number`);
    assert.ok(p.includes(pack.evidence.sha256), `page ${i} fingerprint`);
    assert.ok(p.includes("(Draft prepared with Canary \\227 not legal advice)"), `page ${i} footer`); // em dash, WinAnsi 0x97
  }
  // each document starts its own page, in order
  pack.docs.forEach((d, i) => assert.ok(s.includes(`(DOCUMENT ${i + 1} OF ${pack.docs.length})`), d.title));
  // the cross-reference table points at every object
  const xref = Number(/startxref\n(\d+)/.exec(s)![1]);
  assert.ok(s.startsWith("xref\n", xref));
  const entries = [...s.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  entries.forEach((off, i) => assert.ok(s.startsWith(`${i + 1} 0 obj\n`, off), `object ${i + 1} at ${off}`));
  // the evidence table carries every transaction hash
  for (const p of snap.purchases) assert.ok(s.includes(p.txHash), p.txHash);
});

test("PDF: same pack -> same bytes (fixed creation date), so the PDF has a stable fingerprint", async () => {
  const pack = await buildClaimPack(input(call(NY)));
  const a = buildClaimPdf({ pack, origin: "https://canary.example" });
  const b = buildClaimPdf({ pack: structuredClone(pack), origin: "https://canary.example" });
  assert.deepEqual(a.bytes, b.bytes);
  assert.equal(await pdfSha256(a.bytes), await pdfSha256(b.bytes));
  assert.match(await pdfSha256(a.bytes), /^[0-9a-f]{64}$/);
  assert.ok(latin1(a.bytes).includes("/CreationDate (D:20261030120000Z)"));
  // an edit changes it
  const edited = buildClaimPdf({ pack, texts: { sec: pack.docs[0].body + "\nOne more line." }, origin: "https://canary.example" });
  assert.notEqual(await pdfSha256(edited.bytes), await pdfSha256(a.bytes));
});

test("PDF: cover has the claim summary and the anchor, but not the claimant's name or email", async () => {
  const pack = await buildClaimPack(input(call(NY)));
  const tx = "0x" + "ab".repeat(32);
  const { bytes } = buildClaimPdf({ pack, anchor: { txHash: tx, explorerUrl: `https://sepolia.etherscan.io/tx/${tx}` }, origin: "https://canary.example" });
  const s = latin1(bytes);
  const cover = pageStream(s, 1);
  assert.ok(cover.includes("(Claim pack)"));
  assert.ok(cover.includes("(New York)"));
  assert.ok(cover.includes(pack.evidence.sha256));
  assert.ok(cover.includes(`https://sepolia.etherscan.io/tx/${tx}`));
  assert.ok(cover.includes("https://canary.example/verify"));
  assert.ok(!cover.includes("Sam Taylor") && !cover.includes("sam@example.com"));
  // the drafts themselves still carry what the regulator needs
  assert.ok(s.includes("Name: Sam Taylor"));
});

test("PDF: sources list the case file's and the law table's links, without the transaction links", async () => {
  const uk = call(["I'm in London and I bought EMAX", "Kim Kardashian", "June 2021", WALLET, "£900", "skip", "skip", "yes", "yes", "yes"]);
  const pack = await buildClaimPack(input(uk));
  const ev = JSON.parse(pack.evidence.json).evidence;
  const urls = packSources(pack, pack.docs.map((d) => d.body), ev).map((x) => x.url);
  for (const u of ["https://www.sec.gov/litigation/admin/2022/33-11116.pdf", "https://www.legislation.gov.uk/ukpga/2000/8/section/21", "https://www.reportfraud.police.uk"]) assert.ok(urls.includes(u), u);
  assert.ok(!urls.some((u) => /etherscan\.io\/tx\//.test(u)));
  assert.equal(new Set(urls).size, urls.length);
  const { bytes } = buildClaimPdf({ pack });
  assert.ok(latin1(bytes).includes("\\243900")); // "£900": £ is WinAnsi 0xA3, written as an octal escape
});

test("PDF text: WinAnsi-safe, and long hashes wrap", () => {
  assert.deepEqual(winAnsi("€ – “x” é"), [0x80, 0x20, 0x96, 0x20, 0x93, 0x78, 0x94, 0x20, 0xe9]);
  assert.equal(String.fromCharCode(...winAnsi("₹50,000 ≈ 🔒 ok → done")), "Rs 50,000 ~  ok -> done");
  assert.equal(String.fromCharCode(...winAnsi("Łódź")), "Lódz"); // ó is in WinAnsi; Ł and ź get stand-ins
  const lines = wrap("Transaction: 0x" + "f".repeat(64), "F1", 9.5, 120);
  assert.ok(lines.length > 2);
  assert.equal(lines.join("").replace(/ /g, ""), ("Transaction:0x" + "f".repeat(64)));
});
