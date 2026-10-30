// Saved runs: round trip to disk, newest-first listing, browser-style verification of the trail AND of
// every raw RYO reply, no secrets on disk, and the rules about what may be saved at all.
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { verifyLedger, type LedgerFile } from "../src/lib/engine/ledger";
import { runLive } from "../src/lib/engine/pipeline";
import { RyoClient } from "../src/lib/engine/ryo";
import { stepClock } from "../src/lib/engine/trail";
import { hankoReplayClient, HANKO_SYMBOLS } from "../src/lib/radar/replay";
import { verifySavedRun } from "../src/lib/radar/saved";
import { findSecrets, listRuns, readLedger, readRun, RUN_FILE_RE, runFileName, saveRun } from "../src/lib/radar/store";
import { analyzeA, client, deepA, server, withHolders } from "./fixtures/ryo/server";

const KEY = "ryo_mcp_TESTKEY123456";

async function liveRun(at: string, symbols = ["AAA", "BBB"]) {
  const clock = stepClock(at);
  // hanko's recorded payload shapes; TEST-ONLY holder figure so trades can be accepted
  const ryo = client(server({ analyze_token: Object.fromEntries(symbols.map((s) => [s, withHolders(analyzeA(), 18)])), deep_analysis: { "*": deepA() } }), clock, KEY);
  const run = await runLive(symbols, { ryo, llm: null, clock });
  return { run, raw: ryo.log };
}

const tmp = () => mkdtemp(path.join(tmpdir(), "canary-radar-"));

test("save → list → read → verify, with the ledger updated alongside", async () => {
  const dir = await tmp();
  try {
    const a = await liveRun("2026-10-30T00:00:00.123Z");
    const b = await liveRun("2026-10-30T04:00:00Z", ["AAA"]);
    const sa = await saveRun({ run: a.run, rawRyo: a.raw, trigger: "schedule", dir });
    const sb = await saveRun({ run: b.run, rawRyo: b.raw, trigger: "manual", dir });
    assert.equal(sa.file, "2026-10-30T00-00-00Z-AAA-BBB.json");
    assert.match(sb.file, RUN_FILE_RE);

    const { runs, total } = await listRuns(dir);
    assert.equal(total, 2);
    assert.deepEqual(runs.map((r) => r.file), [sb.file, sa.file], "newest first");
    assert.deepEqual(runs[1].accepted, ["AAA", "BBB"]);
    assert.equal(runs[1].trigger, "schedule");
    assert.equal(runs[1].catalogSource, "tools/list");

    const saved = (await readRun(sa.file, dir))!;
    assert.deepEqual(saved.run, JSON.parse(JSON.stringify(a.run)), "the run survives the round trip");
    assert.equal(saved.rawRyo.length, a.raw.length);
    assert.equal(saved.rawRyo[0].tool, "tools/list");
    assert.ok(saved.rawRyo.every((c) => typeof c.latencyMs === "number"));
    assert.deepEqual(saved.catalog, saved.run.catalog);
    const check = await verifySavedRun(saved);
    assert.deepEqual(check.problems, []);
    assert.equal(check.ok, true);
    assert.equal(check.rawChecked, a.raw.length);

    const text = await readFile(path.join(dir, "runs", sa.file), "utf8");
    assert.ok(!text.includes(KEY), "the key is not in the file");
    assert.deepEqual(findSecrets(text, {}), []);

    const ledger = (await readLedger(dir)) as LedgerFile;
    assert.equal(ledger.state.runs.length, 2);
    assert.equal(ledger.state.positions.length, 2, "AAA not doubled by the second run");
    assert.equal((await verifyLedger(ledger)).ok, true);
    assert.equal(ledger.state.positions[0].runFile, sa.file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a saved run whose raw reply or trail was edited fails verification", async () => {
  const { run, raw } = await liveRun("2026-10-30T00:00:00Z");
  const dir = await tmp();
  try {
    const { file } = await saveRun({ run, rawRyo: raw, trigger: "manual", dir, updateLedger: false });
    const s = (await readRun(file, dir))!;
    const editedRaw = structuredClone(s);
    const call = editedRaw.rawRyo.find((c) => c.tool === "analyze_token")!;
    (call.response as { content: { text: string }[] }).content[0].text = JSON.stringify({ price_usd: 99, volume_24h: 1 });
    const v1 = await verifySavedRun(editedRaw);
    assert.equal(v1.ok, false);
    assert.match(v1.problems.join(" "), /analyze_token\) does not match what the trail recorded/);

    const editedTrail = structuredClone(s);
    (editedTrail.run.trail[2].data as { calls: unknown[] }).calls = [];
    const v2 = await verifySavedRun(editedTrail);
    assert.equal(v2.ok, false);
    assert.match(v2.problems[0], /trail broken at step 2/);

    const editedCatalog = structuredClone(s);
    editedCatalog.catalog.tools.pop();
    assert.match((await verifySavedRun(editedCatalog)).problems.join(" "), /catalog snapshot differs/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("only real runs are saved: no fixture replays, no gap-only runs, nothing key-shaped", async () => {
  const dir = await tmp();
  try {
    const fx = await runLive(HANKO_SYMBOLS, { ryo: hankoReplayClient(), llm: null, mode: "recorded-fixture" });
    await assert.rejects(saveRun({ run: fx, rawRyo: [], trigger: "ui", dir }), /recorded-fixture runs are never saved/);

    const none = await runLive(["PEPE"], { ryo: new RyoClient({ apiKey: null }), llm: null });
    await assert.rejects(saveRun({ run: none, rawRyo: [], trigger: "schedule", dir }), /nothing real to save/);

    const { run, raw } = await liveRun("2026-10-30T00:00:00Z");
    const leaky = structuredClone(raw);
    leaky[1].error = `echo: Bearer ${KEY}`;
    await assert.rejects(saveRun({ run, rawRyo: leaky, trigger: "schedule", dir }), /refused to save: the run contains something that looks like a RYO key, a bearer token/);
    assert.deepEqual(await readdir(dir).catch(() => []), [], "nothing was written");
    assert.deepEqual(findSecrets("hello", { RYO_MCP_KEY: "abcdefgh12" }), []);
    assert.deepEqual(findSecrets("x abcdefgh12 y", { RYO_MCP_KEY: "abcdefgh12" }), ["the value of RYO_MCP_KEY"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("file names: safe, sortable, and path tricks are refused on read", async () => {
  assert.equal(runFileName({ startedAt: "2026-10-30T04:05:06.789Z", symbols: ["BTC", "pepe"] }), "2026-10-30T04-05-06Z-BTC-PEPE.json");
  const dir = await tmp();
  try {
    await writeFile(path.join(dir, "secret.json"), "{}");
    assert.equal(await readRun("../secret.json", dir), null);
    assert.equal(await readRun("..%2Fsecret.json", dir), null);
    assert.equal(await readRun("2026-10-30T04-05-06Z-BTC.json", dir), null, "valid name, no such file");
    assert.deepEqual(await listRuns(dir), { runs: [], total: 0 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
