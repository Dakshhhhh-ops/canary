// Tool discovery: Canary works from the catalog RYO actually lists (tools/list), not from a hard-coded six.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runLive } from "../src/lib/engine/pipeline";
import { buildCatalog, classifyTool, RyoClient } from "../src/lib/engine/ryo";
import { stepClock, verifyTrail } from "../src/lib/engine/trail";
import { HANKO_ROUTES, fixtureFetch } from "../src/lib/radar/replay";
import { analyzeA, client, deepA, F, server, SIX } from "./fixtures/ryo/server";

const clock = () => stepClock("2026-10-30T00:00:00Z");

test("tools/list is asked right after the handshake, with the key, and the catalog is kept", async () => {
  const methods: string[] = [];
  const auth: string[] = [];
  const inner = fixtureFetch(HANKO_ROUTES);
  const f: typeof fetch = async (i, init) => {
    const b = JSON.parse(String(init?.body));
    methods.push(b.method);
    auth.push((init?.headers as Record<string, string>).authorization);
    return inner(i, init);
  };
  const c = new RyoClient({ apiKey: "ryo_mcp_test", fetch: f, minIntervalMs: 0, clock: clock() });
  const cat = await c.listTools();
  assert.deepEqual(methods, ["initialize", "notifications/initialized", "tools/list"]);
  assert.ok(auth.every((a) => a === "Bearer ryo_mcp_test"));
  assert.equal(cat.source, "tools/list");
  // hanko's six names plus check_safety from the hackathon's public list
  assert.equal(cat.tools.length, 7);
  assert.deepEqual(cat.safety, ["check_safety"]);
  assert.deepEqual(cat.unknown, []);
  assert.deepEqual(cat.missingKnown, []);
  assert.equal(cat.roles.token, "analyze_token");
  assert.equal(c.log[0].tool, "tools/list");
  assert.ok(!JSON.stringify(c.log).includes("ryo_mcp_test"), "the key never lands in the raw log");
});

test("a seventh safety tool is called per coin and feeds the facts (hanko's check_safety fixture)", async () => {
  const r = await runLive(["TOKENA"], { ryo: new RyoClient({ apiKey: "k", fetch: fixtureFetch(HANKO_ROUTES), minIntervalMs: 0, clock: clock() }), llm: null, clock: clock() });
  assert.equal(r.trail[0].kind, "collector.catalog");
  assert.match(r.trail[0].summary, /RYO lists 7 tools\. New: check_safety\./);
  assert.ok(r.ryo.calls.some((c) => c.tool === "check_safety" && c.symbol === "TOKENA" && c.ok));
  assert.equal(r.facts[0].safetyScore, 0.82);
  assert.equal(r.facts[0].found.safetyScore, "check_safety:safety_score");
  assert.equal(r.facts[0].liquidityUsd, 900000, "liquidity from hanko's deep_analysis pools");
  assert.deepEqual(r.trail[0].data, JSON.parse(JSON.stringify(r.catalog)), "the catalog snapshot is in the trail");
  assert.equal((await verifyTrail(r.trail)).ok, true);
});

test("classification: renamed, holder, unknown and schema-driven argument names", () => {
  assert.equal(classifyTool({ name: "token_holders", description: "Top wallet concentration for a token" }).role, "safety");
  assert.equal(classifyTool({ name: "deep_dive", description: "In-depth analysis of one token" }).role, "deep");
  assert.equal(classifyTool({ name: "analyze_token_v2" }).role, "token");
  assert.equal(classifyTool({ name: "funding_rates", description: "Perp funding" }).role, "unknown");
  const e = classifyTool({ name: "token_holders", inputSchema: { type: "object", properties: { ticker: { type: "string" } }, required: ["ticker"] } });
  assert.equal(e.symbolArg, "ticker");
  assert.deepEqual(e.requiredArgs, ["ticker"]);
  // no schema published: hanko confirmed every symbol tool takes "symbol"
  assert.equal(classifyTool({ name: "check_safety" }).symbolArg, "symbol");
  assert.equal(classifyTool({ name: "compare_tokens" }).symbolArg, "symbols");
});

test("a renamed tool takes over its job; a holder tool fills the holder rule; unknown tools are recorded raw", async () => {
  const tools = [
    ...SIX.filter((t) => t.name !== "analyze_token"),
    { name: "token_analysis", description: "Analyze a token: price and volume", inputSchema: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] } },
    { name: "holder_distribution", description: "Holder concentration of a token", inputSchema: { type: "object", properties: { symbol: {} }, required: ["symbol"] } },
    { name: "funding_rates", description: "Perpetual funding rates", inputSchema: { type: "object", properties: { symbol: {} } } },
    { name: "wallet_lookup", description: "Look up a wallet", inputSchema: { type: "object", properties: { address: {} }, required: ["address"] } },
  ];
  const routes = server(
    {
      token_analysis: { TOKENA: analyzeA() },
      deep_analysis: { TOKENA: deepA() },
      holder_distribution: { TOKENA: { top10_holder_pct: 31 } }, // a shape we imagine for a NEW tool; not a RYO recording
      funding_rates: { TOKENA: { rate: 0.0001 } },
    },
    tools,
  );
  const r = await runLive(["tokena"], { ryo: client(routes), llm: null, clock: clock() });
  assert.deepEqual(r.catalog.renamed, [{ role: "token", from: "analyze_token", to: "token_analysis" }]);
  assert.deepEqual(r.catalog.missingKnown, ["analyze_token"]);
  assert.deepEqual(r.catalog.safety, ["holder_distribution"]);
  assert.deepEqual(r.catalog.unknown, ["funding_rates", "wallet_lookup"]);
  assert.match(r.trail[0].summary, /Renamed: analyze_token → token_analysis\. New: holder_distribution, funding_rates, wallet_lookup\. No longer listed: analyze_token\./);
  assert.ok(!routes.calls.some((c) => c.tool === "analyze_token"), "the old name is not called");
  assert.equal(r.facts[0].priceUsd, 1.25);
  assert.equal(r.facts[0].top10HolderPct, 31);
  assert.equal(r.facts[0].found.top10HolderPct, "holder_distribution:top10_holder_pct");
  const extras = r.trail.find((e) => e.kind === "collector.unplaced-tools");
  assert.ok(extras, "unknown tools get their own trail step");
  const data = extras!.data as { tool: string; ok: boolean; preview: string | null; reason: string | null }[];
  assert.deepEqual(data.find((d) => d.tool === "funding_rates"), { tool: "funding_rates", symbol: "TOKENA", ok: true, preview: '{"rate":0.0001}', reason: null });
  assert.match(data.find((d) => d.tool === "wallet_lookup")!.reason!, /not called: needs address/);
  assert.ok(!routes.calls.some((c) => c.tool === "wallet_lookup"));
});

test("tools/list failing or missing: the six known tools are assumed, with the reason as a gap", async () => {
  const broken = server({ analyze_token: { TOKENA: analyzeA() } });
  const routes = { ...broken, tools: [] };
  const r = await runLive(["TOKENA"], { ryo: client(routes), llm: null, clock: clock() });
  assert.equal(r.catalog.source, "assumed");
  assert.ok(r.gaps.some((g) => g.source === "ryo:tools/list" && /no tools/.test(g.reason)));
  assert.equal(r.facts[0].priceUsd, 1.25, "still works on the known names");
  assert.equal(r.trail[0].kind, "collector.ryo");

  const noKey = new RyoClient({ apiKey: null, fetch: async () => assert.fail("no network without a key") });
  const cat = await noKey.listTools();
  assert.equal(cat.source, "assumed");
  assert.match(cat.gap!.reason, /no RYO key/);
});

test("callTool refuses names that are neither known nor listed", async () => {
  const c = client(server({}));
  const r = await c.callTool("place_order", {});
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.gap.reason, /not one of the six RYO tools, and the live catalog did not list it/);
  assert.equal(c.log.length, 0, "nothing was sent");
});

test("buildCatalog keeps unknown tools and their raw description", () => {
  const cat = buildCatalog([...SIX, { name: "x_pulse", description: "something new", extra: 1 }], "tools/list", "2026-10-30T00:00:00Z");
  assert.deepEqual(cat.unknown, ["x_pulse"]);
  assert.deepEqual(cat.tools.find((t) => t.name === "x_pulse")!.raw, { name: "x_pulse", description: "something new", extra: 1 });
  assert.ok(F["fixtures/ryo_failed.json"].error);
});
