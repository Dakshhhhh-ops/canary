// Paper ledger across runs: open on ACCEPTED trades, mark to market, close at stop / take-profit / expiry,
// honour the daily circuit breaker, and keep the whole history in a verifiable hash chain.
import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyLedger, lossOnDay, replayLedger, updateLedger, verifyLedger, type LedgerFile } from "../src/lib/engine/ledger";
import { runLive, type LiveRun } from "../src/lib/engine/pipeline";
import { stepClock } from "../src/lib/engine/trail";
import { hankoReplayClient, HANKO_SYMBOLS } from "../src/lib/radar/replay";
import { analyzeA, client, deepA, server, withHolders } from "./fixtures/ryo/server";

/**
 * A live run at time `at` where each coin trades at the given price. Payload shapes are hanko's recorded
 * analyze_token / deep_analysis ones with the price swapped in; holders are a TEST-ONLY addition (18%).
 */
async function runAt(at: string, prices: Record<string, number | null>, limits = {}): Promise<LiveRun> {
  const analyze: Record<string, unknown> = {};
  const deep: Record<string, unknown> = {};
  for (const [s, p] of Object.entries(prices)) {
    if (p === null) continue;
    analyze[s] = withHolders({ ...analyzeA(), price_usd: p }, 18);
    deep[s] = deepA();
  }
  const clock = stepClock(at);
  return runLive(Object.keys(prices), { ryo: client(server({ analyze_token: analyze, deep_analysis: deep }), clock), llm: null, clock, limits });
}

const apply = async (l: LedgerFile | null, run: LiveRun, file: string, expiryDays?: number) => (await updateLedger(l, { run, runFile: file, trigger: "schedule", clock: stepClock(run.startedAt, 10), expiryDays })).file;

test("accepted trades open positions; later runs mark them; stop and take-profit close them", async () => {
  let l = await apply(null, await runAt("2026-10-30T00:00:00Z", { AAA: 1.25, BBB: 2 }), "r1.json");
  assert.equal(l.state.positions.length, 2);
  const a = l.state.positions.find((p) => p.symbol === "AAA")!;
  assert.deepEqual([a.entryPriceUsd, a.sizeUsd, a.stopPriceUsd, a.takeProfitPriceUsd], [1.25, 750, 1, 1.75]);
  assert.equal(a.qty, 600);
  assert.equal(a.expiresAt, "2026-11-06T00:00:00.000Z");
  assert.equal(a.runFile, "r1.json");
  assert.ok(a.riskEntryHash.length === 64 && a.evidenceIds.includes("market:AAA"));

  // 4 hours later: AAA up a bit (mark), BBB through its stop at 1.6 → sold at the observed 1.5
  l = await apply(l, await runAt("2026-10-30T04:00:00Z", { AAA: 1.5, BBB: 1.5 }), "r2.json");
  const marked = l.state.positions.find((p) => p.symbol === "AAA")!;
  assert.equal(marked.lastPriceUsd, 1.5);
  assert.equal(marked.unrealisedUsd, 150);
  const stopped = l.state.closed.find((c) => c.symbol === "BBB")!;
  assert.equal(stopped.reason, "stop");
  assert.equal(stopped.exitPriceUsd, 1.5);
  assert.equal(stopped.pnlUsd, -187.5, "gapped below the stop: bigger loss than the planned $150");
  assert.match(stopped.note, /below the stop/);
  // BBB was re-accepted by run 2 at 1.5 and re-opened (its old position closed first)
  assert.equal(l.state.positions.filter((p) => p.symbol === "BBB").length, 1);

  // AAA through take-profit at 1.75 → sold AT the take-profit, not the higher observed price
  l = await apply(l, await runAt("2026-10-30T08:00:00Z", { AAA: 1.9 }), "r3.json");
  const tp = l.state.closed.find((c) => c.symbol === "AAA")!;
  assert.equal(tp.reason, "take-profit");
  assert.equal(tp.exitPriceUsd, 1.75);
  assert.equal(tp.pnlUsd, 300);
  // run 3 accepted AAA again at 1.9: one new position
  assert.equal(l.state.positions.find((p) => p.symbol === "AAA")!.entryPriceUsd, 1.9);

  assert.equal(l.state.totals.realisedUsd, 112.5);
  assert.equal(l.state.totals.wins, 1);
  assert.equal(l.state.totals.losses, 1);
  assert.equal(l.state.runs.length, 3);
  assert.deepEqual(l.state.runs.map((r) => r.trigger), ["schedule", "schedule", "schedule"]);
  assert.deepEqual((await verifyLedger(l)).ok, true);
});

test("a position is not doubled, a missing price is recorded, and expiry closes after 7 days", async () => {
  let l = await apply(null, await runAt("2026-10-30T00:00:00Z", { AAA: 1.25 }), "r1.json");
  l = await apply(l, await runAt("2026-10-30T04:00:00Z", { AAA: 1.3 }), "r2.json");
  assert.equal(l.state.positions.length, 1);
  assert.ok(l.trail.some((e) => e.kind === "ledger.skip" && /already holding/.test(e.summary)));

  l = await apply(l, await runAt("2026-10-31T00:00:00Z", { AAA: null, CCC: 3 }), "r3.json");
  assert.ok(l.trail.some((e) => e.kind === "ledger.no-price" && /AAA: no price/.test(e.summary)));
  assert.equal(l.state.positions.find((p) => p.symbol === "AAA")!.lastPriceUsd, 1.3, "unmarked, not guessed");

  // a run that does not look at AAA leaves it alone (no noise)
  const before = l.trail.length;
  l = await apply(l, await runAt("2026-11-01T00:00:00Z", { CCC: 3.1 }), "r4.json");
  assert.ok(!l.trail.slice(before).some((e) => (e.data as { symbol?: string }).symbol === "AAA" || String((e.data as { id?: string }).id).startsWith("AAA")));

  l = await apply(l, await runAt("2026-11-06T00:00:00Z", { AAA: 1.2 }), "r5.json");
  const ex = l.state.closed.find((c) => c.symbol === "AAA")!;
  assert.equal(ex.reason, "expiry");
  assert.equal(ex.pnlUsd, -30);
  assert.equal((await verifyLedger(l)).ok, true);
});

test("daily circuit breaker: once today's realised losses reach the limit, accepted trades are not opened", async () => {
  // two positions; both stop out the same day for -$187.50 each = -$375 ≥ $300
  let l = await apply(null, await runAt("2026-10-30T00:00:00Z", { AAA: 1.25, BBB: 1.25 }), "r1.json");
  // the run itself was told nothing was lost yet, so it accepts DDD; the ledger closes AAA/BBB first, then refuses to open DDD
  const r2 = await runAt("2026-10-30T04:00:00Z", { AAA: 0.9375, BBB: 0.9375, DDD: 2 });
  assert.equal(r2.perSymbol.find((p) => p.symbol === "DDD")!.trade.decision, "accepted");
  l = await apply(l, r2, "r2.json");
  assert.equal(lossOnDay(l.state, "2026-10-30"), 375);
  assert.ok(!l.state.positions.some((p) => p.symbol === "DDD"));
  const br = l.trail.find((e) => e.kind === "ledger.breaker" && /DDD/.test(e.summary));
  assert.ok(br);
  assert.match(br!.summary, /circuit breaker — \$375\.00 already lost today/);

  // the next run that day is told the loss up front, so the risk desk itself refuses
  const r3 = await runAt("2026-10-30T08:00:00Z", { DDD: 2 });
  const r3b = await runLive(["DDD"], { llm: null, ryo: client(server({ analyze_token: { DDD: withHolders({ ...analyzeA(), price_usd: 2 }, 18) }, deep_analysis: { DDD: deepA() } }), stepClock("2026-10-30T08:00:00Z")), clock: stepClock("2026-10-30T08:00:00Z"), lossTodayUsd: lossOnDay(l.state, "2026-10-30") });
  assert.equal(r3.perSymbol[0].trade.decision, "accepted");
  assert.equal(r3b.perSymbol[0].trade.decision, "refused");
  assert.match(r3b.perSymbol[0].trade.reasons.join(" "), /Circuit breaker/);

  // a new UTC day: the breaker resets
  l = await apply(l, await runAt("2026-10-31T00:00:00Z", { DDD: 2 }), "r4.json");
  assert.ok(l.state.positions.some((p) => p.symbol === "DDD"));
});

test("the ledger trail verifies, and tampering anywhere is caught", async () => {
  let l = await apply(null, await runAt("2026-10-30T00:00:00Z", { AAA: 1.25 }), "r1.json");
  l = await apply(l, await runAt("2026-10-30T04:00:00Z", { AAA: 1.1 }), "r2.json");
  const ok = await verifyLedger(l);
  assert.equal(ok.ok, true);

  // 1. edit a number in the stored state only: the replay no longer matches
  const s1 = structuredClone(l);
  s1.state.totals.unrealisedUsd = 999;
  const v1 = await verifyLedger(s1);
  assert.equal(v1.ok, false);
  if (!v1.ok) assert.match(v1.reason, /do not match what the ledger trail adds up to/);

  // 2. edit an entry in the trail: the chain breaks at that entry
  const s2 = structuredClone(l);
  (s2.trail[1].data as { entryPriceUsd: number }).entryPriceUsd = 0.5;
  const v2 = await verifyLedger(s2);
  assert.equal(v2.ok, false);
  if (!v2.ok) assert.match(v2.reason, /broken at entry 1/);

  // 3. drop an entry: caught too, and updateLedger refuses to build on a broken history
  const s3 = structuredClone(l);
  s3.trail.splice(2, 1);
  assert.equal((await verifyLedger(s3)).ok, false);
  await assert.rejects(apply(s3, await runAt("2026-10-30T08:00:00Z", { AAA: 1.2 }), "r3.json"), /does not verify/);

  // state is a pure function of the trail
  assert.deepEqual(replayLedger(l.trail), l.state);
});

test("recorded-fixture runs can never touch the ledger", async () => {
  const r = await runLive(HANKO_SYMBOLS, { ryo: hankoReplayClient(), llm: null, mode: "recorded-fixture" });
  await assert.rejects(updateLedger(emptyLedger("2026-10-30T00:00:00Z"), { run: r, runFile: "x.json", trigger: "ui" }), /only live runs/);
});
