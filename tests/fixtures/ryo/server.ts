// Test helpers built on hanko's published RYO fixtures (see hanko.json in this folder for the source).
//
// IMPORTANT: hanko's recorded payloads carry no holder-concentration field — RYO's six tools are not
// known to publish one (hanko DECISIONS.md D-06). To exercise the ACCEPT path, `withHolders` adds a
// `top10_holder_pct` key on top of a recorded payload. That one key is ours, not RYO's, and every test
// that uses it says so. Everything else is the recorded shape, unchanged.
import { RyoClient } from "../../../src/lib/engine/ryo";
import { stepClock, type Clock } from "../../../src/lib/engine/trail";
import { fixtureFetch, type FixtureReply, type FixtureRoutes } from "../../../src/lib/radar/replay";
import hanko from "./hanko.json";

export { hanko };
export const F = hanko.files;

/** hanko's recorded analyze_token payload: {price_usd, volume_24h} */
export const analyzeA = () => structuredClone(F["fixtures/ryo_analyze_tokena.json"].payload) as Record<string, unknown>;
/** hanko's recorded deep_analysis payload: {pools: {liquidity_usd}} */
export const deepA = () => structuredClone(F["fixtures/ryo_deep_analysis_tokena.json"].payload) as Record<string, unknown>;
/** hanko's thin-pool market snapshot: liquidity $25k */
export const thinC = () => structuredClone(F["fixtures/market_tokenc_thin.json"]) as Record<string, unknown>;

/** TEST-ONLY augmentation: add a holder figure to a recorded payload (see the note at the top). */
export const withHolders = (payload: Record<string, unknown>, pct: number) => ({ ...payload, top10_holder_pct: pct });

export const SIX = hanko.catalog_tools_hanko.map((name) => ({ name }));

/** A fixture server: `byTool[tool][SYMBOL]` → payload (or a full FixtureReply). Unlisted calls get a JSON-RPC error. */
export function server(byTool: Record<string, Record<string, unknown>>, tools: FixtureRoutes["tools"] = SIX, overview: unknown = { status: "ok", data: {} }): FixtureRoutes & { calls: { tool: string; args: Record<string, unknown> }[] } {
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    tools,
    reply(tool, args): FixtureReply {
      calls.push({ tool, args });
      if (tool === "market_overview") return { payload: overview, from: "test" };
      const sym = String(args.symbol ?? args.token ?? args.ticker ?? "").toUpperCase();
      const hit = byTool[tool]?.[sym] ?? byTool[tool]?.["*"];
      if (hit === undefined) return { rpcError: `no fixture for ${tool} ${sym}` };
      if (hit && typeof hit === "object" && ("http" in hit || "rpcError" in hit)) return hit as FixtureReply;
      return { payload: hit, from: "test" };
    },
  };
}

export const client = (routes: FixtureRoutes, clock: Clock = stepClock("2026-10-30T00:00:00Z"), key = "ryo_mcp_TESTKEY123456") =>
  new RyoClient({ apiKey: key, fetch: fixtureFetch(routes), minIntervalMs: 0, clock, url: "https://fixture.invalid/mcp" });
