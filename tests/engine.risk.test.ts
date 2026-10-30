import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LIMITS, evaluatePlan, hindsight, PaperLedger, planDip } from "../src/lib/engine/risk";
import { stepClock } from "../src/lib/engine/trail";
import type { MarketSnapshot, TradePlan } from "../src/lib/engine/types";
import { loadFixture } from "./fixtures/load";

const plan = (over: Partial<TradePlan> = {}): TradePlan => ({ symbol: "T", side: "buy", at: "2024-01-01", entryPriceUsd: 1, sizeUsd: 500, stopPriceUsd: 0.8, exitPriceUsd: 1.4, rationale: "", evidenceIds: [], ...over });
const clean: MarketSnapshot = { liquidityUsd: 1_000_000, top10HolderPct: 30, undisclosedPaidPromotion: false };

test("a clean plan within every limit is accepted", () => {
  const d = evaluatePlan(plan(), clean, DEFAULT_LIMITS);
  assert.equal(d.decision, "accepted");
  assert.equal(d.worstCaseLossUsd, 100);
});

test("each limit refuses with a plain-words reason", () => {
  const cases: [Partial<TradePlan>, Partial<MarketSnapshot>, RegExp][] = [
    [{ sizeUsd: 5000 }, {}, /more than your \$1\.0k maximum/],
    [{}, { liquidityUsd: 10_000 }, /below your \$250\.0k minimum/],
    [{}, { liquidityUsd: null }, /Liquidity is unknown/],
    [{}, { top10HolderPct: 90 }, /90% of the supply/],
    [{}, { top10HolderPct: null }, /holds the supply is unknown/],
    [{}, { undisclosedPaidPromotion: true }, /paid and did not say so/],
    [{ stopPriceUsd: 0.5 }, {}, /50% below the entry/],
    [{ stopPriceUsd: 1.2 }, {}, /not a complete decision/],
  ];
  for (const [p, m, re] of cases) {
    // "refuse" makes the unknown-holder case strict; the default (half size) is tested below
    const d = evaluatePlan(plan(p), { ...clean, ...m }, { ...DEFAULT_LIMITS, unknownHolders: "refuse" });
    assert.equal(d.decision, "refused", String(re));
    assert.ok(d.reasons.some((r) => re.test(r)), `${re} in ${d.reasons.join(" | ")}`);
  }
});

test("unknown holders: by default the trade goes ahead at half the maximum size, and says so", () => {
  const d = evaluatePlan(plan({ sizeUsd: 1000 }), { ...clean, top10HolderPct: null }, DEFAULT_LIMITS);
  assert.equal(d.decision, "accepted", d.reasons.join(" | "));
  assert.ok(d.plan.sizeUsd <= DEFAULT_LIMITS.maxPositionUsd / 2);
  assert.match(d.checks.find((c) => c.limit === "maxTop10HolderPct")!.reason, /only half size/);
  assert.match(d.plan.rationale, /Size halved/);
});

test("daily loss circuit breaker trips after losses, resets the next day", () => {
  const ledger = new PaperLedger({ ...DEFAULT_LIMITS, dailyLossLimitUsd: 150 }, stepClock("2024-01-01T09:00:00Z"));
  assert.equal(ledger.propose(plan(), clean).decision, "accepted");
  assert.deepEqual(ledger.close("T", 0.7, "2024-01-01T10:00:00Z"), { pnlUsd: -150 });
  const d = ledger.propose(plan({ sizeUsd: 100 }), clean);
  assert.equal(d.decision, "refused");
  assert.match(d.reasons.join(" "), /Circuit breaker/);
  assert.equal(ledger.propose(plan({ at: "2024-01-02", sizeUsd: 100 }), clean).decision, "accepted");
});

test("buy-the-dip plan is one decision: entry, size, stop, exit — and hindsight shows the gap", () => {
  const prices = loadFixture().prices;
  const p = planDip("FMAX", prices, DEFAULT_LIMITS)!;
  assert.equal(p.at, "2021-06-11");
  assert.ok(p.stopPriceUsd < p.entryPriceUsd && p.exitPriceUsd > p.entryPriceUsd);
  assert.equal(p.sizeUsd, 750); // half of the $300 daily budget at a 20% stop
  const h = hindsight(p, prices)!;
  assert.ok(h.pnlUsd < -150, "a daily-close stop fills below its level on a gap");
  assert.match(h.note, /gapped through the stop/);
});
