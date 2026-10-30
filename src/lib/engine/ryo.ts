// RYO-CHAN market tools over MCP (Streamable HTTP, JSON-RPC 2.0).
// Handshake: initialize → notifications/initialized → tools/call, keeping the mcp-session-id header.
// The server may answer with plain JSON or a server-sent-event stream; both are read.
// Argument names and the response envelope follow the live catalog as documented by the
// MIT-licensed hanko project (github.com/IamHarrie-Labs/hanko, hanko/ryotools).
//
// Rule: this module never throws out of callTool and never invents a number. A missing key,
// a timeout, a 429, an RPC error or an isError tool result all come back as a recorded Gap.
// The tools are read-only research tools; nothing here can place an order.

import type { Clock } from "./trail";
import { systemClock } from "./trail";
import type { Gap } from "./types";

export const RYO_TOOLS = ["market_overview", "scan_market", "analyze_token", "deep_analysis", "compare_tokens", "monitor_market_sentiment_shift"] as const;
export type RyoTool = (typeof RYO_TOOLS)[number];

export const RYO_DEFAULT_URL = "https://app-ryochan.com/api/mcp";
const PROTOCOL_VERSION = "2024-11-05"; // what GET /api/mcp/health reports

export type RyoOk = {
  ok: true;
  tool: RyoTool;
  args: Record<string, unknown>;
  payload: unknown;
  route: "structured" | "json_text" | "text" | "empty"; // where in the MCP result the data was found
  degraded: string | null; // the platform's own envelope says partial/simulated/warnings
  fetchedAt: string;
};
export type RyoFail = { ok: false; tool: RyoTool; args: Record<string, unknown>; gap: Gap };
export type RyoResult = RyoOk | RyoFail;

export type RyoOptions = {
  url?: string;
  apiKey?: string | null; // defaults to env RYO_MCP_KEY
  fetch?: typeof fetch; // injectable for tests
  timeoutMs?: number;
  minIntervalMs?: number; // polite spacing between requests (default 1100 ms ≈ 55/min, under the stated 60/min)
  clock?: Clock;
  sleep?: (ms: number) => Promise<void>;
};

class RyoError extends Error {}

const env = (k: string): string | undefined => (typeof process !== "undefined" ? process.env?.[k] : undefined);

/** Build arguments the way the live catalog expects: symbol tools take {symbol}, compare takes one string. */
export function ryoArgs(tool: RyoTool, symbols: string[] = [], extra: Record<string, unknown> = {}): Record<string, unknown> {
  const args: Record<string, unknown> = { ...extra };
  if (symbols.length) {
    if (tool === "analyze_token" || tool === "deep_analysis") args.symbol ??= symbols[0];
    else if (tool === "compare_tokens") args.symbols ??= symbols.join(", ");
  }
  return args;
}

export class RyoClient {
  private url: string;
  private key: string | null;
  private doFetch: typeof fetch;
  private timeoutMs: number;
  private minIntervalMs: number;
  private clock: Clock;
  private sleep: (ms: number) => Promise<void>;
  private sessionId: string | null = null;
  private initialized: Promise<void> | null = null;
  private nextId = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private lastSent = 0;

  constructor(opts: RyoOptions = {}) {
    this.url = (opts.url ?? env("RYO_MCP_URL") ?? RYO_DEFAULT_URL).replace(/\/+$/, "");
    this.key = opts.apiKey === undefined ? (env("RYO_MCP_KEY") ?? null) : opts.apiKey;
    this.doFetch = opts.fetch ?? ((...a) => fetch(...a));
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.minIntervalMs = opts.minIntervalMs ?? 1100;
    this.clock = opts.clock ?? systemClock;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get configured(): boolean {
    return Boolean(this.key);
  }

  /** Unauthenticated health check: {"status":"ok","tools":6} when the server is up. */
  async health(): Promise<{ ok: boolean; body: unknown; error?: string }> {
    try {
      const res = await this.withTimeout((signal) => this.doFetch(`${this.url}/health`, { signal }));
      const body = await res.json().catch(() => null);
      return { ok: res.ok && (body as { status?: string })?.status === "ok", body };
    } catch (err) {
      return { ok: false, body: null, error: errText(err) };
    }
  }

  /** Call one tool. Always resolves; failures come back as { ok:false, gap }. */
  async callTool(tool: RyoTool, args: Record<string, unknown> = {}): Promise<RyoResult> {
    const fail = (reason: string): RyoFail => ({
      ok: false,
      tool,
      args,
      gap: { source: `ryo:${tool}`, what: `RYO ${tool}${args.symbol ? ` for ${args.symbol}` : ""}`, reason, at: this.clock() },
    });
    if (!RYO_TOOLS.includes(tool)) return fail(`"${tool}" is not one of the six RYO tools`);
    if (!this.key) return fail("no RYO key configured (set RYO_MCP_KEY); no market data was fetched and none was made up");
    try {
      await this.ensureSession();
      let result: Record<string, unknown>;
      try {
        result = await this.rpc("tools/call", { name: tool, arguments: args });
      } catch (err) {
        // MCP: a 404 on a known session means the session expired; start a new one once.
        if (!(err instanceof RyoError && /^http 404/.test(err.message) && this.sessionId)) throw err;
        this.sessionId = null;
        this.initialized = null;
        await this.ensureSession();
        result = await this.rpc("tools/call", { name: tool, arguments: args });
      }
      const { payload, route } = extractPayload(result);
      if (result.isError) return fail(`tool reported an error: ${String(typeof payload === "string" ? payload : JSON.stringify(payload)).slice(0, 300)}`);
      return { ok: true, tool, args, payload, route, degraded: degradedReason(payload), fetchedAt: this.clock() };
    } catch (err) {
      return fail(errText(err));
    }
  }

  private ensureSession(): Promise<void> {
    this.initialized ??= (async () => {
      await this.rpc("initialize", { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "canary", version: "1.0.0" } });
      await this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    })().catch((err) => {
      this.initialized = null; // let a later call try again
      throw err;
    });
    return this.initialized;
  }

  private async rpc(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = ++this.nextId;
    const res = await this.send({ jsonrpc: "2.0", id, method, params });
    const msg = await readMessage(res, id);
    if (!msg) throw new RyoError(`no JSON-RPC reply for ${method}`);
    if (msg.error) {
      const e = msg.error as { code?: number; message?: string };
      throw new RyoError(`rpc error ${e.code ?? "?"}: ${e.message ?? "unknown"}`);
    }
    return (msg.result as Record<string, unknown>) ?? {};
  }

  /** One POST, spaced politely from the previous one. Throws RyoError on HTTP errors. */
  private send(body: Record<string, unknown>): Promise<Response> {
    const run = async () => {
      const wait = this.lastSent + this.minIntervalMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.lastSent = Date.now();
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": PROTOCOL_VERSION,
        authorization: `Bearer ${this.key}`,
      };
      if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
      const res = await this.withTimeout((signal) => this.doFetch(this.url, { method: "POST", headers, body: JSON.stringify(body), signal }));
      const sid = res.headers.get("mcp-session-id");
      if (sid) this.sessionId = sid;
      if (res.status === 429) throw new RyoError(`rate limited (429)${res.headers.get("retry-after") ? `, retry after ${res.headers.get("retry-after")}s` : ""}`);
      if (res.status === 401 || res.status === 403) throw new RyoError(`http ${res.status}: the RYO key was refused`);
      if (res.status >= 400) throw new RyoError(`http ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
      return res;
    };
    // serialise requests so spacing holds even when callers fire in parallel
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  private async withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    // race as well as abort: a fetch that ignores its signal must still not hang the run
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctrl.abort();
        reject(new RyoError(`timed out after ${this.timeoutMs} ms`));
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([fn(ctrl.signal), timeout]);
    } catch (err) {
      if (ctrl.signal.aborted) throw new RyoError(`timed out after ${this.timeoutMs} ms`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Read the JSON-RPC message for `id` from a JSON body (single or batch) or an SSE stream. */
async function readMessage(res: Response, id: number): Promise<Record<string, unknown> | null> {
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  const text = await res.text();
  const pick = (m: unknown): Record<string, unknown> | null => {
    if (Array.isArray(m)) return (m.find((x) => x?.id === id) as Record<string, unknown>) ?? null;
    return m && typeof m === "object" ? (m as Record<string, unknown>) : null;
  };
  if (type.includes("text/event-stream")) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data.trim()) continue;
      try {
        const m = pick(JSON.parse(data));
        if (m && (m.id === id || m.error)) return m;
      } catch {
        /* skip keep-alives and partial events */
      }
    }
    return null;
  }
  if (!text.trim()) return null;
  try {
    return pick(JSON.parse(text));
  } catch {
    throw new RyoError(`reply was not JSON: ${text.slice(0, 120)}`);
  }
}

/** MCP servers put tool data in structuredContent, in JSON inside a text block, or in plain text. */
export function extractPayload(result: Record<string, unknown>): { payload: unknown; route: RyoOk["route"] } {
  const sc = result.structuredContent;
  if (sc && typeof sc === "object") return { payload: sc, route: "structured" };
  const content = Array.isArray(result.content) ? (result.content as { type?: string; text?: string }[]) : [];
  const texts = content.filter((b) => b?.type === "text" && b.text).map((b) => b.text as string);
  if (!texts.length) return { payload: null, route: "empty" };
  try {
    const parsed = texts.map((t) => JSON.parse(t));
    return { payload: parsed.length === 1 ? parsed[0] : parsed, route: "json_text" };
  } catch {
    return { payload: texts.join("\n"), route: "text" };
  }
}

/** The platform envelope admits partial/simulated data: say so instead of treating it as complete. */
export function degradedReason(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  const out: string[] = [];
  if (p.status === "partial" || p.status === "unavailable") out.push(`status: ${p.status}`);
  if (p.data_mode === "simulated" || p.data_mode === "unknown") out.push(`data_mode: ${p.data_mode}`);
  if (Array.isArray(p.warnings) && p.warnings.length) out.push(`warnings: ${p.warnings.slice(0, 3).map((w) => String(w).slice(0, 120)).join("; ")}`);
  return out.length ? out.join("; ") : null;
}

// ---------- fact extraction ----------

export type MarketFacts = {
  symbol: string;
  priceUsd: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  top10HolderPct: number | null;
  found: Record<string, string>; // field → "tool:path" it came from
  missing: string[];
};

const CANDIDATE_KEYS: Record<"priceUsd" | "volume24hUsd" | "liquidityUsd" | "marketCapUsd" | "top10HolderPct", string[]> = {
  priceUsd: ["price_usd", "priceUsd", "price", "current_price", "last_price"],
  volume24hUsd: ["volume_24h_usd", "volume24hUsd", "volume_24h", "volume24h", "total_volume", "volume"],
  liquidityUsd: ["liquidity_usd", "liquidityUsd", "liquidity", "total_liquidity", "tvl_usd", "tvl"],
  marketCapUsd: ["market_cap_usd", "marketCapUsd", "market_cap", "marketCap"],
  top10HolderPct: ["top10_holder_pct", "top_10_holders_pct", "top10HolderPct", "top10_holders_percent", "top_holders_pct"],
};

function* walk(node: unknown, path = ""): Generator<[string, string, unknown]> {
  if (Array.isArray(node)) for (let i = 0; i < node.length; i++) yield* walk(node[i], `${path}[${i}]`);
  else if (node && typeof node === "object")
    for (const [k, v] of Object.entries(node)) {
      const here = path ? `${path}.${k}` : k;
      yield [k, here, v];
      yield* walk(v, here);
    }
}

const asNumber = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.trim().replace(/[$,]/g, ""));
    return v.trim() && Number.isFinite(n) ? n : null;
  }
  return null; // booleans and objects are never numbers
};

/**
 * Pull price / volume / liquidity / market cap out of tool payloads by key name, anywhere in the payload.
 * A field not found stays null (and is listed in `missing`); every number found records where it came from.
 */
export function extractMarketFacts(symbol: string, payloads: Partial<Record<RyoTool, unknown>>): MarketFacts {
  const facts: MarketFacts = { symbol: symbol.toUpperCase(), priceUsd: null, volume24hUsd: null, liquidityUsd: null, marketCapUsd: null, top10HolderPct: null, found: {}, missing: [] };
  for (const field of Object.keys(CANDIDATE_KEYS) as (keyof typeof CANDIDATE_KEYS)[]) {
    const keys = CANDIDATE_KEYS[field];
    for (const tool of Object.keys(payloads).sort() as RyoTool[]) {
      let best: { rank: number; depth: number; path: string; n: number } | null = null;
      for (const [k, path, v] of walk(payloads[tool])) {
        const rank = keys.indexOf(k);
        const n = asNumber(v);
        if (rank < 0 || n === null) continue;
        const depth = path.split(".").length;
        if (!best || rank < best.rank || (rank === best.rank && depth < best.depth)) best = { rank, depth, path, n };
      }
      if (best) {
        facts[field] = best.n;
        facts.found[field] = `${tool}:${best.path}`;
        break;
      }
    }
    if (facts[field] === null) facts.missing.push(field);
  }
  return facts;
}
