// "Did this wallet buy the coin, when, and right after which promoter post?"
//
// Reads ERC-20 Transfer events of the token straight from an Ethereum archive node (eth_getLogs with
// topic filters), so the answer is the blockchain's own record:
//   buys  = Transfer(from = the trading pool, to = the wallet)
//   sells = Transfer(from = the wallet, to = the trading pool)
// Each buy gets a dollar estimate (tokens x that day's closing pool price from the case file) and the
// documented promoter posts dated within the 3 days before it.
//
// Default node: Tenderly's free public gateway, the same one scripts/build-emax.mts uses. Override with RPC_URL.
// Requests are throttled (>= 250 ms apart), chunked by block range, and retried with backoff on 429 / 5xx.

import { getAddress, isAddress } from "viem";
import { documentedBy, inClassPeriod, priceOn, type HotlineCase } from "./caseFacts";

export const DEFAULT_RPC = "https://mainnet.gateway.tenderly.co";
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const etherscanTx = (h: string) => `https://etherscan.io/tx/${h}`;
export const etherscanAddress = (a: string) => `https://etherscan.io/address/${a}`;

// ---------- addresses ----------

export type AddressCheck = { ok: true; address: `0x${string}` } | { ok: false; reason: string };

/** A public Ethereum address: 0x + 40 hex characters; mixed case must carry a valid checksum. */
export function checkAddress(input: string): AddressCheck {
  const s = String(input ?? "").trim();
  if (!/^0x/i.test(s)) return { ok: false, reason: "An Ethereum address starts with 0x." };
  if (!/^0x[0-9a-fA-F]*$/.test(s)) return { ok: false, reason: "An address only has the digits 0–9 and the letters a–f after 0x." };
  if (s.length !== 42) return { ok: false, reason: `An address is 42 characters long; this one has ${s.length}.` };
  if (!isAddress(s, { strict: true })) return { ok: false, reason: "The capital letters don't match the address's checksum. Please copy it again." };
  return { ok: true, address: getAddress(s) };
}

/** Finds the first thing that looks like an address in free text. */
export const findAddress = (text: string) => /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/.exec(text)?.[0] ?? null;

// ---------- RPC ----------

export type Rpc = (method: string, params: unknown[]) => Promise<unknown>;

export class RpcError extends Error {
  constructor(
    message: string,
    public retryable: boolean,
    public rangeTooBig = false,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RANGE_ERR = /range|too many|limit|exceed|10000|response size|timeout/i;

/** JSON-RPC over HTTP with a minimum gap between requests and retries on 429 / 5xx / network errors. */
export function httpRpc(
  url: string = process.env.RPC_URL || DEFAULT_RPC,
  opts: { minGapMs?: number; retries?: number; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Rpc {
  const minGap = opts.minGapMs ?? 250;
  const retries = opts.retries ?? 4;
  const f = opts.fetchImpl ?? fetch;
  let last = 0;
  let id = 0;
  return async (method, params) => {
    for (let attempt = 0; ; attempt++) {
      const wait = last + minGap - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      try {
        const res = await f(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
        });
        if (res.status === 429 || res.status >= 500) throw new RpcError(`HTTP ${res.status}`, true);
        if (!res.ok) throw new RpcError(`HTTP ${res.status}`, false);
        const j = (await res.json()) as { result?: unknown; error?: { message?: string; code?: number } };
        if (j.error) {
          const msg = j.error.message ?? "RPC error";
          throw new RpcError(msg, /rate|busy|try again/i.test(msg), RANGE_ERR.test(msg));
        }
        return j.result;
      } catch (e) {
        const err = e instanceof RpcError ? e : new RpcError(e instanceof Error ? e.message : "network error", true);
        if (!err.retryable || attempt >= retries) throw err;
        await sleep(Math.min(8000, 600 * 2 ** attempt));
      }
    }
  };
}

type RawLog = { blockNumber: string; transactionHash: string; logIndex: string; data: string; blockTimestamp?: string; topics: string[] };

const pad = (a: string) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const hex = (n: number) => "0x" + n.toString(16);

/** All matching logs in [from, to], in chunks; a chunk the node finds too big is split in half and retried. */
export async function getLogsChunked(rpc: Rpc, filter: { address: string; topics: (string | string[] | null)[] }, from: number, to: number, chunk = 8_000_000): Promise<RawLog[]> {
  const out: RawLog[] = [];
  const queue: [number, number][] = [];
  for (let s = from; s <= to; s += chunk) queue.push([s, Math.min(to, s + chunk - 1)]);
  while (queue.length) {
    const [a, b] = queue.shift()!;
    try {
      const logs = (await rpc("eth_getLogs", [{ address: filter.address, topics: filter.topics, fromBlock: hex(a), toBlock: hex(b) }])) as RawLog[];
      out.push(...(logs ?? []));
    } catch (e) {
      if (e instanceof RpcError && e.rangeTooBig && b > a) {
        const mid = Math.floor((a + b) / 2);
        queue.unshift([a, mid], [mid + 1, b]);
        continue;
      }
      throw e;
    }
  }
  return out;
}

// ---------- amounts ----------

/** Integer token units -> decimal string, e.g. 7_600_000_000n * 10n**18n -> "7600000000". */
export function formatUnits(raw: bigint, decimals: number): string {
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

/** "7.62 billion", "432.1 million", "1,250": for people, not for evidence. */
export function humanTokens(amount: string | number): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  const units: [number, string][] = [
    [1e12, "trillion"],
    [1e9, "billion"],
    [1e6, "million"],
  ];
  for (const [u, name] of units) if (n >= u) return `${(n / u).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${name}`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

// ---------- the report ----------

export type PostBefore = {
  postId: string;
  promoter: string;
  postedAt: string; // as in the case file (day precision)
  daysBefore: number; // 0 = same day (post times are not documented, so it may have come later that day)
  platform: string;
  documentedBy: string;
  sourceUrl: string;
};

export type Purchase = {
  txHash: string;
  txUrl: string;
  blockNumber: number;
  at: string; // ISO UTC, from the block
  date: string; // YYYY-MM-DD (UTC)
  amount: string; // tokens, exact decimal string
  priceUsd: number | null; // that day's closing pool price
  usdEstimate: number | null; // amount x priceUsd, rounded to cents
  inClassPeriod: boolean;
  postsBefore: PostBefore[];
};

export type Sale = Omit<Purchase, "postsBefore" | "inClassPeriod">;

export type PurchaseReport = {
  status: "ok";
  address: string; // checksummed
  addressUrl: string;
  token: { symbol: string; address: string; pair: string; pairDex?: string };
  checkedAt: string;
  source: { label: string; url: string; fromBlock: number; toBlock: number };
  purchases: Purchase[];
  sales: Sale[];
  totals: {
    purchases: number;
    sales: number;
    boughtTokens: string;
    soldTokens: string;
    boughtUsd: number | null; // sum of the estimates that have a price
    soldUsd: number | null;
    inClassPeriod: number;
    afterAPost: number; // purchases with at least one documented post in the 3 days before
  };
  truncated: boolean;
  method: string;
  notes: string[];
};

const DAY = 86_400_000;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / DAY);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Documented posts dated on the day of the buy or up to 3 days before (≈ the 72 hours before it, at day precision). */
export function postsBefore(k: HotlineCase, buyDate: string): PostBefore[] {
  return k.posts
    .filter((p) => p.datePrecision !== "month")
    .map((p) => ({ p, d: dayDiff(buyDate, p.postedAt.slice(0, 10)) }))
    .filter(({ d }) => d >= 0 && d <= 3)
    .sort((x, y) => x.d - y.d)
    .map(({ p, d }) => ({
      postId: p.id,
      promoter: p.promoter,
      postedAt: p.postedAt,
      daysBefore: d,
      platform: p.platform,
      documentedBy: documentedBy(p),
      sourceUrl: p.sources[0]?.url ?? "",
    }));
}

function toRow(k: HotlineCase, l: RawLog) {
  const raw = BigInt(l.data === "0x" ? 0 : l.data);
  const amount = formatUnits(raw, k.token.decimals);
  const ts = l.blockTimestamp ? parseInt(l.blockTimestamp, 16) * 1000 : NaN;
  const at = Number.isFinite(ts) ? new Date(ts).toISOString().replace(".000Z", "Z") : "";
  const date = at.slice(0, 10);
  const priceUsd = date ? priceOn(k, date) : null;
  return {
    txHash: l.transactionHash,
    txUrl: etherscanTx(l.transactionHash),
    blockNumber: parseInt(l.blockNumber, 16),
    logIndex: parseInt(l.logIndex ?? "0x0", 16),
    at,
    date,
    amount,
    priceUsd,
    usdEstimate: priceUsd != null ? round2(Number(amount) * priceUsd) : null,
  };
}

const sumStr = (xs: string[], decimals: number) => {
  const base = 10n ** BigInt(decimals);
  let total = 0n;
  for (const x of xs) {
    const [w, f = ""] = x.split(".");
    total += BigInt(w) * base + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
  }
  return formatUnits(total, decimals);
};
const sumUsd = (xs: (number | null)[]) => (xs.some((x) => x != null) ? round2(xs.reduce<number>((a, x) => a + (x ?? 0), 0)) : null);

/** Fills in block timestamps for nodes that don't return blockTimestamp on logs. */
async function fillTimestamps(rpc: Rpc, logs: RawLog[]) {
  const missing = [...new Set(logs.filter((l) => !l.blockTimestamp).map((l) => l.blockNumber))].slice(0, 60);
  for (const bn of missing) {
    const b = (await rpc("eth_getBlockByNumber", [bn, false])) as { timestamp?: string } | null;
    for (const l of logs) if (l.blockNumber === bn && b?.timestamp) l.blockTimestamp = b.timestamp;
  }
}

/**
 * Looks up a wallet's buys and sells of the case's token on its main pool.
 * Throws RpcError if the node can't be reached; the caller decides what to tell the person.
 */
export async function findPurchases(
  address: string,
  k: HotlineCase,
  opts: { rpc?: Rpc; rpcLabel?: string; now?: () => Date; maxItems?: number; toBlock?: number } = {},
): Promise<PurchaseReport> {
  const check = checkAddress(address);
  if (!check.ok) throw new Error(check.reason);
  if (!k.token.pair) throw new Error("This case has no trading pool on file.");
  const rpc = opts.rpc ?? httpRpc();
  const max = opts.maxItems ?? 200;
  const toBlock = opts.toBlock ?? parseInt(String(await rpc("eth_blockNumber", [])), 16);
  const fromBlock = k.pairCreatedBlock;
  // One query for both directions: from ∈ {pool, wallet} and to ∈ {wallet, pool}, split afterwards.
  const P = pad(k.token.pair);
  const W = pad(check.address);
  const logs = await getLogsChunked(rpc, { address: k.token.address, topics: [TRANSFER_TOPIC, [P, W], [W, P]] }, fromBlock, toBlock);
  const buyLogs = logs.filter((l) => l.topics[1]?.toLowerCase() === P && l.topics[2]?.toLowerCase() === W);
  const sellLogs = logs.filter((l) => l.topics[1]?.toLowerCase() === W && l.topics[2]?.toLowerCase() === P);
  const order = (a: RawLog, b: RawLog) => parseInt(a.blockNumber, 16) - parseInt(b.blockNumber, 16) || parseInt(a.logIndex ?? "0x0", 16) - parseInt(b.logIndex ?? "0x0", 16);
  buyLogs.sort(order);
  sellLogs.sort(order);
  const truncated = buyLogs.length > max || sellLogs.length > max;
  const buys = buyLogs.slice(0, max);
  const sells = sellLogs.slice(0, max);
  await fillTimestamps(rpc, [...buys, ...sells]);

  const purchases: Purchase[] = buys.map((l) => {
    const r = toRow(k, l);
    return {
      txHash: r.txHash,
      txUrl: r.txUrl,
      blockNumber: r.blockNumber,
      at: r.at,
      date: r.date,
      amount: r.amount,
      priceUsd: r.priceUsd,
      usdEstimate: r.usdEstimate,
      inClassPeriod: r.date ? inClassPeriod(k, r.date) : false,
      postsBefore: r.date ? postsBefore(k, r.date) : [],
    };
  });
  const sales: Sale[] = sells.map((l) => {
    const r = toRow(k, l);
    return { txHash: r.txHash, txUrl: r.txUrl, blockNumber: r.blockNumber, at: r.at, date: r.date, amount: r.amount, priceUsd: r.priceUsd, usdEstimate: r.usdEstimate };
  });

  const notes = [
    `Only buys straight from the ${k.token.pairDex ?? "main"} pool ${k.token.pair} are seen. Buys through another pool, an aggregator that forwards the tokens, or a centralized exchange are not.`,
    `Dollar figures are estimates: tokens multiplied by that day's closing price of the pool (from the case file, ${k.priceRange.from} to ${k.priceRange.to}). They are not what was actually paid.`,
    `Promoter posts are matched by date only (posted on the day of the purchase or up to 3 days before), because no source gives the time of day of a post.`,
  ];
  if (k.slug === "emax")
    notes.push("EMAX trading from May 14 to May 24, 2021 happened on an older token contract and is not checked here (see the case file's data notes).");
  if (purchases.some((p) => !p.priceUsd)) notes.push("Some purchases fall outside the dates the case file has prices for, so they have no dollar estimate.");
  if (truncated) notes.push(`This wallet has more than ${max} transfers with the pool; only the first ${max} of each kind are listed.`);

  return {
    status: "ok",
    address: check.address,
    addressUrl: etherscanAddress(check.address),
    token: { symbol: k.token.symbol, address: k.token.address, pair: k.token.pair, pairDex: k.token.pairDex },
    checkedAt: (opts.now?.() ?? new Date()).toISOString(),
    source: { label: opts.rpcLabel ?? "Ethereum mainnet, eth_getLogs on a public archive node", url: process.env.RPC_URL ? "custom RPC_URL" : DEFAULT_RPC, fromBlock, toBlock },
    purchases,
    sales,
    totals: {
      purchases: purchases.length,
      sales: sales.length,
      boughtTokens: sumStr(purchases.map((p) => p.amount), k.token.decimals),
      soldTokens: sumStr(sales.map((s) => s.amount), k.token.decimals),
      boughtUsd: sumUsd(purchases.map((p) => p.usdEstimate)),
      soldUsd: sumUsd(sales.map((s) => s.usdEstimate)),
      inClassPeriod: purchases.filter((p) => p.inClassPeriod).length,
      afterAPost: purchases.filter((p) => p.postsBefore.length > 0).length,
    },
    truncated,
    method: `ERC-20 Transfer events of ${k.token.symbol} (${k.token.address}) with from = the pool and to = the wallet (buys), and the reverse (sells), from block ${fromBlock} (the pool's creation) to block ${toBlock}.`,
    notes,
  };
}

// ---------- no wallet: bought on an exchange ----------

export type NoWalletRecord = {
  status: "no-wallet";
  exchange: string | null;
  description: string; // the person's own words
  note: string;
};

export function noWalletRecord(exchange: string | null, description: string): NoWalletRecord {
  return {
    status: "no-wallet",
    exchange: exchange?.trim() || null,
    description: description.trim().slice(0, 2000),
    note: "Bought through an exchange or app, so the purchase isn't visible on the blockchain under the person's own address. The exchange's account statement is the best proof of the purchase.",
  };
}
