import assert from "node:assert/strict";
import { test } from "node:test";
import { extractMarketFacts, RyoClient, ryoArgs } from "../src/lib/engine/ryo";
import { runLive } from "../src/lib/engine/pipeline";
import { stepClock } from "../src/lib/engine/trail";

const clock = stepClock("2026-10-30T00:00:00Z");
const noWait = { minIntervalMs: 0, clock };

type Call = { url: string; headers: Record<string, string>; body: { method?: string; id?: number; params?: unknown } | null };

/** A fake MCP server. `reply` decides what tools/call returns. */
function fakeServer(reply: (body: Call["body"]) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f: typeof fetch = async (input, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string>, body });
    if (body?.method === "initialize") return Response.json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2024-11-05" } }, { headers: { "mcp-session-id": "sess-1" } });
    if (body?.method === "notifications/initialized") return new Response(null, { status: 202 });
    return reply(body);
  };
  return { f, calls };
}

test("no key: a gap, no network call, no number", async () => {
  let hit = 0;
  const c = new RyoClient({ ...noWait, apiKey: null, fetch: async () => (hit++, new Response()) });
  const r = await c.callTool("analyze_token", { symbol: "PEPE" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.gap.reason, /no RYO key/);
  assert.equal(hit, 0);
});

test("handshake, session header, SSE reply, structured content", async () => {
  const { f, calls } = fakeServer((b) => {
    const msg = { jsonrpc: "2.0", id: b!.id, result: { structuredContent: { status: "ok", data_mode: "live", data: { market: { price_usd: 1.5, volume_24h_usd: "2,000" } } } } };
    return new Response(`event: message\ndata: ${JSON.stringify(msg)}\n\n`, { headers: { "content-type": "text/event-stream" } });
  });
  const c = new RyoClient({ ...noWait, apiKey: "ryo_mcp_test", fetch: f });
  const r = await c.callTool("analyze_token", ryoArgs("analyze_token", ["PEPE"]));
  assert.equal(r.ok, true);
  assert.deepEqual(calls.map((x) => x.body?.method), ["initialize", "notifications/initialized", "tools/call"]);
  assert.equal(calls[2].headers["mcp-session-id"], "sess-1");
  assert.equal(calls[2].headers.authorization, "Bearer ryo_mcp_test");
  assert.deepEqual((calls[2].body?.params as { arguments: unknown }).arguments, { symbol: "PEPE" });
  if (r.ok) {
    assert.equal(r.route, "structured");
    const facts = extractMarketFacts("pepe", { analyze_token: r.payload });
    assert.equal(facts.priceUsd, 1.5);
    assert.equal(facts.volume24hUsd, 2000);
    assert.equal(facts.liquidityUsd, null, "missing stays null");
    assert.ok(facts.missing.includes("liquidityUsd"));
    assert.equal(facts.found.priceUsd, "analyze_token:data.market.price_usd");
  }
  await c.callTool("market_overview");
  assert.equal(calls.filter((x) => x.body?.method === "initialize").length, 1, "one session for many calls");
});

test("isError, rpc error, 429, 401 and timeout all become gaps", async () => {
  const cases: [(b: Call["body"]) => Response | Promise<Response>, RegExp][] = [
    [(b) => Response.json({ jsonrpc: "2.0", id: b!.id, result: { isError: true, content: [{ type: "text", text: "unknown symbol" }] } }), /tool reported an error: unknown symbol/],
    [(b) => Response.json({ jsonrpc: "2.0", id: b!.id, error: { code: -32602, message: "bad params" } }), /rpc error -32602/],
    [() => new Response("slow down", { status: 429, headers: { "retry-after": "30" } }), /rate limited \(429\), retry after 30s/],
    [() => new Response("no", { status: 401 }), /key was refused/],
    [() => new Promise<Response>(() => {}), /timed out/],
  ];
  for (const [reply, re] of cases) {
    const { f } = fakeServer(reply);
    const c = new RyoClient({ ...noWait, apiKey: "ryo_mcp_test", fetch: f, timeoutMs: 50 });
    const r = await c.callTool("deep_analysis", { symbol: "X" });
    assert.equal(r.ok, false, String(re));
    if (!r.ok) {
      assert.match(r.gap.reason, re);
      assert.equal(r.gap.source, "ryo:deep_analysis");
    }
  }
});

test("network failure during the handshake is a gap, and the next call retries", async () => {
  let fail = true;
  const inner = fakeServer((b) => Response.json({ jsonrpc: "2.0", id: b!.id, result: { content: [{ type: "text", text: '{"price":2}' }] } }));
  const f: typeof fetch = async (i, init) => {
    if (fail) {
      fail = false;
      throw new TypeError("fetch failed");
    }
    return inner.f(i, init);
  };
  const c = new RyoClient({ ...noWait, apiKey: "ryo_mcp_test", fetch: f });
  const r1 = await c.callTool("market_overview");
  assert.equal(r1.ok, false);
  const r2 = await c.callTool("market_overview");
  assert.equal(r2.ok, true);
  if (r2.ok) assert.equal(r2.route, "json_text");
});

test("degraded envelopes are flagged, not trusted silently", async () => {
  const { f } = fakeServer((b) => Response.json({ jsonrpc: "2.0", id: b!.id, result: { structuredContent: { status: "partial", data_mode: "simulated", data: {} } } }));
  const r = await new RyoClient({ ...noWait, apiKey: "k", fetch: f }).callTool("scan_market");
  assert.equal(r.ok, true);
  if (r.ok) assert.match(r.degraded!, /partial.*simulated/);
});

test("requests are spaced politely", async () => {
  const { f, calls } = fakeServer((b) => Response.json({ jsonrpc: "2.0", id: b!.id, result: { structuredContent: {} } }));
  const waits: number[] = [];
  const c = new RyoClient({ apiKey: "k", fetch: f, clock, minIntervalMs: 1000, sleep: async (ms) => void waits.push(ms) });
  await Promise.all([c.callTool("market_overview"), c.callTool("scan_market")]);
  assert.equal(calls.length, 4);
  assert.equal(waits.length, 3, "every request after the first waited");
  assert.ok(waits.every((w) => w > 900));
});

test("runLive without RYO: honest gaps, unknown numbers, refused trade, valid trail", async () => {
  const r = await runLive(["pepe"], { ryo: new RyoClient({ ...noWait, apiKey: null }), llm: null, clock });
  assert.equal(r.ryo.configured, false);
  assert.ok(r.gaps.length >= 2);
  assert.equal(r.facts[0].priceUsd, null);
  assert.equal(r.hunter.rejected[0].unknownCount, 6);
  assert.equal(r.perSymbol[0].debate.judge.verdict, "no-signal");
  assert.equal(r.perSymbol[0].trade.decision, "refused");
  assert.equal(r.trailOk, true);
  assert.equal(r.trail[0].kind, "collector.ryo-unavailable");
});
