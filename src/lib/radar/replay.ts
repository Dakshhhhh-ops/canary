// "Replay a recorded RYO response": a stand-in MCP server that answers ONLY with the public fixtures
// published by the MIT-licensed hanko project (tests/fixtures/ryo/hanko.json, source cited inside).
// It exists so the radar can be shown working before a RYO key arrives. Everything it produces is
// marked mode "recorded-fixture": it is never saved as a run, never touches the paper ledger, and the
// page labels it as recorded sample data, not live.
import hanko from "../../../tests/fixtures/ryo/hanko.json";
import { RyoClient } from "../engine/ryo";
import type { Clock } from "../engine/trail";

export const HANKO_SOURCE = hanko._source;
export const HANKO_SYMBOLS = ["TOKENA", "TOKENB", "TOKENC"];

type Files = typeof hanko.files;
const F = hanko.files as Files & Record<string, unknown>;

/** A tool reply: a payload served as MCP text content, an HTTP failure, or a JSON-RPC error. */
export type FixtureReply = { payload: unknown; from: string } | { http: number; body: string; from: string } | { rpcError: string };
export type FixtureRoutes = { tools: { name: string; description?: string; inputSchema?: unknown }[]; reply: (tool: string, args: Record<string, unknown>) => FixtureReply };

/** Which hanko fixture answers which call. Calls with no recorded fixture get an error that says exactly that. */
export const HANKO_ROUTES: FixtureRoutes = {
  // hanko's six tool names, plus check_safety from the hackathon's public tool list (see the fixture notes)
  tools: [...hanko.catalog_tools_hanko, "check_safety"].map((name) => ({ name })),
  reply(tool, args) {
    const s = String(args.symbol ?? "").toUpperCase();
    const file = (p: keyof Files) => ({ payload: (F[p] as { payload?: unknown }).payload ?? F[p], from: `hanko ${p}` });
    if (tool === "market_overview") return { http: 429, body: String(F["fixtures/ryo_failed.json"].error), from: "hanko fixtures/ryo_failed.json" };
    if (tool === "analyze_token" && s === "TOKENA") return file("fixtures/ryo_analyze_tokena.json");
    if (tool === "analyze_token" && s === "TOKENB") return { payload: F["fixtures/market_tokenb.json"], from: "hanko fixtures/market_tokenb.json" };
    if (tool === "analyze_token" && s === "TOKENC") return { payload: F["fixtures/market_tokenc_thin.json"], from: "hanko fixtures/market_tokenc_thin.json" };
    if (tool === "deep_analysis" && s === "TOKENA") return file("fixtures/ryo_deep_analysis_tokena.json");
    if (tool === "check_safety" && s === "TOKENA") return file("fixtures/ryo_check_safety_tokena.json");
    return { rpcError: `replay harness: hanko published no fixture for ${tool}${s ? ` ${s}` : ""}` };
  },
};

/** A fetch that speaks just enough MCP (initialize, tools/list, tools/call) to serve fixture replies. */
export function fixtureFetch(routes: FixtureRoutes): typeof fetch {
  return async (_input, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const reply = (result: unknown, headers: Record<string, string> = {}) => Response.json({ jsonrpc: "2.0", id: body.id, result }, { headers });
    if (!body?.method) return new Response("bad request", { status: 400 });
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "initialize") return reply({ protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fixture-replay", version: "0" } }, { "mcp-session-id": "fixture-replay" });
    if (body.method === "tools/list") return reply({ tools: routes.tools });
    if (body.method === "tools/call") {
      const r = routes.reply(String(body.params?.name), (body.params?.arguments ?? {}) as Record<string, unknown>);
      if ("http" in r) return new Response(r.body, { status: r.http });
      if ("rpcError" in r) return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32001, message: r.rpcError } });
      return reply({ content: [{ type: "text", text: JSON.stringify(r.payload) }], isError: false });
    }
    return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "no such method" } });
  };
}

/** A RYO client wired to the hanko fixtures. The "key" is a placeholder: nothing leaves this process. */
export const hankoReplayClient = (clock?: Clock) => new RyoClient({ apiKey: "fixture-replay", fetch: fixtureFetch(HANKO_ROUTES), minIntervalMs: 0, url: "https://fixture-replay.invalid/mcp", clock });
