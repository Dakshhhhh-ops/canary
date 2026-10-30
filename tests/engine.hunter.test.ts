import assert from "node:assert/strict";
import { test } from "node:test";
import { hunt, scoreCandidate } from "../src/lib/engine/hunter";

const rugged = { symbol: "RUG", claimedMarketCapUsd: 50_000_000, liquidityUsd: 200_000, peakLiquidityUsd: 2_000_000, top10HolderPct: 80, priceRunUpPct: 900, convergingPromoters: 5, independentVoices: 2, undisclosedPaidPosts: 2, evidenceIds: ["e1"] };
const solid = { symbol: "OK", claimedMarketCapUsd: 10_000_000, liquidityUsd: 1_500_000, peakLiquidityUsd: 1_600_000, top10HolderPct: 20, priceRunUpPct: 12, convergingPromoters: 0, independentVoices: 0, undisclosedPaidPosts: 0, evidenceIds: ["e2"] };

test("every rule fires on a rugged token, with raw numbers", () => {
  const v = scoreCandidate(rugged);
  assert.equal(v.selected, true);
  assert.equal(v.score, v.maxScore);
  const depth = v.rules.find((r) => r.id === "liquidity-depth")!;
  assert.equal(depth.value, 0.4); // 200k / 50M
  assert.equal(depth.outcome, "red-flag");
  assert.equal(v.rules.find((r) => r.id === "liquidity-drop")!.value, 90);
  assert.match(v.rules.find((r) => r.id === "undisclosed-paid")!.explanation, /17\(b\)/);
});

test("selected and rejected are both explained rule by rule", () => {
  const r = hunt([solid, rugged]);
  assert.deepEqual(r.selected.map((v) => v.symbol), ["RUG"]);
  assert.deepEqual(r.rejected.map((v) => v.symbol), ["OK"]);
  const ok = r.rejected[0];
  assert.equal(ok.score, 0);
  assert.equal(ok.rules.length, 6);
  assert.ok(ok.rules.every((x) => x.outcome === "clear" && x.explanation.length > 10));
  assert.match(ok.explanation, /rejected/);
});

test("missing data is unknown, never a pass or a fail", () => {
  const v = scoreCandidate({ symbol: "NODATA", evidenceIds: [] });
  assert.equal(v.score, 0);
  assert.equal(v.unknownCount, 6);
  assert.ok(v.rules.every((r) => r.outcome === "unknown" && r.value === null));
  assert.match(v.explanation, /Not checked for lack of data/);
});

test("thresholds are user-tunable", () => {
  const r = hunt([solid], { maxTop10HolderPct: 10, selectThreshold: 2 });
  assert.equal(r.selected[0]?.symbol, "OK");
});
