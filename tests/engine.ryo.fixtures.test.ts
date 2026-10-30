// Accepting vs refusing practice trades on hanko's recorded RYO payload shapes (tests/fixtures/ryo/hanko.json).
// A trade is ACCEPTED only when the data is good: liquidity above the minimum, holder concentration known
// and under the limit, no undisclosed paid promotion, and a clean entry/stop/take-profit plan.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runLive } from "../src/lib/engine/pipeline";
import { DEFAULT_LIMITS, planAtPrice } from "../src/lib/engine/risk";
import { stepClock, verifyTrail } from "../src/lib/engine/trail";
import { hankoReplayClient, HANKO_SYMBOLS } from "../src/lib/radar/replay";
import { analyzeA, client, deepA, server, thinC, withHolders } from "./fixtures/ryo/server";

const clock = () => stepClock("2026-10-30T00:00:00Z");

test("hanko's fixtures exactly as published: each coin decided for its real reason", async () => {
  const r = await runLive(HANKO_SYMBOLS, { ryo: hankoReplayClient(clock()), llm: null, clock: clock(), mode: "recorded-fixture" });
  assert.equal(r.mode, "recorded-fixture");
  const by = Object.fromEntries(r.perSymbol.map((p) => [p.symbol, p.trade]));
  // TOKENA has price and a deep pool, but no holder figure exists in RYO's tools: by default it trades at half size, and says so
  assert.equal(by.TOKENA.decision, "accepted", by.TOKENA.reasons.join(" | "));
  assert.ok(by.TOKENA.sizeUsd <= 500);
  assert.match(by.TOKENA.checks.find((c) => c.limit === "maxTop10HolderPct")!.reason, /only half size/);
  // with the strict rule it is refused rather than guessed
  const strict = await runLive(["TOKENA"], { ryo: hankoReplayClient(clock()), llm: null, clock: clock(), mode: "recorded-fixture", limits: { unknownHolders: "refuse" } });
  assert.equal(strict.perSymbol[0].trade.decision, "refused");
  assert.deepEqual(strict.perSymbol[0].trade.checks.filter((c) => !c.ok).map((c) => c.limit), ["maxTop10HolderPct"]);
  // TOKENB: $150k pool; TOKENC: $25k pool — below the $250k minimum
  for (const s of ["TOKENB", "TOKENC"]) {
    assert.equal(by[s].decision, "refused");
    assert.ok(by[s].checks.some((c) => c.limit === "minLiquidityUsd" && !c.ok));
  }
  assert.match(by.TOKENC.reasons.join(" "), /Only \$25\.0k of liquidity/);
  // hanko's ryo_failed.json (429) becomes a recorded gap, not a number
  assert.ok(r.gaps.some((g) => g.source === "ryo:market_overview" && /rate limited \(429\)/.test(g.reason)));
  assert.equal((await verifyTrail(r.trail)).ok, true);
});

test("a liquid major passes: hanko's TOKENA payloads + a known holder figure → ACCEPTED and logged", async () => {
  // analyze_token = hanko ryo_analyze_tokena payload, deep_analysis = hanko ryo_deep_analysis_tokena payload.
  // TEST-ONLY: top10_holder_pct added (RYO publishes no holder field; see tests/fixtures/ryo/server.ts).
  const routes = server({ analyze_token: { TOKENA: withHolders(analyzeA(), 18) }, deep_analysis: { TOKENA: deepA() } });
  const r = await runLive(["TOKENA"], { ryo: client(routes), llm: null, clock: clock() });
  const t = r.perSymbol[0].trade;
  assert.equal(t.decision, "accepted", t.reasons.join(" | "));
  assert.ok(t.checks.every((c) => c.ok));
  // one decision: entry, size, stop and take-profit together
  assert.equal(t.plan.entryPriceUsd, 1.25);
  assert.equal(t.plan.stopPriceUsd, 1);
  assert.equal(t.plan.exitPriceUsd, 1.75);
  assert.equal(t.plan.sizeUsd, 750, "half the $300 daily budget at a 20% stop, under the $1000 cap");
  assert.equal(t.worstCaseLossUsd, 150);
  const risk = r.trail.find((e) => e.kind === "risk.accepted");
  assert.ok(risk, "the accepted trade is in the trail");
  assert.equal(risk!.hash, r.perSymbol[0].riskEntryHash);
  assert.match(risk!.summary, /TOKENA: practice trade accepted — buy \$750\.00 at \$1\.25, stop \$1\.00, take profit \$1\.75/);
  assert.equal(r.trailOk, true);
});

test("hanko's documented live envelope (price under data.market) is read the same way", async () => {
  // per hanko/ryotools/facts.py: "analyze_token nests price and volume under data.market"
  const nested = { schema_version: "1", status: "ok", data_mode: "live", data: { market: withHolders(analyzeA(), 18) } };
  const r = await runLive(["TOKENA"], { ryo: client(server({ analyze_token: { TOKENA: nested }, deep_analysis: { TOKENA: deepA() } })), llm: null, clock: clock() });
  assert.equal(r.facts[0].found.priceUsd, "analyze_token:data.market.price_usd");
  assert.equal(r.perSymbol[0].trade.decision, "accepted");
});

test("a thin memecoin is refused for its pool alone, even with holders known", async () => {
  // hanko market_tokenc_thin.json ($25k pool) served as the analyze_token reply; TEST-ONLY holder figure added
  const r = await runLive(["TOKENC"], { ryo: client(server({ analyze_token: { TOKENC: withHolders(thinC(), 18) } })), llm: null, clock: clock() });
  const t = r.perSymbol[0].trade;
  assert.equal(t.decision, "refused");
  assert.deepEqual(t.checks.filter((c) => !c.ok).map((c) => c.limit), ["minLiquidityUsd"]);
  assert.match(t.reasons[0], /Only \$25\.0k of liquidity, below your \$250\.0k minimum/);
});

test("too concentrated, user limits, and the daily circuit breaker each refuse with their own reason", async () => {
  const good = () => server({ analyze_token: { TOKENA: withHolders(analyzeA(), 62) }, deep_analysis: { TOKENA: deepA() } });
  const conc = await runLive(["TOKENA"], { ryo: client(good()), llm: null, clock: clock() });
  assert.deepEqual(conc.perSymbol[0].trade.checks.filter((c) => !c.ok).map((c) => c.limit), ["maxTop10HolderPct"]);
  // the user loosens the holder limit to 70%: now it passes
  const loose = await runLive(["TOKENA"], { ryo: client(good()), llm: null, clock: clock(), limits: { maxTop10HolderPct: 70 } });
  assert.equal(loose.perSymbol[0].trade.decision, "accepted");
  // ...and raises the pool minimum above $900k: refused again
  const strict = await runLive(["TOKENA"], { ryo: client(good()), llm: null, clock: clock(), limits: { maxTop10HolderPct: 70, minLiquidityUsd: 1_000_000 } });
  assert.deepEqual(strict.perSymbol[0].trade.checks.filter((c) => !c.ok).map((c) => c.limit), ["minLiquidityUsd"]);
  // the ledger already lost $300 today: breaker
  const tripped = await runLive(["TOKENA"], { ryo: client(good()), llm: null, clock: clock(), limits: { maxTop10HolderPct: 70 }, lossTodayUsd: 300 });
  const t = tripped.perSymbol[0].trade;
  assert.equal(t.decision, "refused");
  assert.match(t.reasons.join(" "), /Circuit breaker/);
  // a wider stop changes the size so the worst case stays inside the budget
  const wide = await runLive(["TOKENA"], { ryo: client(good()), llm: null, clock: clock(), limits: { maxTop10HolderPct: 70 }, dip: { stopPct: 25 } });
  assert.equal(wide.perSymbol[0].trade.plan.sizeUsd, 600);
  assert.equal(wide.perSymbol[0].trade.decision, "accepted");
});

test("planAtPrice: no price means an empty plan the desk must refuse", () => {
  const p = planAtPrice("X", null, "2026-10-30T00:00:00Z", DEFAULT_LIMITS);
  assert.equal(p.sizeUsd, 0);
  const q = planAtPrice("X", 2, "2026-10-30T00:00:00Z", DEFAULT_LIMITS, { change24hPct: -7.5 });
  assert.match(q.rationale, /down 7\.5% over 24 hours \(a dip\)/);
});
