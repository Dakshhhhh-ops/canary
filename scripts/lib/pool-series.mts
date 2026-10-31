/**
 * Generic on-chain evidence builder for a token traded on a Uniswap-V2-style pool (Uniswap V2 itself, or
 * a fork with the same Swap/Sync events such as SushiSwap or PancakeSwap V2), priced in USD through a
 * stablecoin pool on the same chain. Used by scripts/build-case.mts; one config per case.
 *
 * The method is the one scripts/build-emax.mts uses for the EthereumMax case (that script is left as it
 * is so the published EMAX file stays reproducible byte for byte; `npx tsx scripts/build-case.mts emax
 * --compare` re-runs this module on EMAX's addresses and checks it gives the identical price series):
 *  - daily price/liquidity = the pair's reserves after its last Sync event of each UTC day;
 *  - quote/USD (e.g. ETH/USD) = the same end-of-day reading of a stablecoin pool;
 *  - volume = the quote side of every Swap that day, valued at that day's close;
 *  - buyers = distinct addresses that received the token directly from the pair.
 * Requests are sequential, at least 300 ms apart, retried with backoff on HTTP 429 / 5xx, and cached on
 * disk (OS temp dir) so re-runs are fast and cheap.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- raw JSON-RPC payloads, shaped by the node, are read field by field */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export type PoolConfig = {
  /** JSON-RPC archive node that returns `blockTimestamp` on logs (Tenderly's public gateway does). */
  rpc: string;
  cacheDir: string;
  fresh?: boolean;
  /** The token being studied. */
  token: string;
  tokenDecimals: number;
  /** The token/quote pair (Uniswap-V2-style) and the factory that must have created it. */
  pair: string;
  pairCreatedBlock: number;
  factory: string;
  router?: string; // excluded from buyer counts
  /** The quote asset (e.g. WETH) and a stablecoin/quote pool on the same chain for quote → USD. */
  quote: string;
  quoteDecimals: number;
  usdPool: { pair: string; stable: string; stableDecimals: number; factory: string };
  /** Search bounds for the block-by-timestamp search (kept as parameters so cached requests stay identical). */
  searchLo: number;
  searchHi: number;
  logChunk?: number; // eth_getLogs block span for the pair (default 8000)
};

export const TOPIC_SYNC = "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1";
export const TOPIC_SWAP = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";
export const TOPIC_TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const DEAD = "0x000000000000000000000000000000000000dead";
export const ZERO = "0x0000000000000000000000000000000000000000";

export type Log = { blockNumber: number; logIndex: number; ts: number; topics: string[]; data: string; tx: string };

class RangeTooBig extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const word = (data: string, i: number) => BigInt("0x" + data.slice(2 + 64 * i, 2 + 64 * (i + 1)));
export const topicAddr = (t: string) => "0x" + t.slice(-40).toLowerCase();
export const padAddr = (a: string) => "0x" + a.toLowerCase().slice(2).padStart(64, "0");
export const toFloat = (x: bigint, decimals = 18) => Number(x) / 10 ** decimals;
export const ratio = (num: bigint, den: bigint) => Number((num * 10n ** 30n) / den) / 1e30;
export const dayOf = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
export const iso = (ts: number) => new Date(ts * 1000).toISOString().replace(".000Z", "Z");
export const dayStartTs = (d: string) => Date.parse(d + "T00:00:00Z") / 1000;
export const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

export function dayList(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(from + "T00:00:00Z"); t <= Date.parse(to + "T00:00:00Z"); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export type Day = {
  date: string;
  endBlock: number;
  tokenReserve: bigint;
  quoteReserve: bigint;
  priceQuote: number; // quote per token at end of day
  quoteUsd: number; // USD per quote at end of day
  priceUsd: number;
  liquidityUsd: number; // both sides of the pool: 2 x quote reserve x quote/USD
  swaps: number;
  volumeQuote: number;
  volumeUsd: number;
};

export type Sync = { ts: number; block: number; priceQuote: number };

export function makeChain(cfg: PoolConfig) {
  let lastCall = 0;
  const tokenIs0 = cfg.token.toLowerCase() < cfg.quote.toLowerCase(); // Uniswap V2 sorts token0 < token1

  async function http(url: string, body?: unknown): Promise<any> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const key = createHash("sha1").update(url + (payload ?? "")).digest("hex");
    const file = join(cfg.cacheDir, key + ".json");
    if (!cfg.fresh && existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
    for (let attempt = 0; ; attempt++) {
      const wait = lastCall + 300 - Date.now();
      if (wait > 0) await sleep(wait);
      lastCall = Date.now();
      try {
        const res = await fetch(url, {
          method: payload ? "POST" : "GET",
          body: payload,
          headers: { accept: "application/json", "content-type": "application/json", "user-agent": "canary-evidence-builder/1.0" },
          signal: AbortSignal.timeout(90_000),
        });
        if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
        if (!res.ok) throw new Error(`HTTP ${res.status} (not retried) for ${url}`);
        const json = await res.json();
        if (json?.error) {
          const msg = `${json.error.message ?? ""} ${typeof json.error.data === "string" ? json.error.data : JSON.stringify(json.error.data ?? "")}`;
          if (/range|too many|limit exceeded|response size|query returned more/i.test(msg) && !/rate/i.test(msg)) throw new RangeTooBig(msg);
          throw new Error(`RPC error: ${msg}`);
        }
        mkdirSync(cfg.cacheDir, { recursive: true });
        writeFileSync(file, JSON.stringify(json));
        return json;
      } catch (e: any) {
        if (e instanceof RangeTooBig || String(e?.message).includes("not retried") || attempt >= 7) throw e;
        const backoff = Math.min(30_000, 1000 * 2 ** attempt);
        console.warn(`  retry ${attempt + 1} in ${backoff} ms: ${e?.message}`);
        await sleep(backoff);
      }
    }
  }

  const rpc = async (method: string, params: unknown[]) => (await http(cfg.rpc, { jsonrpc: "2.0", id: 1, method, params })).result;

  /** All logs in [from, to], fetched in block chunks that shrink when the node says a range is too big. */
  async function getLogs(filter: { address: string; topics?: (string | string[] | null)[] }, from: number, to: number, chunk = 20_000): Promise<Log[]> {
    const out: Log[] = [];
    let cur = from;
    let span = chunk;
    while (cur <= to) {
      const end = Math.min(to, cur + span - 1);
      try {
        const res = await rpc("eth_getLogs", [{ address: filter.address, topics: filter.topics, fromBlock: "0x" + cur.toString(16), toBlock: "0x" + end.toString(16) }]);
        for (const l of res as any[]) {
          out.push({
            blockNumber: parseInt(l.blockNumber, 16),
            logIndex: parseInt(l.logIndex, 16),
            ts: l.blockTimestamp ? parseInt(l.blockTimestamp, 16) : NaN,
            topics: (l.topics as string[]).map((t) => t.toLowerCase()),
            data: l.data,
            tx: (l.transactionHash as string).toLowerCase(),
          });
        }
        cur = end + 1;
        if (span < chunk) span = Math.min(chunk, span * 2);
      } catch (e) {
        if (!(e instanceof RangeTooBig) || span <= 1) throw e;
        span = Math.max(1, Math.floor(span / 4));
      }
    }
    if (out.some((l) => Number.isNaN(l.ts))) throw new Error("RPC did not return blockTimestamp on logs; use an RPC that does (e.g. Tenderly gateway)");
    return out.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  }

  const blockTs = async (n: number) => parseInt((await rpc("eth_getBlockByNumber", ["0x" + n.toString(16), false])).timestamp, 16);

  /** Highest block with timestamp <= ts (interpolation search). */
  async function blockAtOrBefore(ts: number, lo = cfg.searchLo, hi = cfg.searchHi): Promise<number> {
    let tLo = await blockTs(lo);
    let tHi = await blockTs(hi);
    while (hi - lo > 1) {
      let mid = lo + Math.round(((ts - tLo) / (tHi - tLo)) * (hi - lo));
      mid = Math.min(hi - 1, Math.max(lo + 1, mid));
      const t = await blockTs(mid);
      if (t <= ts) [lo, tLo] = [mid, t];
      else [hi, tHi] = [mid, t];
      if (hi - lo > 1 && (mid === lo + 1 || mid === hi - 1)) {
        const m2 = (lo + hi) >> 1;
        const t2 = await blockTs(m2);
        if (t2 <= ts) [lo, tLo] = [m2, t2];
        else [hi, tHi] = [m2, t2];
      }
    }
    return lo;
  }

  const call = async (to: string, data: string, block: number | "latest" = "latest") => String(await rpc("eth_call", [{ to, data }, typeof block === "number" ? "0x" + block.toString(16) : block]));

  /** Throws unless `pair` really is token0/token1 from `factory` (read on-chain, never assumed). */
  async function checkPair(pair: string, token0: string, token1: string, factory: string) {
    const addr = async (sel: string) => "0x" + (await call(pair, sel)).slice(-40).toLowerCase();
    const [t0, t1, f] = [await addr("0x0dfe1681"), await addr("0xd21220a7"), await addr("0xc45a0155")];
    if (t0 !== token0 || t1 !== token1 || f !== factory) throw new Error(`${pair} is not ${token0}/${token1} from factory ${factory} (got ${t0}/${t1}, factory ${f})`);
  }

  /** ERC-20 symbol/name/decimals read from the contract. */
  async function tokenInfo(token: string) {
    const str = (hex: string) => {
      if (hex.length >= 130) {
        const len = Number(BigInt("0x" + hex.slice(66, 130)));
        return Buffer.from(hex.slice(130, 130 + len * 2), "hex").toString("utf8");
      }
      return Buffer.from(hex.slice(2), "hex").toString("utf8").replace(/\0/g, "");
    };
    return { name: str(await call(token, "0x06fdde03")), symbol: str(await call(token, "0x95d89b41")), decimals: Number(BigInt(await call(token, "0x313ce567"))) };
  }

  async function verify() {
    const [t0, t1] = tokenIs0 ? [cfg.token, cfg.quote] : [cfg.quote, cfg.token];
    await checkPair(cfg.pair, t0.toLowerCase(), t1.toLowerCase(), cfg.factory.toLowerCase());
    const u = cfg.usdPool;
    const [s0, s1] = u.stable.toLowerCase() < cfg.quote.toLowerCase() ? [u.stable, cfg.quote] : [cfg.quote, u.stable];
    await checkPair(u.pair, s0.toLowerCase(), s1.toLowerCase(), u.factory.toLowerCase());
    const info = await tokenInfo(cfg.token);
    if (info.decimals !== cfg.tokenDecimals) throw new Error(`token decimals ${info.decimals} != config ${cfg.tokenDecimals}`);
    return info;
  }

  /** End-of-day series from the pair's Sync/Swap logs, priced through the stablecoin pool. */
  async function buildSeries(from: string, to: string, log = true) {
    const dates = dayList(from, to);
    const endTs = Date.parse(to + "T00:00:00Z") / 1000 + 86_399;
    const endBlock = await blockAtOrBefore(endTs);
    if (log) console.log(`pair logs ${cfg.pairCreatedBlock}..${endBlock}`);
    const logs = await getLogs({ address: cfg.pair, topics: [[TOPIC_SWAP, TOPIC_SYNC]] }, cfg.pairCreatedBlock, endBlock, cfg.logChunk ?? 8_000);
    if (log) console.log(`  ${logs.length} Swap/Sync logs`);
    // Swap data: amount0In, amount1In, amount0Out, amount1Out. Sync data: reserve0, reserve1.
    const qIn = tokenIs0 ? 1 : 0;
    const qOut = tokenIs0 ? 3 : 2;
    const reserves = (data: string) => (tokenIs0 ? { tok: word(data, 0), q: word(data, 1) } : { tok: word(data, 1), q: word(data, 0) });

    const byDay = new Map<string, { swaps: number; volWei: bigint; close?: { tok: bigint; q: bigint } }>();
    for (const l of logs) {
      const d = dayOf(l.ts);
      const b = byDay.get(d) ?? { swaps: 0, volWei: 0n };
      if (l.topics[0] === TOPIC_SWAP) {
        b.swaps++;
        b.volWei += word(l.data, qIn) + word(l.data, qOut);
      } else b.close = reserves(l.data);
      byDay.set(d, b);
    }

    const scale = (r: { tok: bigint; q: bigint }) => ratio(r.q * 10n ** BigInt(cfg.tokenDecimals), r.tok * 10n ** BigInt(cfg.quoteDecimals));
    const u = cfg.usdPool;
    const stableIs0 = u.stable.toLowerCase() < cfg.quote.toLowerCase();
    const days: Day[] = [];
    let res: { tok: bigint; q: bigint } | undefined;
    let searchLo = cfg.pairCreatedBlock - 10_000;
    for (const date of dates) {
      const b = byDay.get(date);
      if (b?.close) res = b.close; // no Sync that day => reserves unchanged
      const dayEndTs = Date.parse(date + "T00:00:00Z") / 1000 + 86_399;
      const dayEndBlock = await blockAtOrBefore(dayEndTs, searchLo, endBlock + 10_000);
      searchLo = dayEndBlock;
      const usdLogs = await getLogs({ address: u.pair, topics: [TOPIC_SYNC] }, dayEndBlock - 30, dayEndBlock, 31);
      if (!usdLogs.length) throw new Error(`no stablecoin-pool Sync near ${date}`);
      const ul = usdLogs[usdLogs.length - 1];
      const [rs, rq] = stableIs0 ? [word(ul.data, 0), word(ul.data, 1)] : [word(ul.data, 1), word(ul.data, 0)];
      const quoteUsd = toFloat(rs, u.stableDecimals) / toFloat(rq, cfg.quoteDecimals);
      if (!res) continue;
      const priceQuote = scale(res);
      const swaps = b?.swaps ?? 0;
      const volumeQuote = toFloat(b?.volWei ?? 0n, cfg.quoteDecimals);
      const day: Day = {
        date,
        endBlock: dayEndBlock,
        tokenReserve: res.tok,
        quoteReserve: res.q,
        priceQuote,
        quoteUsd,
        priceUsd: priceQuote * quoteUsd,
        liquidityUsd: 2 * toFloat(res.q, cfg.quoteDecimals) * quoteUsd,
        swaps,
        volumeQuote,
        volumeUsd: volumeQuote * quoteUsd,
      };
      days.push(day);
      if (log) console.log(`${date} swaps ${String(swaps).padStart(5)} price $${day.priceUsd.toExponential(3)} liq $${Math.round(day.liquidityUsd)} vol $${Math.round(day.volumeUsd)} quote $${quoteUsd.toFixed(0)}`);
    }
    const syncs: Sync[] = logs.filter((l) => l.topics[0] === TOPIC_SYNC).map((l) => ({ ts: l.ts, block: l.blockNumber, priceQuote: scale(reserves(l.data)) }));
    return { days, endBlock, totalSwaps: logs.length - syncs.length, syncs };
  }

  /** Distinct recipients of the token transferred out of the pair in [fromTs, toTs] (= buys from the pool). */
  async function buyersBetween(fromTs: number, toTs: number, exclude: string[] = []) {
    const from = (await blockAtOrBefore(fromTs - 1)) + 1;
    const to = await blockAtOrBefore(toTs);
    const logs = await getLogs({ address: cfg.token, topics: [TOPIC_TRANSFER, padAddr(cfg.pair)] }, from, to, 5_000);
    const skip = new Set([cfg.pair, cfg.router, DEAD, ZERO, cfg.token, ...exclude].filter(Boolean).map((a) => a!.toLowerCase()));
    const first = new Map<string, { firstBuy: string; txHash: string }>();
    for (const l of logs) {
      const r = topicAddr(l.topics[2]);
      if (skip.has(r) || first.has(r)) continue;
      first.set(r, { firstBuy: iso(l.ts), txHash: l.tx });
    }
    return { fromBlock: from, toBlock: to, transfers: logs.length, first };
  }

  return { rpc, http, getLogs, blockTs, blockAtOrBefore, call, checkPair, tokenInfo, verify, buildSeries, buyersBetween, tokenIs0 };
}

export const sig = (x: number, n = 4) => Number(x.toPrecision(n));
export const pct = (x: number) => Math.round(x * 10) / 10;
export const usd = (x: number) => "$" + Math.round(x).toLocaleString("en-US");

export function evenlySpaced<T>(xs: T[], n: number): T[] {
  if (xs.length <= n) return xs;
  return Array.from({ length: n }, (_, i) => xs[Math.round((i * (xs.length - 1)) / (n - 1))]);
}
