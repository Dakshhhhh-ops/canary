// /api/radar: limits are validated and clamped server-side; bad input is a 400; the recorded-fixture
// replay is labelled as such; saved runs are served read-only with no key.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { GET } from "../src/app/api/radar/route";
import { runLive } from "../src/lib/engine/pipeline";
import { DEFAULT_LIMITS } from "../src/lib/engine/risk";
import { stepClock } from "../src/lib/engine/trail";
import { DEFAULT_VALUES, limitsQuery, parseLimits } from "../src/lib/radar/limits";
import { saveRun } from "../src/lib/radar/store";
import { analyzeA, client, deepA, server, withHolders } from "./fixtures/ryo/server";

const get = (qs: string, ip = "203.0.113.9") => GET(new Request(`http://local/api/radar?${qs}`, { headers: { "x-forwarded-for": ip } }));

test("parseLimits: defaults, clamping with a note, and errors for non-numbers", () => {
  const d = parseLimits(new URLSearchParams(""));
  assert.deepEqual(d.limits, DEFAULT_LIMITS);
  assert.equal(d.stopPct, 20);
  assert.deepEqual([d.notes, d.errors], [[], []]);

  const c = parseLimits(new URLSearchParams("maxPositionUsd=1e9&minLiquidityUsd=5&maxTop10HolderPct=101&stopPct=60&dailyLossLimitUsd=0"));
  assert.deepEqual(c.errors, ["maxPositionUsd must be a number"], "1e9 is not accepted as a plain number");
  assert.equal(c.limits.minLiquidityUsd, 10_000);
  assert.equal(c.limits.maxTop10HolderPct, 100);
  assert.equal(c.stopPct, 25, "the stop may not be wider than the published 25% drawdown limit");
  assert.equal(c.limits.dailyLossLimitUsd, 10);
  assert.equal(c.notes.length, 4);
  assert.equal(c.limits.maxDrawdownPct, 25, "not user-adjustable");
  assert.equal(c.limits.refuseUndisclosedPaidPromotion, true, "not user-adjustable");

  const ok = parseLimits({ maxPositionUsd: 500, stopPct: "10" });
  assert.equal(ok.limits.maxPositionUsd, 500);
  assert.equal(ok.stopPct, 10);
  assert.equal(parseLimits({ stopPct: "ten" }).errors[0], "stopPct must be a number");
  assert.equal(limitsQuery(DEFAULT_VALUES), "");
  assert.equal(limitsQuery({ ...DEFAULT_VALUES, stopPct: 12 }), "&stopPct=12");
});

test("route: bad requests are 400 before any work is done", async () => {
  for (const [qs, re] of [
    ["symbols=ETH&maxPositionUsd=lots", /maxPositionUsd must be a number/],
    ["replay=somebody", /only recorded sample is replay=hanko/],
    ["symbols=", /one to five token symbols/],
  ] as const) {
    const r = await get(qs, "198.51.100.1");
    assert.equal(r.status, 400, qs);
    assert.match((await r.json()).error, re);
  }
  const nf = await get("run=..%2F..%2Fpackage.json");
  assert.equal(nf.status, 404);
});

test("route: the hanko replay streams a recorded-fixture run, with clamped limits applied", async () => {
  const r = await get("replay=hanko&minLiquidityUsd=20000&stopPct=99&unknownHolders=refuse", "198.51.100.2");
  assert.equal(r.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const text = await r.text();
  const done = JSON.parse(text.trim().split("\n\n").pop()!.split("\n")[1].slice(6));
  assert.equal(done.mode, "recorded-fixture");
  assert.equal(done.saved, null, "never saved");
  assert.equal(done.limits.minLiquidityUsd, 20000);
  assert.equal(done.stopPct, 25);
  assert.equal(done.limits.unknownHolders, "refuse");
  assert.match(done.notes.join(" "), /Stop-loss distance 99 was outside 2–25 and was set to 25/);
  // with a $20k minimum, TOKENB ($150k) and TOKENC ($25k) now pass the pool check — and are refused for unknown holders instead
  const c = done.perSymbol.find((p: { symbol: string }) => p.symbol === "TOKENC").trade.checks;
  assert.ok(c.find((x: { limit: string }) => x.limit === "minLiquidityUsd").ok);
  assert.ok(!c.find((x: { limit: string }) => x.limit === "maxTop10HolderPct").ok);
});

test("route: saved runs and the ledger are readable with no key", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "canary-api-"));
  const prev = process.env.RADAR_DATA_DIR;
  process.env.RADAR_DATA_DIR = dir;
  try {
    const clock = stepClock("2026-10-30T00:00:00Z");
    const ryo = client(server({ analyze_token: { AAA: withHolders(analyzeA(), 18) }, deep_analysis: { AAA: deepA() } }), clock);
    const run = await runLive(["AAA"], { ryo, llm: null, clock });
    const { file } = await saveRun({ run, rawRyo: ryo.log, trigger: "schedule" });

    const list = await (await get("runs=1")).json();
    assert.deepEqual(list.runs.map((r: { file: string }) => r.file), [file]);
    const one = await get(`run=${encodeURIComponent(file)}`);
    assert.equal(one.status, 200);
    assert.equal((await one.json()).run.headHash, run.headHash);
    const ledger = await (await get("ledger=1")).json();
    assert.equal(ledger.state.positions[0].symbol, "AAA");
  } finally {
    if (prev === undefined) delete process.env.RADAR_DATA_DIR;
    else process.env.RADAR_DATA_DIR = prev;
    await rm(dir, { recursive: true, force: true });
  }
});
