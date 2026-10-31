// Every real case listed in src/lib/caseIndex.ts: its case file loads and holds its invariants, and its
// frozen notebook (data/notebooks/<slug>.json) verifies and is exactly what the agents produce today.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CASE_INDEX, caseMeta } from "../src/lib/caseIndex";
import { detectConvergence } from "../src/lib/engine/convergence";
import { runCase } from "../src/lib/engine/pipeline";
import { stepClock, verifyTrail } from "../src/lib/engine/trail";
import { documentedBy, toHotlineCase } from "../src/lib/hotline/caseFacts";
import type { CaseFile } from "../src/lib/types";

const root = join(__dirname, "..");
const load = (slug: string) => JSON.parse(readFileSync(join(root, "data", "cases", `${slug}.json`), "utf8")) as CaseFile;
const isAddr = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);
const isDate = (s: string) => /^\d{4}-\d{2}(-\d{2}(T[\d:.]+Z)?)?$/.test(s);

test("the case index lists emax and saitama, each with a case file and a sources file", () => {
  assert.deepEqual(
    CASE_INDEX.map((c) => c.slug),
    ["emax", "saitama"],
  );
  for (const { slug } of CASE_INDEX) {
    assert.ok(existsSync(join(root, "data", "cases", `${slug}.json`)), `${slug}.json`);
    assert.ok(existsSync(join(root, "data", "cases", `${slug}.sources.md`)), `${slug}.sources.md`);
  }
  assert.equal(caseMeta("nope"), null);
});

for (const { slug } of CASE_INDEX) {
  test(`${slug}: case file holds its invariants`, () => {
    const c = load(slug);
    assert.equal(c.slug, slug);
    assert.equal(c.token.chain, "ethereum");
    assert.ok(isAddr(c.token.address) && (!c.token.pair || isAddr(c.token.pair)));
    assert.ok(c.window.pumpStart <= c.window.peak && c.window.peak <= c.window.collapse);
    assert.ok(c.prices.length > 30);
    for (let i = 1; i < c.prices.length; i++) assert.ok(c.prices[i].t > c.prices[i - 1].t, `price order at ${i}`);
    const at = (t: string) => c.prices.find((p) => p.t === t);
    assert.equal(at(c.peak.t)?.priceUsd, c.peak.priceUsd, "peak is in the series");
    assert.equal(at(c.collapse.t)?.priceUsd, c.collapse.priceUsd, "collapse is in the series");
    assert.ok(c.prices.every((p) => p.priceUsd === null || p.priceUsd <= c.peak.priceUsd), "peak is the max");
    assert.ok(Math.abs(c.collapse.dropPct - (1 - c.collapse.priceUsd / c.peak.priceUsd) * 100) < 0.05);
    assert.equal(new Set(c.posts.map((p) => p.id)).size, c.posts.length, "unique post ids");
    for (const p of c.posts) {
      assert.ok(isDate(p.postedAt), p.id);
      assert.ok(p.sources.length > 0 && p.sources.every((s) => s.label && s.url), `${p.id} has sources`);
      assert.ok(p.disclosedPayment === null || typeof p.disclosedPayment === "boolean");
    }
    for (const l of c.legal) assert.ok(isDate(l.date) && l.sources.length > 0, l.id);
    if (c.buyersInWindow) for (const s of c.buyersInWindow.sample) assert.ok(isAddr(s.address) && /^0x[0-9a-f]{64}$/.test(s.txHash));
    assert.ok(c.dataNotes.length > 0 && c.sources.length > 0);
  });

  test(`${slug}: frozen notebook verifies and matches a fresh run of the agents`, async () => {
    const nb = JSON.parse(readFileSync(join(root, "data", "notebooks", `${slug}.json`), "utf8"));
    assert.equal(nb.format, "canary.notebook/1");
    assert.equal(nb.slug, slug);
    const check = await verifyTrail(nb.trail);
    assert.equal(check.ok, true, JSON.stringify(check));
    assert.equal(nb.trail.at(-1).hash, nb.headHash);
    const run = await runCase(load(slug), { llm: null, clock: stepClock("2026-10-30T00:00:00.000Z") });
    assert.equal(run.trailOk, true);
    assert.equal(run.headHash, nb.headHash, "the frozen notebook is what the agents produce from the case file today");
    assert.equal(run.debate.judge.verdict, nb.verdict);
  });
}

test("saitama: every post is quoted from the SEC complaint, and the team counts as one voice", () => {
  const c = load("saitama");
  for (const p of c.posts) {
    assert.ok(p.sources.some((s) => s.url === "https://www.sec.gov/files/litigation/complaints/2024/comp-pr2024-166-saitama.pdf"), p.id);
    assert.equal(documentedBy(p), "SEC complaint (an allegation)");
    assert.equal(p.disclosedPayment, null, "insiders, not paid promoters: payment disclosure is not the theory");
    assert.ok(p.affiliation, p.id);
  }
  const conv = detectConvergence(c.posts, { tokenOf: "SAITAMA", windowHours: 14 * 24 });
  assert.equal(conv.detected, true);
  const ev = conv.events[0];
  assert.ok(ev.promoters.length >= 3);
  assert.equal(ev.independentVoices, 1, "officers of one company are one voice");
  assert.equal(ev.coordinated, true);
  assert.ok(ev.echoLinks.every((l) => l.reason === "same-team"));
});

test("emax: posts carry no affiliation, so the new same-team rule changes nothing there", () => {
  const c = load("emax");
  assert.ok(c.posts.every((p) => p.affiliation === undefined));
  const ev = detectConvergence(c.posts, { tokenOf: "EMAX", windowHours: 14 * 24 }).events[0];
  assert.ok(ev.echoLinks.every((l) => l.reason !== "same-team"));
});

test("hotline view of saitama starts its log search at the pair's creation block", () => {
  const k = toHotlineCase(load("saitama"));
  assert.equal(k.pairCreatedBlock, 12535727);
  assert.equal(k.classAction, null);
  assert.equal(toHotlineCase(load("emax")).pairCreatedBlock, 12503000);
});
