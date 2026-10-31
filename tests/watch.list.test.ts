// The watch list (GET /api/watch/snapshot?list=1) that the Chainlink CRE workflow canary-watch reads:
// which radar coins join it, the case ids, determinism, the optional bearer token, and the 401.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { getAddress, isAddress, keccak256, toBytes } from "viem";
import { runLive } from "../src/lib/engine/pipeline";
import { stepClock } from "../src/lib/engine/trail";
import { saveRun } from "../src/lib/radar/store";
import type { PromoterPost } from "../src/lib/types";
import { buildWatchList, levelOfVerdict, MAX_WATCHED, RADAR_TOKENS, radarCaseId, radarWatch, WATCH_FORMAT, watchTokenOk, type WatchEntry } from "../src/lib/watch";
import { analyzeA, client, deepA, server, withHolders } from "./fixtures/ryo/server";

const tmp = () => mkdtemp(path.join(tmpdir(), "canary-watch-"));

/** TEST-ONLY promoter posts: three different accounts push $SYM on the same day, paid and not saying so. */
const pushedPosts = (sym: string): PromoterPost[] =>
  ["Promoter A", "Promoter B", "Promoter C"].map((promoter, i) => ({
    id: `test-${sym}-${i}`,
    promoter,
    platform: "x",
    postedAt: "2026-10-29",
    datePrecision: "day",
    text: [`$${sym} is going to the moon, get in now`, `Just bought a bag of $${sym}, huge week ahead`, `Everyone is talking about $${sym} today`][i],
    disclosedPayment: false,
    paid: { amountUsd: 1000 * (i + 1), by: `Payer ${i}` },
    sources: [],
  }));

/** A saved real-shaped run (hanko's recorded payload shapes). `holders` is a TEST-ONLY holder figure per symbol. */
async function savedRun(dir: string, at: string, holders: Record<string, number>, pushed: string[] = []) {
  const clock = stepClock(at);
  const symbols = Object.keys(holders);
  const ryo = client(server({ analyze_token: Object.fromEntries(symbols.map((s) => [s, withHolders(analyzeA(), holders[s])])), deep_analysis: { "*": deepA() } }), clock);
  const run = await runLive(symbols, { ryo, llm: null, clock, posts: pushed.flatMap(pushedPosts) });
  const saved = await saveRun({ run, rawRyo: ryo.log, trigger: "manual", dir, updateLedger: false });
  return { run, file: saved.file };
}

test("case ids and verdict levels", () => {
  assert.equal(radarCaseId("pepe"), keccak256(toBytes("canary:radar:PEPE")));
  assert.equal(radarCaseId("PEPE"), "0xedca6cdc5fc88a837f26993fe3a76f5a855b2c362fbe77093497189a3cace1e1");
  assert.notEqual(radarCaseId("EMAX"), keccak256(toBytes("canary:emax")), "radar ids can't collide with case-file ids");
  assert.deepEqual(["no-signal", "suspicious", "pump-and-dump"].map((v) => levelOfVerdict(v as never)), [0, 1, 2]);
});

test("the curated token map holds only well-formed, checksummed Ethereum addresses", () => {
  for (const [sym, t] of Object.entries(RADAR_TOKENS)) {
    assert.match(sym, /^[A-Z0-9]+$/);
    for (const a of [t.token, t.pair]) {
      assert.ok(isAddress(a, { strict: true }), `${sym} ${a}`);
      assert.equal(getAddress(a), a, `${sym} ${a} is checksummed`);
    }
    assert.notEqual(t.token.toLowerCase(), t.pair.toLowerCase());
  }
});

test("radarWatch: a flagged coin with a known pool joins; others are skipped with the reason", async () => {
  const dir = await tmp();
  try {
    assert.deepEqual(await radarWatch(dir), { cases: [], skipped: [] }, "no saved runs → nothing watched, nothing made up");
    // PEPE: 95% held by the top 10 (TEST-ONLY figure) and pushed by paid promoters → flagged; BTC: same, but not an ERC-20 with a known pool
    const { run, file } = await savedRun(dir, "2026-10-30T04:00:00Z", { PEPE: 95, BTC: 95, SHIB: 5 }, ["PEPE", "BTC"]);
    const verdict = (s: string) => run.perSymbol.find((p) => p.symbol === s)!.debate.judge.verdict;
    assert.notEqual(verdict("PEPE"), "no-signal", "the fixture must flag PEPE for this test to mean anything");
    assert.equal(verdict("SHIB"), "no-signal");

    const w = await radarWatch(dir);
    assert.deepEqual(w.cases.map((c) => c.symbol), ["PEPE"]);
    const pepe = w.cases[0];
    assert.equal(pepe.caseId, radarCaseId("PEPE"));
    assert.equal(pepe.token, RADAR_TOKENS.PEPE.token);
    assert.equal(pepe.pair, RADAR_TOKENS.PEPE.pair);
    assert.equal(pepe.level, levelOfVerdict(verdict("PEPE")));
    assert.equal(pepe.promoters, 3, "the three converging promoters from the run");
    assert.equal(pepe.trailHash, `0x${run.headHash}`, "points at the saved run's notebook head");
    assert.equal(pepe.liquidityBeforeUsd, 0, "no same-pool baseline → the workflow never judges a collapse");
    assert.equal(pepe.run, file);
    assert.ok(pepe.gaps?.some((g) => /never judges a collapse/.test(g)));
    assert.deepEqual(
      w.skipped.map((s) => [s.symbol, s.run]),
      [
        ["BTC", file],
        ["SHIB", file],
      ],
    );
    assert.match(w.skipped[0].reason, /no verified ERC-20 token and Uniswap V2 pool/);
    assert.match(w.skipped[1].reason, /no fraud signal/);

    // a newer run that clears PEPE takes it off the list (the latest run decides)
    await savedRun(dir, "2026-10-30T08:00:00Z", { PEPE: 5 });
    const w2 = await radarWatch(dir);
    assert.deepEqual(w2.cases, []);
    assert.match(w2.skipped.find((s) => s.symbol === "PEPE")!.reason, /no fraud signal/);
    assert.equal(w2.skipped.find((s) => s.symbol === "BTC")!.run, file, "BTC's latest run is still the older one");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("radarWatch: a saved run that was edited after saving is not sent", async () => {
  const dir = await tmp();
  try {
    const { file } = await savedRun(dir, "2026-10-30T04:00:00Z", { PEPE: 95 }, ["PEPE"]);
    const p = path.join(dir, "runs", file);
    const saved = JSON.parse(await (await import("node:fs/promises")).readFile(p, "utf8"));
    saved.run.trail[1].summary = "edited";
    await writeFile(p, JSON.stringify(saved));
    const w = await radarWatch(dir);
    assert.deepEqual(w.cases, []);
    assert.match(w.skipped[0].reason, /does not verify/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildWatchList: case files first, then radar coins; deterministic; repeated ids dropped; capped", async () => {
  const emax = { caseId: keccak256(toBytes("canary:emax")), symbol: "EMAX", token: "0x15874d65e649880c2614e7a480cb7c9A55787FF6", level: 3, promoters: 3, trailHash: `0x${"36".repeat(32)}`, liquidityBeforeUsd: 7263266, liquidityNowUsd: 1850255, pair: "0xb6CA52c7916ad7960C12Dc489FD93E5Af7cA257f", source: "case", slug: "emax" } as WatchEntry;
  const coin = (s: string): WatchEntry => ({ ...emax, caseId: radarCaseId(s), symbol: s, source: "radar", slug: undefined, run: "x.json" });
  const list = buildWatchList([emax], { cases: [coin("PEPE"), coin("SHIB"), coin("PEPE")], skipped: [{ symbol: "BTC", reason: "r", run: null }] });
  assert.equal(list.format, WATCH_FORMAT);
  assert.deepEqual(list.cases.map((c) => c.symbol), ["EMAX", "PEPE", "SHIB"]);
  assert.equal(JSON.stringify(list), JSON.stringify(buildWatchList([emax], { cases: [coin("PEPE"), coin("SHIB")], skipped: [{ symbol: "BTC", reason: "r", run: null }] })), "same input → same bytes");
  const many = Array.from({ length: MAX_WATCHED + 2 }, (_, i) => coin(`C${i}`));
  const capped = buildWatchList([emax], { cases: many, skipped: [] });
  assert.equal(capped.cases.length, MAX_WATCHED);
  assert.equal(capped.skipped.filter((s) => /list is full/.test(s.reason)).length, 3);
});

test("watchTokenOk: public without WATCH_TOKEN; with it, only the exact bearer token", () => {
  assert.equal(watchTokenOk(null, undefined), true);
  assert.equal(watchTokenOk(null, ""), true);
  assert.equal(watchTokenOk(null, "s3cret-token"), false);
  assert.equal(watchTokenOk("Bearer s3cret-token", "s3cret-token"), true);
  assert.equal(watchTokenOk("bearer  s3cret-token ", "s3cret-token"), true);
  assert.equal(watchTokenOk("Bearer s3cret-tokeN", "s3cret-token"), false);
  assert.equal(watchTokenOk("s3cret-token", "s3cret-token"), false, "the Bearer scheme is required");
  assert.equal(watchTokenOk("Bearer ", "s3cret-token"), false);
});
