// RYO-CHAN market tools over MCP (Streamable HTTP, JSON-RPC 2.0).
// Handshake: initialize → notifications/initialized → tools/call, keeping the mcp-session-id header.
// The server may answer with plain JSON or a server-sent-event stream; both are read.
// Argument names and the response envelope follow the live catalog as documented by the
// MIT-licensed hanko project (github.com/IamHarrie-Labs/hanko, hanko/ryotools).
//
// Rule: this module never throws out of callTool and never invents a number. A missing key,
// a timeout, a 429, an RPC error or an isError tool result all come back as a recorded Gap.
// The tools are read-only research tools; nothing here can place an order.
//
// Discovery: after the handshake the client asks the server for its catalog (tools/list) and works
// from what is actually there. The six known tools keep their jobs; a renamed one is matched to a
// job by its name and description; a new safety/holder tool feeds the holder rule; anything else is
// called only if its arguments are obvious, and its reply is recorded raw.

import type { Clock } from "./trail";
import { systemClock } from "./trail";
import type { Gap } from "./types";

export const RYO_TOOLS = ["market_overview", "scan_market", "analyze_token", "deep_analysis", "compare_tokens", "monitor_market_sentiment_shift"] as const;
export type RyoTool = (typeof RYO_TOOLS)[number];

// ---------- catalog ----------

/** What a tool is used for in Canary. "safety" = holder concentration / contract safety; "unknown" = recorded raw. */
export type ToolRole = "overview" | "scan" | "token" | "deep" | "compare" | "sentiment" | "safety" | "unknown";

/** One tool exactly as tools/list described it. */
export type CatalogTool = { name: string; description?: string; inputSchema?: unknown; [k: string]: unknown };

export type CatalogEntry = {
  name: string;
  description: string | null;
  role: ToolRole;
  known: boolean; // one of the six tools Canary was written against
  symbolArg: string | null; // the argument that takes a coin symbol, if any
  requiredArgs: string[];
  raw: CatalogTool;
};

export type Catalog = {
  source: "tools/list" | "assumed"; // assumed = the six known tools, because the server could not be asked
  fetchedAt: string;
  tools: CatalogEntry[];
  roles: Partial<Record<Exclude<ToolRole, "unknown" | "safety">, string>>; // job → tool name used for it
  safety: string[]; // tools whose replies feed the holder / safety rules
  unknown: string[]; // tools we could not place: recorded raw
  missingKnown: string[]; // known tools the server no longer lists
  renamed: { role: string; from: string; to: string }[];
  gap: Gap | null;
};

const KNOWN_ROLE: Record<RyoTool, ToolRole> = {
  market_overview: "overview",
  scan_market: "scan",
  analyze_token: "token",
  deep_analysis: "deep",
  compare_tokens: "compare",
  monitor_market_sentiment_shift: "sentiment",
};

// first match wins; safety first so "token holder analysis" is a safety tool, deep before token
const ROLE_PATTERNS: [ToolRole, RegExp][] = [
  ["safety", /holder|safety|security|rug|honeypot|audit|concentration|whale/i],
  ["deep", /\bdeep|in[-_ ]?depth/i],
  ["compare", /compar/i],
  ["sentiment", /sentiment|mood/i],
  ["overview", /overview|global|whole market/i],
  ["scan", /scan|screen|trending|movers/i],
  ["token", /analy[sz]|token[-_ ]?(info|data|stats|metrics)|price/i],
];

const SYMBOL_ARGS = ["symbol", "token", "ticker", "coin", "asset"];
// Per hanko's live check (2026-09-05) every symbol tool takes "symbol"; used when a tool publishes no schema.
const SYMBOL_ROLES: ToolRole[] = ["token", "deep", "safety"];

/** Place one catalog tool: its job, and which argument carries the coin symbol. */
export function classifyTool(t: CatalogTool): CatalogEntry {
  const name = String(t.name);
  const description = typeof t.description === "string" ? t.description : null;
  const known = (RYO_TOOLS as readonly string[]).includes(name);
  const role: ToolRole = known ? KNOWN_ROLE[name as RyoTool] : (ROLE_PATTERNS.find(([, re]) => re.test(`${name.replace(/_/g, " ")} ${description ?? ""}`))?.[0] ?? "unknown");
  const schema = (t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : {}) as { properties?: Record<string, unknown>; required?: unknown };
  const props = schema.properties && typeof schema.properties === "object" ? Object.keys(schema.properties) : [];
  const requiredArgs = Array.isArray(schema.required) ? schema.required.map(String) : [];
  let symbolArg = SYMBOL_ARGS.find((a) => props.includes(a)) ?? null;
  if (!symbolArg && !props.length && SYMBOL_ROLES.includes(role)) symbolArg = "symbol";
  if (name === "compare_tokens") symbolArg = props.includes("symbols") || !props.length ? "symbols" : symbolArg;
  return { name, description, role, known, symbolArg, requiredArgs, raw: t };
}

/** Build the catalog snapshot from what tools/list returned (or from the six known names when it could not be asked). */
export function buildCatalog(tools: CatalogTool[], source: Catalog["source"], fetchedAt: string, gap: Gap | null = null): Catalog {
  const entries = tools.filter((t) => t && typeof t.name === "string" && t.name).map(classifyTool);
  const names = entries.map((e) => e.name);
  const roles: Catalog["roles"] = {};
  const renamed: Catalog["renamed"] = [];
  for (const known of RYO_TOOLS) {
    const role = KNOWN_ROLE[known] as keyof Catalog["roles"];
    if (names.includes(known)) roles[role] = known;
    else {
      const stand = entries.find((e) => !e.known && e.role === role);
      if (stand) {
        roles[role] = stand.name;
        renamed.push({ role, from: known, to: stand.name });
      }
    }
  }
  const used = new Set(Object.values(roles));
  return {
    source,
    fetchedAt,
    tools: entries,
    roles,
    safety: entries.filter((e) => e.role === "safety").map((e) => e.name),
    unknown: entries.filter((e) => !used.has(e.name) && e.role !== "safety").map((e) => e.name),
    missingKnown: RYO_TOOLS.filter((k) => !names.includes(k)),
    renamed,
    gap,
  };
}

/** The six known tools, for when the server's own list could not be read. */
export const assumedCatalog = (fetchedAt: string, gap: Gap | null = null) => buildCatalog(RYO_TOOLS.map((name) => ({ name })), "assumed", fetchedAt, gap);

export const RYO_DEFAULT_URL = "https://app-ryochan.com/api/mcp";
const PROTOCOL_VERSION = "2024-11-05"; // what GET /api/mcp/health reports

export type RyoOk = {
  ok: true;
  tool: string; // one of RYO_TOOLS, or a tool the live catalog listed

  args: Record<string, unknown>;
  payload: unknown;
  route: "structured" | "json_text" | "text" | "empty"; // where in the MCP result the data was found
  degraded: string | null; // the platform's own envelope says partial/simulated/warnings
  fetchedAt: string;
};
export type RyoFail = { ok: false; tool: string; args: Record<string, unknown>; gap: Gap };

/** One request as it went over the wire, kept so a run can be replayed and re-checked later. Never holds the key. */
export type RyoRawCall = {
  tool: string; // a tool name, or "tools/list"
  args: Record<string, unknown>;
  ok: boolean;
  response: unknown; // the MCP `result` object exactly as received (null when the call failed before one arrived)
  error: string | null;
  fetchedAt: string;
  latencyMs: number;
};
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

/** Arguments for a catalog tool and one symbol, or null when the tool needs something we cannot fill. */
export function argsFor(entry: CatalogEntry, symbol: string | null): Record<string, unknown> | null {
  const args: Record<string, unknown> = {};
  if (symbol && entry.symbolArg) args[entry.symbolArg] = symbol;
  return entry.requiredArgs.every((a) => a in args) ? args : null;
}

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
  /** Every request this client made, in order, with the server's reply. Never contains the key. */
  readonly log: RyoRawCall[] = [];
  /** Set by listTools(); callTool then also accepts tools that only the live catalog knows. */
  catalog: Catalog | null = null;

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

  /**
   * Ask the server which tools it really has (tools/list). Always resolves: with no key, or when the
   * list cannot be read, the catalog is the six known tools, marked "assumed", with the reason as a gap.
   */
  async listTools(): Promise<Catalog> {
    const gap = (reason: string): Gap => ({ source: "ryo:tools/list", what: "RYO's tool catalog", reason, at: this.clock() });
    if (!this.key) return (this.catalog = assumedCatalog(this.clock(), gap("no RYO key configured (set RYO_MCP_KEY); assumed the six known tools")));
    const t0 = Date.now();
    try {
      await this.ensureSession();
      const tools: CatalogTool[] = [];
      let cursor: unknown = undefined;
      let result: Record<string, unknown> = {};
      for (let page = 0; page < 10; page++) {
        result = await this.rpc("tools/list", cursor ? { cursor } : {});
        if (Array.isArray(result.tools)) tools.push(...(result.tools as CatalogTool[]));
        cursor = result.nextCursor;
        if (!cursor) break;
      }
      this.record("tools/list", {}, true, { ...result, tools }, null, t0);
      this.catalog = tools.length ? buildCatalog(tools, "tools/list", this.clock()) : assumedCatalog(this.clock(), gap("tools/list answered with no tools; assumed the six known tools"));
    } catch (err) {
      this.record("tools/list", {}, false, null, errText(err), t0);
      this.catalog = assumedCatalog(this.clock(), gap(`${errText(err)}; assumed the six known tools`));
    }
    return this.catalog;
  }

  /** Call one tool. Always resolves; failures come back as { ok:false, gap }. */
  async callTool(tool: string, args: Record<string, unknown> = {}): Promise<RyoResult> {
    const subject = args.symbol ?? args.token ?? args.ticker ?? args.coin ?? args.asset ?? args.symbols;
    const fail = (reason: string): RyoFail => ({
      ok: false,
      tool,
      args,
      gap: { source: `ryo:${tool}`, what: `RYO ${tool}${subject ? ` for ${subject}` : ""}`, reason, at: this.clock() },
    });
    const listed = this.catalog?.source === "tools/list" && this.catalog.tools.some((t) => t.name === tool);
    if (!(RYO_TOOLS as readonly string[]).includes(tool) && !listed) return fail(`"${tool}" is not one of the six RYO tools, and the live catalog did not list it`);
    if (!this.key) return fail("no RYO key configured (set RYO_MCP_KEY); no market data was fetched and none was made up");
    const t0 = Date.now();
    let result: Record<string, unknown> | null = null;
    try {
      await this.ensureSession();
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
      if (result.isError) {
        const reason = `tool reported an error: ${String(typeof payload === "string" ? payload : JSON.stringify(payload)).slice(0, 300)}`;
        this.record(tool, args, false, result, reason, t0);
        return fail(reason);
      }
      this.record(tool, args, true, result, null, t0);
      return { ok: true, tool, args, payload, route, degraded: degradedReason(payload), fetchedAt: this.clock() };
    } catch (err) {
      this.record(tool, args, false, result, errText(err), t0);
      return fail(errText(err));
    }
  }

  private record(tool: string, args: Record<string, unknown>, ok: boolean, response: unknown, error: string | null, t0: number) {
    this.log.push({ tool, args: { ...args }, ok, response: response ?? null, error, fetchedAt: this.clock(), latencyMs: Date.now() - t0 });
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
  if (p.availability && typeof p.availability === "object" && !Array.isArray(p.availability)) {
    const down = Object.entries(p.availability as Record<string, unknown>).filter(([, v]) => v !== "available").map(([k]) => k).sort();
    if (down.length) out.push(`unavailable: ${down.join(", ")}`);
  }
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
  /** Optional extras: not listed in `missing` (RYO's six tools are not known to publish them). */
  safetyScore?: number | null; // 0..1
  change24hPct?: number | null;
  found: Record<string, string>; // field → "tool:path" it came from
  missing: string[];
  notes?: string[];
};

type FactField = "priceUsd" | "volume24hUsd" | "liquidityUsd" | "marketCapUsd" | "top10HolderPct";
type ExtraField = "safetyScore" | "change24hPct";

const CANDIDATE_KEYS: Record<FactField, string[]> = {
  priceUsd: ["price_usd", "priceUsd", "price", "current_price", "last_price"],
  volume24hUsd: ["volume_24h_usd", "volume24hUsd", "volume_24h", "volume24h", "total_volume", "volume"],
  liquidityUsd: ["liquidity_usd", "liquidityUsd", "liquidity", "total_liquidity", "tvl_usd", "tvl"],
  marketCapUsd: ["market_cap_usd", "marketCapUsd", "market_cap", "marketCap"],
  top10HolderPct: ["top10_holder_pct", "top_10_holders_pct", "top10HolderPct", "top10_holders_percent", "top_holders_pct", "top_10_holder_pct", "top10_pct"],
};
const EXTRA_KEYS: Record<ExtraField, string[]> = {
  safetyScore: ["safety_score", "safetyScore", "safety_rating"],
  change24hPct: ["price_change_24h_pct", "change_24h_pct", "price_change_percentage_24h", "percent_change_24h", "price_change_24h", "change_24h", "change24h"],
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
export function extractMarketFacts(symbol: string, payloads: Partial<Record<RyoTool, unknown>> | Record<string, unknown>): MarketFacts {
  const facts: MarketFacts = { symbol: symbol.toUpperCase(), priceUsd: null, volume24hUsd: null, liquidityUsd: null, marketCapUsd: null, top10HolderPct: null, safetyScore: null, change24hPct: null, found: {}, missing: [], notes: [] };
  const all = payloads as Record<string, unknown>;
  const find = (keys: string[]) => {
    for (const tool of Object.keys(all).sort()) {
      let best: { rank: number; depth: number; path: string; n: number } | null = null;
      for (const [k, path, v] of walk(all[tool])) {
        const rank = keys.indexOf(k);
        const n = asNumber(v);
        if (rank < 0 || n === null) continue;
        const depth = path.split(".").length;
        if (!best || rank < best.rank || (rank === best.rank && depth < best.depth)) best = { rank, depth, path, n };
      }
      if (best) return { n: best.n, from: `${tool}:${best.path}` };
    }
    return null;
  };
  for (const field of Object.keys(CANDIDATE_KEYS) as FactField[]) {
    const hit = find(CANDIDATE_KEYS[field]);
    if (hit) {
      facts[field] = hit.n;
      facts.found[field] = hit.from;
    } else facts.missing.push(field);
  }
  for (const field of Object.keys(EXTRA_KEYS) as ExtraField[]) {
    const hit = find(EXTRA_KEYS[field]);
    if (!hit) continue;
    let n = hit.n;
    if (field === "safetyScore" && n > 1) {
      // same rule as hanko: 0–100 is read as a percentage; anything larger fits no scale and is dropped, not clamped
      if (n > 100) {
        facts.notes!.push(`safety score ${n} fits no known scale and was discarded`);
        continue;
      }
      facts.notes!.push(`safety score arrived as ${n} and was read on a 0–100 scale`);
      n = n / 100;
    }
    facts[field] = n;
    facts.found[field] = hit.from;
  }
  return facts;
}
