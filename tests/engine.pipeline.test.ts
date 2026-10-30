import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { factGuard } from "../src/lib/engine/debate";
import { checkClaim, inferDirection } from "../src/lib/engine/news";
import { caseRunStream, runCase } from "../src/lib/engine/pipeline";
import { stepClock, verifyTrail } from "../src/lib/engine/trail";
import type { StepEvent } from "../src/lib/engine/types";
import type { CaseFile } from "../src/lib/types";
import { loadFixture } from "./fixtures/load";

const opts = () => ({ llm: null, clock: stepClock("2026-10-30T00:00:00Z") });

test("news: a promoter claim that rose for days then collapsed", () => {
  const cf = loadFixture();
  const n = checkClaim({ id: "post-a", text: "buy $FMAX 🚀", at: "2021-06-03T18:00:00Z" }, cf.prices);
  assert.equal(n.direction, "up");
  assert.equal(n.shortVerdict, "supported");
  assert.equal(n.verdict, "contradicted");
  assert.ok(n.effect.longChangePct! < -80);
  assert.match(n.explanation, /not proof/);
  assert.ok(n.evidenceIds.includes("post-a") && n.evidenceIds.some((id) => id.startsWith("price:")));
  assert.equal(checkClaim({ id: "x", text: "watching", at: "2021-04" }, cf.prices).verdict, "insufficient-data");
  assert.equal(inferDirection("this will crash"), "down");
});

test("runCase on the fixture (no model): deterministic, verified, refused, pump-and-dump", async () => {
  const cf = loadFixture();
  const steps: StepEvent[] = [];
  const a = await runCase(cf, { ...opts(), onStep: (e) => void steps.push(e) });
  const b = await runCase(cf, opts());
  assert.deepEqual(a.trail, b.trail, "identical inputs, identical trail");
  assert.equal(a.headHash, b.headHash);
  assert.equal(a.trailOk, true);
  assert.equal((await verifyTrail(a.trail)).ok, true);

  assert.deepEqual(a.trail.map((e) => e.agent), ["collector", "convergence", "news", "hunter", "collapse", "bull", "bear", "judge", "risk", "claims"]);
  assert.deepEqual(steps.map((s) => s.entry.seq), a.trail.map((e) => e.seq), "every step was streamed in order");

  assert.equal(a.convergence.detected, true);
  assert.equal(a.hunter.selected[0].symbol, "FMAX");
  assert.equal(a.collapse.detected, true);
  assert.equal(a.debate.judge.verdict, "pump-and-dump");
  assert.equal(a.trade.decision, "refused");
  assert.ok(a.trade.reasons.some((r) => /paid and did not say so/.test(r)));
  assert.ok(a.trade.hindsight && a.trade.hindsight.pnlUsd < 0);
  assert.ok(a.gaps.some((g) => g.source === "case.marketCap"));

  // both sides argued from the same bundle, and every claim survives the fact guard
  assert.equal(a.debate.bundleHash, a.bundle.hash);
  for (const s of [a.debate.bull, a.debate.bear]) assert.equal(factGuard(s.side, s.claims, a.bundle).rejected.length, 0);
});

test("tampering with a finished run's trail is detected", async () => {
  const r = await runCase(loadFixture(), opts());
  const forged = structuredClone(r.trail);
  (forged[7].data as { verdict: string }).verdict = "no-signal";
  const v = await verifyTrail(forged);
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.seq, 7);
});

test("hunter selects the case token and rejects a clean comparison token", async () => {
  const r = await runCase(loadFixture(), { ...opts(), compareWith: [{ symbol: "CLEAN", liquidityUsd: 5e6, peakLiquidityUsd: 5.2e6, claimedMarketCapUsd: 5e7, top10HolderPct: 15, priceRunUpPct: 8, convergingPromoters: 0, independentVoices: 0, undisclosedPaidPosts: 0, evidenceIds: [] }] });
  assert.deepEqual(r.hunter.selected.map((v) => v.symbol), ["FMAX"]);
  assert.deepEqual(r.hunter.rejected.map((v) => v.symbol), ["CLEAN"]);
});

test("SSE stream: step events then done", async () => {
  const text = await new Response(caseRunStream(loadFixture(), opts())).text();
  const events = text.trim().split("\n\n").map((b) => b.split("\n")[0].replace("event: ", ""));
  assert.equal(events.filter((e) => e === "step").length, 10);
  assert.equal(events[events.length - 1], "done");
  const done = JSON.parse(text.trim().split("\n\n").pop()!.split("\n")[1].slice(6));
  assert.equal(done.trailOk, true);
});

// Runs only once the real case file exists (another agent is producing it).
const emax = join(__dirname, "..", "data", "cases", "emax.json");
test("real case file data/cases/emax.json, if present, runs and verifies", { skip: !existsSync(emax) }, async () => {
  const cf = JSON.parse(readFileSync(emax, "utf8")) as CaseFile;
  const r = await runCase(cf, opts());
  assert.equal(r.trailOk, true);
  assert.equal(r.trail.length, 10);
});
