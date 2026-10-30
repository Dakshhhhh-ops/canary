/**
 * Rebuilds data/cases/emax.json — the EthereumMax (EMAX) case file — from public sources.
 *
 *   npx tsx scripts/build-emax.mts            (reuses a local cache of API answers if present)
 *   npx tsx scripts/build-emax.mts --fresh    (ignores the cache and refetches everything)
 *
 * Where the on-chain numbers come from
 *  - Ethereum mainnet event logs via a public JSON-RPC archive node (Tenderly's public gateway,
 *    https://mainnet.gateway.tenderly.co — no key needed). Override with RPC_URL=... to use your own.
 *    Every log it returns carries the block timestamp, so days are bucketed exactly (UTC).
 *  - Holder concentration (current) via the Blockscout API v2 (https://eth.blockscout.com/api/v2).
 *  Requests are sequential, at least 300 ms apart, and retried with backoff on HTTP 429 / 5xx.
 *
 * What it computes
 *  - Daily EMAX price and pool liquidity from the Uniswap V2 EMAX/WETH pair: the pair's reserves
 *    after its last `Sync` event of each UTC day (the end-of-day pool state).
 *  - Daily ETH/USD from the Uniswap V2 USDC/WETH pair, same method — so every USD figure is
 *    derived on-chain from one public ledger, with no third-party price feed.
 *  - Daily volume: the WETH side of every `Swap` on the EMAX pair that day, valued at that day's ETH/USD.
 *  - Buyers: distinct addresses that received EMAX directly from the pair (= bought from the pool).
 *
 * Text facts (posts, legal actions) are typed in below with their sources; they were read from the
 * SEC orders and court order cited next to each one. Nothing is generated: if a source did not state
 * something, the field is left out.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CaseFile, PricePoint, PromoterPost, LegalAction, Source } from "../src/lib/types";

// ---------------------------------------------------------------------------------------------
// Addresses (checked on-chain at run time by checkPair) and event signatures
// ---------------------------------------------------------------------------------------------
const RPC = process.env.RPC_URL ?? "https://mainnet.gateway.tenderly.co";
const BLOCKSCOUT_V2 = "https://eth.blockscout.com/api/v2";

const EMAX = "0x15874d65e649880c2614e7a480cb7c9a55787ff6"; // EthereumMax (EMAX) v2, created 2021-05-25 01:31 UTC
const EMAX_V1 = "0xa3e059c0b01f07f211c85bf7b4f1d907afb011df"; // "EthereumMax (Deprecated)", created 2021-05-12
const PAIR = "0xb6ca52c7916ad7960c12dc489fd93e5af7ca257f"; // Uniswap V2 EMAX/WETH, created 2021-05-25 10:39 UTC, block 12503000
const PAIR_CREATED_BLOCK = 12503000;
const USDC_WETH = "0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc"; // Uniswap V2 USDC/WETH
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const UNIV2_FACTORY = "0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f";
const UNIV2_ROUTER = "0x7a250d5630b4cf539739df2c5dacb4c659f2488d";
const DEAD = "0x000000000000000000000000000000000000dead";
const ZERO = "0x0000000000000000000000000000000000000000";

const TOPIC_SYNC = "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1";
const TOPIC_SWAP = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";
const TOPIC_TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const SERIES_FROM = "2021-05-25"; // first day the v2 pair existed
const SERIES_TO = "2021-09-30";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "data", "cases", "emax.json");
const CACHE_DIR = join(tmpdir(), "canary-emax-cache");
const FRESH = process.argv.includes("--fresh");

// ---------------------------------------------------------------------------------------------
// Polite HTTP with an on-disk cache (in the OS temp dir, so re-runs are fast and cheap)
// ---------------------------------------------------------------------------------------------
let lastCall = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class RangeTooBig extends Error {}

async function http(url: string, body?: unknown): Promise<any> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const key = createHash("sha1").update(url + (payload ?? "")).digest("hex");
  const file = join(CACHE_DIR, key + ".json");
  if (!FRESH && existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
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
      mkdirSync(CACHE_DIR, { recursive: true });
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

const rpc = async (method: string, params: unknown[]) => (await http(RPC, { jsonrpc: "2.0", id: 1, method, params })).result;

type Log = { blockNumber: number; logIndex: number; ts: number; topics: string[]; data: string; tx: string };

/** All logs in [from, to], fetched in block chunks that shrink when the node says a range is too big. */
async function getLogs(filter: { address: string; topics?: (string | null)[] }, from: number, to: number, chunk = 20_000): Promise<Log[]> {
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
async function blockAtOrBefore(ts: number, lo = PAIR_CREATED_BLOCK - 200_000, hi = 13_500_000): Promise<number> {
  let tLo = await blockTs(lo);
  let tHi = await blockTs(hi);
  while (hi - lo > 1) {
    let mid = lo + Math.round(((ts - tLo) / (tHi - tLo)) * (hi - lo));
    mid = Math.min(hi - 1, Math.max(lo + 1, mid));
    const t = await blockTs(mid);
    if (t <= ts) [lo, tLo] = [mid, t];
    else [hi, tHi] = [mid, t];
    // when interpolation stalls, bisect
    if (hi - lo > 1 && (mid === lo + 1 || mid === hi - 1)) {
      const m2 = (lo + hi) >> 1;
      const t2 = await blockTs(m2);
      if (t2 <= ts) [lo, tLo] = [m2, t2];
      else [hi, tHi] = [m2, t2];
    }
  }
  return lo;
}

const word = (data: string, i: number) => BigInt("0x" + data.slice(2 + 64 * i, 2 + 64 * (i + 1)));
const topicAddr = (t: string) => "0x" + t.slice(-40).toLowerCase();
const padAddr = (a: string) => "0x" + a.toLowerCase().slice(2).padStart(64, "0");
const toFloat = (x: bigint, decimals = 18) => Number(x) / 10 ** decimals;
const ratio = (num: bigint, den: bigint) => Number((num * 10n ** 30n) / den) / 1e30;
const dayOf = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const iso = (ts: number) => new Date(ts * 1000).toISOString().replace(".000Z", "Z");

async function checkPair(pair: string, token0: string, token1: string) {
  const call = async (sel: string) => "0x" + String(await rpc("eth_call", [{ to: pair, data: sel }, "latest"])).slice(-40).toLowerCase();
  const [t0, t1, f] = [await call("0x0dfe1681"), await call("0xd21220a7"), await call("0xc45a0155")];
  if (t0 !== token0 || t1 !== token1 || f !== UNIV2_FACTORY) throw new Error(`${pair} is not ${token0}/${token1} on Uniswap V2 (got ${t0}/${t1}, factory ${f})`);
}

// ---------------------------------------------------------------------------------------------
// Daily series
// ---------------------------------------------------------------------------------------------
type Day = {
  date: string;
  endBlock: number;
  emaxReserve: bigint;
  wethReserve: bigint;
  priceEth: number; // WETH per EMAX at end of day
  ethUsd: number; // USDC per WETH at end of day
  priceUsd: number;
  liquidityUsd: number; // both sides of the pool: 2 x WETH reserve x ETH/USD
  swaps: number;
  volumeEth: number;
  volumeUsd: number;
};

function dayList(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(from + "T00:00:00Z"); t <= Date.parse(to + "T00:00:00Z"); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

async function buildSeries(): Promise<{ days: Day[]; endBlock: number; totalSwaps: number; syncs: { ts: number; block: number; priceEth: number }[] }> {
  const dates = dayList(SERIES_FROM, SERIES_TO);
  const endTs = Date.parse(SERIES_TO + "T00:00:00Z") / 1000 + 86_399;
  const endBlock = await blockAtOrBefore(endTs);
  console.log(`pair logs ${PAIR_CREATED_BLOCK}..${endBlock}`);
  const logs = await getLogs({ address: PAIR, topics: [[TOPIC_SWAP, TOPIC_SYNC] as any] }, PAIR_CREATED_BLOCK, endBlock, 8_000);
  console.log(`  ${logs.length} Swap/Sync logs`);

  const byDay = new Map<string, { swaps: number; volWei: bigint; close?: { r0: bigint; r1: bigint } }>();
  for (const l of logs) {
    const d = dayOf(l.ts);
    const b = byDay.get(d) ?? { swaps: 0, volWei: 0n };
    if (l.topics[0] === TOPIC_SWAP) {
      b.swaps++;
      b.volWei += word(l.data, 1) + word(l.data, 3); // amount1In + amount1Out = WETH side
    } else b.close = { r0: word(l.data, 0), r1: word(l.data, 1) };
    byDay.set(d, b);
  }

  const days: Day[] = [];
  let reserves: { r0: bigint; r1: bigint } | undefined;
  let searchLo = PAIR_CREATED_BLOCK - 10_000;
  for (const date of dates) {
    const b = byDay.get(date);
    if (b?.close) reserves = b.close; // no Sync that day => reserves unchanged
    const dayEndTs = Date.parse(date + "T00:00:00Z") / 1000 + 86_399;
    const dayEndBlock = await blockAtOrBefore(dayEndTs, searchLo, endBlock + 10_000);
    searchLo = dayEndBlock;
    // ETH/USD: last USDC/WETH Sync at or before the end of the day.
    const usdLogs = await getLogs({ address: USDC_WETH, topics: [TOPIC_SYNC] }, dayEndBlock - 30, dayEndBlock, 31);
    if (!usdLogs.length) throw new Error(`no USDC/WETH Sync near ${date}`);
    const u = usdLogs[usdLogs.length - 1];
    const ethUsd = toFloat(word(u.data, 0), 6) / toFloat(word(u.data, 1), 18);
    if (!reserves) continue;
    const priceEth = ratio(reserves.r1, reserves.r0);
    const swaps = b?.swaps ?? 0;
    const volumeEth = toFloat(b?.volWei ?? 0n);
    const day: Day = {
      date,
      endBlock: dayEndBlock,
      emaxReserve: reserves.r0,
      wethReserve: reserves.r1,
      priceEth,
      ethUsd,
      priceUsd: priceEth * ethUsd,
      liquidityUsd: 2 * toFloat(reserves.r1) * ethUsd,
      swaps,
      volumeEth,
      volumeUsd: volumeEth * ethUsd,
    };
    days.push(day);
    console.log(`${date} swaps ${String(swaps).padStart(5)} price $${day.priceUsd.toExponential(3)} liq $${Math.round(day.liquidityUsd)} vol $${Math.round(day.volumeUsd)} ETH $${ethUsd.toFixed(0)}`);
  }
  const syncs = logs.filter((l) => l.topics[0] === TOPIC_SYNC).map((l) => ({ ts: l.ts, block: l.blockNumber, priceEth: ratio(word(l.data, 1), word(l.data, 0)) }));
  return { days, endBlock, totalSwaps: logs.length - syncs.length, syncs };
}

// ---------------------------------------------------------------------------------------------
// Buyers: distinct recipients of EMAX transferred out of the pair in [fromTs, toTs]
// ---------------------------------------------------------------------------------------------
async function buyersBetween(fromTs: number, toTs: number) {
  const from = (await blockAtOrBefore(fromTs - 1)) + 1;
  const to = await blockAtOrBefore(toTs);
  const logs = await getLogs({ address: EMAX, topics: [TOPIC_TRANSFER, padAddr(PAIR)] }, from, to, 5_000);
  const exclude = new Set([PAIR, UNIV2_ROUTER, DEAD, ZERO]);
  const first = new Map<string, { firstBuy: string; txHash: string }>();
  for (const l of logs) {
    const to = topicAddr(l.topics[2]);
    if (exclude.has(to) || first.has(to)) continue;
    first.set(to, { firstBuy: iso(l.ts), txHash: l.tx });
  }
  return { fromBlock: from, toBlock: to, transfers: logs.length, first };
}

/** EMAX sent to the burn address in [fromTs, toTs] (checks the "burned 400 trillion tokens" claim). */
async function burnsBetween(fromTs: number, toTs: number) {
  const from = (await blockAtOrBefore(fromTs - 1)) + 1;
  const to = await blockAtOrBefore(toTs);
  const logs = await getLogs({ address: EMAX, topics: [TOPIC_TRANSFER, null, padAddr(DEAD)] }, from, to, 20_000);
  return logs.map((l) => ({ at: iso(l.ts), ts: l.ts, block: l.blockNumber, from: topicAddr(l.topics[1]), amount: toFloat(word(l.data, 0)), tx: l.tx }));
}

async function balanceAt(token: string, holder: string, block: number) {
  return BigInt(await rpc("eth_call", [{ to: token, data: "0x70a08231" + holder.slice(2).padStart(64, "0") }, "0x" + block.toString(16)]));
}

// ---------------------------------------------------------------------------------------------
// Holder concentration (current snapshot, Blockscout)
// ---------------------------------------------------------------------------------------------
async function holders() {
  const token = await http(`${BLOCKSCOUT_V2}/tokens/${EMAX}`);
  const list = await http(`${BLOCKSCOUT_V2}/tokens/${EMAX}/holders`);
  const total = BigInt(token.total_supply);
  const items: { addr: string; value: bigint; name: string | null; contract: boolean }[] = list.items.map((h: any) => ({
    addr: h.address.hash.toLowerCase(),
    value: BigInt(h.value),
    name: h.address.name ?? null,
    contract: !!h.address.is_contract,
  }));
  const dead = items.filter((h) => h.addr === DEAD).reduce((s, h) => s + h.value, 0n);
  const top10 = items.filter((h) => h.addr !== DEAD).slice(0, 10);
  const top10Sum = top10.reduce((s, h) => s + h.value, 0n);
  const listedSum = items.reduce((s, h) => s + h.value, 0n); // first page only (largest holders)
  return { pct: Number((top10Sum * 1_000_000n) / (total - dead)) / 10_000, holdersCount: Number(token.holders_count), top10, total, dead, listedSum, top3: items.slice(0, 3) };
}

// ---------------------------------------------------------------------------------------------
// Sourced facts (read from the documents linked; quotes are exact, including the authors' spelling)
// ---------------------------------------------------------------------------------------------
const S = {
  secKardashianRelease: { label: "SEC press release 2022-183 (Oct. 3, 2022): SEC Charges Kim Kardashian for Unlawfully Touting Crypto Security", url: "https://www.sec.gov/newsroom/press-releases/2022-183" },
  secKardashianOrder: { label: "SEC order, In the Matter of Kimberly Kardashian, Securities Act Rel. No. 11116, File No. 3-21197 (Oct. 3, 2022)", url: "https://www.sec.gov/litigation/admin/2022/33-11116.pdf" },
  secPierceRelease: { label: "SEC press release 2023-34 (Feb. 17, 2023): SEC Charges NBA Hall of Famer Paul Pierce for Unlawfully Touting and Making Misleading Statements about Crypto Security", url: "https://www.sec.gov/newsroom/press-releases/2023-34" },
  secPierceOrder: { label: "SEC order, In the Matter of Paul Anthony Pierce, Securities Act Rel. No. 11157, File No. 3-21305 (Feb. 17, 2023)", url: "https://www.sec.gov/litigation/admin/2023/33-11157.pdf" },
  secMayweather2018: { label: "SEC press release 2018-268 (Nov. 29, 2018): Two Celebrities Charged With Unlawfully Touting Coin Offerings", url: "https://www.sec.gov/newsroom/press-releases/2018-268" },
  courtDec2022: { label: "C.D. Cal. order on motions to dismiss, In re EthereumMax Investor Litigation, No. 2:22-cv-00163-MWF, Dkt. 99 (Dec. 6, 2022) — copy hosted by John Reed Stark", url: "https://www.johnreedstark.com/wp-content/uploads/sites/180/2022/12/Kardasnhian-Dismissil.pdf" },
  docket: { label: "CourtListener docket: In re EthereumMax Investor Litigation, 2:22-cv-00163 (C.D. Cal.)", url: "https://www.courtlistener.com/docket/61802418/in-re-ethereummax-investor-litigation/" },
  fortuneFiling: { label: "Fortune (Jan. 11, 2022): Kim Kardashian and Floyd Mayweather sued over promotion of crypto token", url: "https://fortune.com/2022/01/11/kim-kardashian-floyd-mayweather-crypto-token-ethereummax-lawsuit" },
  nbcFiling: { label: "NBC News (Jan. 12, 2022): Kim Kardashian and Floyd Mayweather sued by investors over alleged crypto scam", url: "https://www.nbcnews.com/tech/tech-news/kim-kardashian-floyd-mayweather-sued-investors-alleged-crypto-scam-rcna11921" },
  scottJun2023: { label: "Scott+Scott (plaintiffs' co-counsel), June 8, 2023: Court Refuses to Dismiss the EthereumMax Case", url: "https://scott-scott.com/court-refuses-to-dismiss-the-ethereummax-case/" },
  coinspeakerJun2023: { label: "Coinspeaker (June 7, 2023): Kim Kardashian EMAX Case Proceeds as California Judge Rejects Motion to Dismiss", url: "https://www.coinspeaker.com/kim-kardashian-emax-case-proceeds/" },
  ctAug2025: { label: "Cointelegraph (Aug. 8, 2025): EthereumMax investors secure partial win in class action lawsuit", url: "https://cointelegraph.com/news/ethereummax-class-action-lawsuit-celebrities" },
  wikiFight: { label: "Wikipedia: Floyd Mayweather Jr. vs. Logan Paul (date and venue of the exhibition)", url: "https://en.wikipedia.org/wiki/Floyd_Mayweather_Jr._vs._Logan_Paul" },
  bsToken: { label: "Blockscout: EthereumMax (EMAX) token contract", url: `https://eth.blockscout.com/token/0x15874d65e649880c2614e7a480cb7c9A55787FF6` },
  bsTokenV1: { label: "Blockscout: EthereumMax (Deprecated) — the first EMAX contract", url: `https://eth.blockscout.com/token/0xA3E059c0b01F07F211c85bF7b4f1d907AfB011df` },
  bsPair: { label: "Blockscout: Uniswap V2 EMAX/WETH pair", url: `https://eth.blockscout.com/address/0xb6CA52c7916ad7960C12Dc489FD93E5Af7cA257f` },
  bsUsdcPair: { label: "Blockscout: Uniswap V2 USDC/WETH pair (ETH/USD reference)", url: `https://eth.blockscout.com/address/0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc` },
  rpc: { label: "Ethereum mainnet event logs via Tenderly public RPC gateway (eth_getLogs)", url: "https://mainnet.gateway.tenderly.co" },
  script: { label: "Build script that recomputes every on-chain number in this file", url: "scripts/build-emax.mts" },
} satisfies Record<string, Source>;

const PIERCE = { promoter: "Paul Pierce", handle: "@paulpierce34", platform: "x" as const, followers: 4_000_000 };

const POSTS: PromoterPost[] = [
  {
    id: "pierce-2021-05-26",
    ...PIERCE,
    postedAt: "2021-05-26",
    datePrecision: "day",
    text: ".@espn I don't need you. I got @ethereum_max I made more money with this crypto in the past month then I did with y'all in a year. TRUTH shall set u Free 🤪🤪 my own Boss EthereumMax.org check it out for yourself",
    disclosedPayment: false,
    paid: { amountUsd: 244_116, by: "EthereumMax and/or its agents, in EMAX tokens (total for all of Pierce's promotional tweets, received May 24 – June 18, 2021)" },
    sources: [S.secPierceOrder, S.secPierceRelease],
  },
  {
    id: "pierce-2021-05-28",
    ...PIERCE,
    postedAt: "2021-05-28",
    datePrecision: "day",
    disclosedPayment: false,
    sources: [S.secPierceOrder],
  },
  {
    id: "pierce-2021-05-29",
    ...PIERCE,
    postedAt: "2021-05-29",
    datePrecision: "day",
    text: "The Goal is 1$ @ethereum_max only then will be out",
    disclosedPayment: false,
    sources: [S.secPierceOrder],
  },
  {
    id: "pierce-2021-05-30-train",
    ...PIERCE,
    postedAt: "2021-05-30",
    datePrecision: "day",
    text: "People asking if they should jump on the @ethereum_max train I'm n for the long haul if u missed out on the 1st wave now is the time to jump on board . . . .",
    disclosedPayment: false,
    sources: [S.secPierceOrder, S.courtDec2022],
  },
  {
    id: "pierce-2021-05-30-coach",
    ...PIERCE,
    postedAt: "2021-05-30",
    datePrecision: "day",
    text: "Put me in coach coming in Hot like @jaytatum0 @espn @ethereum_max 🚀🚀🚀🚀🚀🚀🚀🚀",
    disclosedPayment: false,
    sources: [S.secPierceOrder],
  },
  {
    id: "pierce-2021-06-05",
    ...PIERCE,
    postedAt: "2021-06-05",
    datePrecision: "day",
    text: "Gonna double down know @ethereum_max",
    disclosedPayment: false,
    sources: [S.secPierceOrder],
  },
  {
    id: "kardashian-2021-05-30",
    promoter: "Kim Kardashian",
    handle: "@kimkardashian",
    platform: "instagram",
    postedAt: "2021-05-30",
    datePrecision: "day",
    text: "GROOT HOSPITALITY · LIV · STORY · NOW ACCEPTING CRYPTOCURRENCY FOR ALL TABLE RESERVATIONS & BOOKINGS · EXCLUSIVELY ACCEPTING · EthereumMax.org",
    disclosedPayment: false,
    sources: [S.courtDec2022],
  },
  {
    id: "kardashian-2021-06-13",
    promoter: "Kim Kardashian",
    handle: "@kimkardashian",
    platform: "instagram",
    followers: 225_000_000,
    postedAt: "2021-06-13",
    datePrecision: "day",
    text: "ARE YOU GUYS INTO CRYPTO???? THIS IS NOT FINANCIAL ADVICE BUT SHARING WHAT MY FRIENDS JUST TOLD ME ABOUT THE ETHEREUM MAX TOKEN! A FEW MINUTES AGO ETHEREUM MAX BURNED 400 TRILLION TOKENS- LITERALLY 50% OF THEIR ADMIN WALLET GIVING BACK TO THE ENTIRE E-MAX COMMUNITY. #EMAX #DISRUPTHISTORY #ETHEREUMMAX #WTFEMAX #GIOPEMAX @ETHEREUMMAX #AD SWIPE UP",
    disclosedPayment: false,
    paid: { amountUsd: 250_000, by: "EthereumMax, through an intermediary" },
    sources: [S.secKardashianOrder, S.secKardashianRelease],
  },
  {
    id: "mayweather-2021-05-26",
    promoter: "Floyd Mayweather Jr.",
    platform: "other",
    postedAt: "2021-05-26",
    datePrecision: "day",
    disclosedPayment: null,
    sources: [S.courtDec2022, S.nbcFiling],
  },
  {
    id: "mayweather-2021-06-conference",
    promoter: "Floyd Mayweather Jr.",
    platform: "other",
    postedAt: "2021-06-01",
    datePrecision: "month",
    text: "I believe there's gonna be another cryptocurrency just as large as Bitcoin someday.",
    disclosedPayment: null,
    sources: [S.courtDec2022, S.nbcFiling],
  },
  {
    id: "mayweather-2021-06-06",
    promoter: "Floyd Mayweather Jr.",
    platform: "other",
    postedAt: "2021-06-06",
    datePrecision: "day",
    disclosedPayment: null,
    sources: [S.nbcFiling, S.wikiFight],
  },
];

const LEGAL: LegalAction[] = [
  {
    id: "sec-kardashian",
    kind: "sec",
    title: "SEC v. Kardashian (settled cease-and-desist order)",
    date: "2022-10-03",
    summary:
      "The SEC found that Kim Kardashian was paid $250,000 by EthereumMax, through an intermediary, to post about EMAX tokens on Instagram on June 13, 2021, to about 225 million followers, and did not say she was paid or how much. The post linked to the EthereumMax website, which told people how to buy. The SEC treated EMAX as a security (an investment contract).",
    outcome:
      "Settled without admitting or denying the findings: $250,000 disgorgement + $10,415.35 interest + $1,000,000 penalty (about $1.26 million); no paid promotion of crypto asset securities for three years; cooperation with the continuing investigation.",
    statute: "Securities Act of 1933, Section 17(b) (anti-touting)",
    sources: [S.secKardashianRelease, S.secKardashianOrder],
  },
  {
    id: "sec-pierce",
    kind: "sec",
    title: "SEC v. Pierce (settled cease-and-desist order)",
    date: "2023-02-17",
    summary:
      "The SEC found that Paul Pierce was paid EMAX tokens worth about $244,116 to promote them on Twitter (May 26 – June 5, 2021) without saying so, and that his tweets were misleading: he claimed big profits two days after first being paid, posted a screenshot of someone else's $2.5 million EMAX holdings as if it were his, and said he was holding and buying more while he was selling.",
    outcome:
      "Settled without admitting or denying the findings: $244,116 disgorgement + $15,449 interest + $1,150,000 penalty per the order (about $1.409 million in total); no paid promotion of crypto asset securities for three years.",
    statute: "Securities Act of 1933, Sections 17(a)(2) (misleading statements) and 17(b) (anti-touting)",
    sources: [S.secPierceRelease, S.secPierceOrder],
  },
  {
    id: "class-action-filed",
    kind: "class-action",
    title: "Investor class action filed: Huegerich v. Gentile et al. (now In re EthereumMax Investor Litigation), C.D. Cal. No. 2:22-cv-00163",
    date: "2022-01-07",
    summary:
      "A New York investor, Ryan Huegerich, sued EthereumMax's founders and promoters Kim Kardashian, Floyd Mayweather Jr. and Paul Pierce in federal court in Los Angeles for buyers from mid-May to late June 2021, alleging celebrity promotions were used to pump the token's price so insiders could sell.",
    sources: [S.fortuneFiling, S.nbcFiling, S.docket],
  },
  {
    id: "class-action-dismissed-2022",
    kind: "class-action",
    title: "In re EthereumMax Investor Litigation — first complaint dismissed with leave to amend",
    date: "2022-12-06",
    summary:
      "Judge Michael W. Fitzgerald dismissed the consolidated complaint, mostly because the fraud claims were not pleaded with enough detail (for example, that buyers actually saw and relied on the posts). Investors were allowed to refile most claims; the federal racketeering (RICO) claim was dismissed for lack of standing with leave to amend.",
    outcome: "Dismissed with leave to amend, except the California Consumer Legal Remedies Act claim (dismissed without leave because that law does not cover intangible goods like crypto).",
    sources: [S.courtDec2022],
  },
  {
    id: "class-action-proceeds-2023",
    kind: "class-action",
    title: "In re EthereumMax Investor Litigation — amended complaint partly survives",
    date: "2023-06-06",
    summary:
      "On the amended complaint the court denied the motions to dismiss in part, so some state consumer-protection claims against Kardashian, Mayweather and Pierce went forward to discovery. Press coverage reports the judge found some of Kardashian's statements could be \"literally false\", and treated some of Mayweather's statements as non-actionable puffery.",
    outcome: "Partly allowed to proceed (exact surviving claims taken from secondary reports, not read from the order itself).",
    sources: [S.scottJun2023, S.coinspeakerJun2023],
  },
  {
    id: "class-action-certified-2025",
    kind: "class-action",
    title: "In re EthereumMax Investor Litigation — state classes certified, nationwide class denied",
    date: "2025-08",
    summary:
      "The court certified classes of investors who bought EMAX between May and June 2021 in California, Florida, New York and New Jersey, against defendants including Kardashian, Mayweather, Pierce, EthereumMax Holdings and co-founder Giovanni Perone, but refused a nationwide class.",
    outcome: "Pending as of the latest report found (August 2025).",
    sources: [S.ctAug2025],
  },
  {
    id: "sec-mayweather-2018",
    kind: "sec",
    title: "Background: SEC v. Mayweather (2018, other tokens — not EMAX)",
    date: "2018-11-29",
    summary:
      "Three years before EMAX, the SEC had already charged Floyd Mayweather Jr. for promoting three coin offerings (including Centra Tech, which paid him $100,000) without disclosing he was paid.",
    outcome: "Settled without admitting or denying: $300,000 disgorgement, $300,000 penalty and $14,775 interest.",
    statute: "Securities Act of 1933, Section 17(b) (anti-touting)",
    sources: [S.secMayweather2018],
  },
];

// ---------------------------------------------------------------------------------------------
// Window rules (explained in dataNotes)
const PUMP_START = "2021-05-26"; // Pierce's first SEC-documented paid tweet (and Mayweather's ticket promotion, per the complaint)
const KARDASHIAN_DAY = "2021-06-13"; // date of the post per the SEC order
const PUMP_BUYERS_EXTRA_DAYS = 3; // pump-phase buyers: pump start through peak + 3 days
const COLLAPSE_FRACTION = 0.1; // collapse = first daily close at or below 10% of the peak close (a 90% fall)

const sig = (x: number, n = 4) => Number(x.toPrecision(n));
const pct = (x: number) => Math.round(x * 10) / 10;
const usd = (x: number) => "$" + Math.round(x).toLocaleString("en-US");
const dayStartTs = (d: string) => Date.parse(d + "T00:00:00Z") / 1000;
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

function evenlySpaced<T>(xs: T[], n: number): T[] {
  if (xs.length <= n) return xs;
  return Array.from({ length: n }, (_, i) => xs[Math.round((i * (xs.length - 1)) / (n - 1))]);
}

async function main() {
  console.log(`rpc ${RPC}\ncache ${CACHE_DIR}${FRESH ? " (fresh)" : ""}`);
  await checkPair(PAIR, EMAX, WETH);
  await checkPair(USDC_WETH, USDC, WETH);
  const { days, endBlock, totalSwaps, syncs } = await buildSeries();

  // ---- price series (rounded once; peak/collapse are read from the rounded series so they match it exactly)
  const prices: PricePoint[] = days.map((d) => ({ t: d.date, priceUsd: sig(d.priceUsd), liquidityUsd: Math.round(d.liquidityUsd), volumeUsd: Math.round(d.volumeUsd) }));
  const pk = prices.reduce((a, b) => ((b.priceUsd ?? 0) > (a.priceUsd ?? 0) ? b : a));
  const peak = { t: pk.t, priceUsd: pk.priceUsd! };
  const col = prices.find((p) => p.t > peak.t && p.priceUsd !== null && p.priceUsd <= peak.priceUsd * COLLAPSE_FRACTION);
  if (!col) throw new Error("no collapse point found");
  const collapse = { t: col.t, priceUsd: col.priceUsd!, dropPct: pct((1 - col.priceUsd! / peak.priceUsd) * 100) };
  const get = (t: string) => {
    const p = prices.find((x) => x.t === t);
    if (!p?.priceUsd) throw new Error(`no price for ${t}`);
    return p;
  };
  const min = prices.reduce((a, b) => ((b.priceUsd ?? Infinity) < (a.priceUsd ?? Infinity) ? b : a));
  const last = prices[prices.length - 1];
  const start = get(SERIES_FROM);
  const pumpDayBefore = get(addDays(PUMP_START, -1));
  const kBefore = get(addDays(KARDASHIAN_DAY, -1));
  const kDay = get(KARDASHIAN_DAY);
  const k14 = get(addDays(KARDASHIAN_DAY, 14));
  const pumpVolume = prices.filter((p) => p.t >= PUMP_START && p.t <= peak.t).reduce((s, p) => s + (p.volumeUsd ?? 0), 0);
  const pumpSwaps = days.filter((d) => d.date >= PUMP_START && d.date <= peak.t).reduce((s, d) => s + d.swaps, 0);

  // ---- the "burned 400 trillion tokens" claim in the Kardashian post, and the post's likely time
  const burns = await burnsBetween(dayStartTs(addDays(KARDASHIAN_DAY, -1)), dayStartTs(addDays(KARDASHIAN_DAY, 2)) - 1);
  const bigBurns = burns.filter((b) => b.amount >= 1e14).sort((a, b) => b.amount - a.amount);
  console.log("burns >= 100T EMAX:", bigBurns);
  const burn = bigBurns[0];
  let burnNote: string;
  let anchorNote = "";
  if (burn) {
    const before = await balanceAt(EMAX, burn.from, burn.block - 1);
    const pctOfWallet = pct((burn.amount / toFloat(before)) * 100);
    const pacific = new Date((burn.ts - 7 * 3600) * 1000).toISOString().slice(0, 16).replace("T", " ");
    burnNote = `The Kardashian post says that "a few minutes ago" EthereumMax "burned 400 trillion tokens- literally 50% of their admin wallet". On-chain, the largest EMAX transfer to the burn address 0x…dEaD around that date is ${(burn.amount / 1e12).toFixed(2)} trillion EMAX at ${burn.at} (${pacific} Pacific, i.e. the evening of June 13 in California) from ${burn.from} (tx ${burn.tx}). That wallet held ${(toFloat(before) / 1e12).toFixed(1)} trillion just before, so the burn was ${pctOfWallet}% of it, not 50%; whether it was the project's "admin wallet" is not established by any source used here.${bigBurns.length > 1 ? ` Other burns of 100 trillion or more in the same window: ${bigBurns.slice(1).map((b) => `${(b.amount / 1e12).toFixed(1)}T at ${b.at}`).join(", ")}.` : ""}`;

    // price around the burn (pool price in ETH, so ETH's own moves don't blur it)
    const pre = syncs.filter((s) => s.block < burn.block).at(-1)!;
    const dayHigh = syncs.filter((s) => s.ts >= dayStartTs(KARDASHIAN_DAY) && s.block < burn.block).reduce((a, b) => (b.priceEth > a.priceEth ? b : a));
    const next24 = syncs.filter((s) => s.ts > burn.ts && s.ts <= burn.ts + 86_400);
    const low24 = next24.reduce((a, b) => (b.priceEth < a.priceEth ? b : a));
    const at24 = next24.at(-1)!;
    anchorNote = `Assuming the post went up a few minutes after that burn, as it says (an inference — no source gives the post's time), it was published around ${burn.at.slice(11, 16)} UTC on June 14 (evening of June 13 in California), which fits both the SEC's June 13 date and the complaint's June 14. Pool prices around it: the June 13 (UTC) high came at ${iso(dayHigh.ts)}, before the post, at ${pct((dayHigh.priceEth / pre.priceEth - 1) * 100)}% above the price just before the burn; in the 24 hours after the burn the price fell as much as ${pct((1 - low24.priceEth / pre.priceEth) * 100)}% (low at ${iso(low24.ts)}) and ended the 24 hours ${pct((1 - at24.priceEth / pre.priceEth) * 100)}% lower (prices in ETH, read from every Sync event of the pool). In this pool, the post was not followed by a new rally: the price fell in the hours after it.`;
  } else {
    burnNote = `The Kardashian post says EthereumMax "burned 400 trillion tokens" minutes earlier. No single transfer of 100 trillion EMAX or more to the burn address 0x…dEaD was found between ${addDays(KARDASHIAN_DAY, -1)} and ${addDays(KARDASHIAN_DAY, 1)} (UTC), so the claim is not confirmed on-chain by this check.`;
  }

  // ---- buyers: from the burn (the post's earliest possible time) for 72 hours
  const kFrom = burn ? burn.ts : dayStartTs(KARDASHIAN_DAY);
  const kTo = kFrom + 72 * 3600 - 1;
  const kb = await buyersBetween(kFrom, kTo);
  const pumpTo = addDays(peak.t, PUMP_BUYERS_EXTRA_DAYS);
  const pb = await buyersBetween(dayStartTs(PUMP_START), dayStartTs(addDays(pumpTo, 1)) - 1);
  const sample = evenlySpaced([...kb.first.entries()], 12).map(([address, v]) => ({ address, firstBuy: v.firstBuy, txHash: v.txHash }));
  console.log(`buyers ${iso(kFrom)}+72h: ${kb.first.size} (from ${kb.transfers} transfers); pump ${PUMP_START}..${pumpTo}: ${pb.first.size}`);

  // ---- holders (current snapshot)
  let holdersOut: CaseFile["holders"];
  let holderNote = "";
  try {
    const h = await holders();
    const asOf = new Date().toISOString().slice(0, 10);
    const T = (x: bigint) => (toFloat(x) / 1e12).toFixed(1) + " trillion";
    if (h.listedSum > h.total || h.pct > 100) {
      holderNote = `Holder concentration is left out: on ${asOf} the EMAX contract reports a total supply of ${T(h.total)}, but the three largest balances alone add up to more (${h.top3.map((x) => `${x.addr}${x.name ? ` (${x.name})` : ""}: ${T(x.value)}`).join("; ")}), so "share of supply" is not meaningful for this token.${burn ? ` (On-chain, totalSupply() read at block ${burn.block}, June 14, 2021, was ${T(BigInt(await rpc("eth_call", [{ to: EMAX, data: "0x18160ddd" }, "0x" + burn.block.toString(16)])))}.)` : ""} Blockscout lists ${h.holdersCount.toLocaleString("en-US")} holder addresses.`;
    } else {
      holdersOut = { top10Pct: h.pct, asOf, method: `Blockscout /api/v2/tokens/${EMAX}/holders, read ${asOf}: share of total supply held by the 10 largest addresses, excluding the 0x…dEaD burn address from both. Today's snapshot, not June 2021.` };
    }
    console.log(holderNote || `top10 ${h.pct}%`);
  } catch (e: any) {
    holderNote = "Holder concentration was not available at build time (Blockscout API unreachable or rate-limited).";
    console.warn(`holders skipped: ${e?.message}`);
  }

  const caseFile: CaseFile = {
    slug: "emax",
    token: { name: "EthereumMax", symbol: "EMAX", chain: "ethereum", address: "0x15874d65e649880c2614e7a480cb7c9A55787FF6", decimals: 18, pair: "0xb6CA52c7916ad7960C12Dc489FD93E5Af7cA257f", pairDex: "Uniswap V2 (EMAX/WETH)" },
    oneLiner: `In May and June 2021, celebrities including Kim Kardashian and retired basketball star Paul Pierce were paid to tell millions of followers about a new digital coin called EthereumMax, without properly saying they were paid or how much. People rushed to buy: the price rose about ${Math.round(peak.priceUsd / pumpDayBefore.priceUsd!)}-fold in five days, then fell ${Math.round(collapse.dropPct)}% within a month, leaving later buyers with heavy losses. The SEC later made Kardashian pay $1.26 million and Pierce about $1.4 million, and an investor class action against them was still going in 2025.`,
    window: { pumpStart: PUMP_START, peak: peak.t, collapse: collapse.t },
    posts: POSTS,
    prices,
    peak,
    collapse,
    buyersInWindow: {
      count: kb.first.size,
      method: `Distinct addresses that received EMAX directly from the Uniswap V2 EMAX/WETH pair (ERC-20 Transfer events on the EMAX contract with from = pair, i.e. buys from the pool) in the 72 hours after the Kardashian post: ${iso(kFrom)} to ${iso(kTo)} (blocks ${kb.fromBlock}–${kb.toBlock}; ${kb.transfers.toLocaleString("en-US")} buy transfers). ${burn ? `The window starts at the token burn the post refers to ("a few minutes ago … burned 400 trillion tokens"), the earliest time the post could have gone up; the post's exact time is not documented.` : `The post's exact time is not documented, so the window starts at 00:00 UTC on the SEC's post date.`} The Uniswap V2 router, the pair, the zero and burn addresses are excluded; everything else is counted, including bots and aggregator contracts, and buys through other pools or centralized exchanges are not seen. Sample: 12 buyers evenly spaced through the window in order of first purchase. This window comes after the price peak (${peak.t}, two weeks earlier); during the main pump (${PUMP_START} to ${pumpTo}, peak + ${PUMP_BUYERS_EXTRA_DAYS} days) ${pb.first.size.toLocaleString("en-US")} distinct addresses bought from the pool by the same method.`,
      sample,
    },
    ...(holdersOut ? { holders: holdersOut } : {}),
    legal: LEGAL,
    dataNotes: [
      `Contract: EMAX was launched on 2021-05-12 as ${EMAX_V1} (Blockscout now labels it "EthereumMax (Deprecated)"); the SEC orders say public trading began about 2021-05-14. The project redeployed the token as ${EMAX} (an upgradeable proxy) on 2021-05-25 01:31 UTC and the Uniswap V2 EMAX/WETH pair ${PAIR} was created at 10:39 UTC that day (block ${PAIR_CREATED_BLOCK}). All the promoter posts above (from 2021-05-26 on) and the whole series are on the new contract. Blockscout shows the new contract's own address holding about 26 trillion of the old tokens (consistent with a token swap), but the mechanics of the migration were not verified, so the series starts on 2021-05-25 and May 14–24 trading on the old contract is not included.`,
      `Prices: for each UTC day, the EMAX/WETH pair's reserves after its last Sync event that day (end-of-day pool state); price in ETH = WETH reserve / EMAX reserve (both 18 decimals). ETH/USD is the same end-of-day reading of the Uniswap V2 USDC/WETH pair ${USDC_WETH}, so every dollar figure is derived from Ethereum itself with no outside price feed. USDC is treated as $1.`,
      `Liquidity = 2 x the pool's WETH reserve x ETH/USD (the two sides of a Uniswap V2 pool are equal in value). Volume = the WETH side of every Swap event in the UTC day x that day's closing ETH/USD. Only this pool is counted; trading on other pools or exchanges is not. ${totalSwaps.toLocaleString("en-US")} swaps were processed from ${SERIES_FROM} to ${SERIES_TO} (blocks ${PAIR_CREATED_BLOCK}–${endBlock}).`,
      `Daily closes, not intraday highs: the class-action complaint cites an all-time high of $0.000000863 on 2021-05-29 (CoinMarketCap-style intraday data, per the Dec. 6, 2022 court order). This file uses end-of-day pool prices, so its highest point ($${peak.priceUsd} at the close of ${peak.t}) is lower than that intraday figure. The token's price is a tiny fraction of a cent because over 900 trillion tokens exist; what matters is the relative change.`,
      `Window: pumpStart = ${PUMP_START}, the first paid promotion documented by the SEC (Pierce's first EMAX tweet; the complaint also dates Mayweather's ticket promotion to on or around that day). From the ${addDays(PUMP_START, -1)} close ($${pumpDayBefore.priceUsd}) to the peak close on ${peak.t} ($${peak.priceUsd}) the price rose ${Math.round((peak.priceUsd / pumpDayBefore.priceUsd! - 1) * 100)}%; ${pumpSwaps.toLocaleString("en-US")} swaps and about ${usd(pumpVolume)} of volume went through this pool from ${PUMP_START} to ${peak.t}. The pair opened at $${start.priceUsd} on ${SERIES_FROM}.`,
      `Collapse: the first daily close at or below 10% of the peak close (a fall of 90% or more) — ${collapse.t}, $${collapse.priceUsd}, ${collapse.dropPct}% below the peak. This rule was chosen because it is mechanical and reproducible; it also happens to coincide with the end of the class period (purchases from May 14 to June 27, 2021) in the class-action complaint. Lowest close in the series: $${min.priceUsd} on ${min.t} (${pct((1 - min.priceUsd! / peak.priceUsd) * 100)}% below peak); last point: $${last.priceUsd} on ${last.t}.`,
      `Kardashian post, daily view: the UTC daily close rose from $${kBefore.priceUsd} on ${kBefore.t} to $${kDay.priceUsd} on ${kDay.t} (+${Math.round((kDay.priceUsd! / kBefore.priceUsd! - 1) * 100)}%, ${usd(kDay.volumeUsd ?? 0)} of volume) — a run-up that, on the timing below, came before the post itself (the SEC says the post came with an introductory video announcing a "big announcement"; when that video went up is not documented). Two weeks after ${kDay.t}, on ${k14.t}, the close was $${k14.priceUsd}, ${pct((1 - k14.priceUsd! / kDay.priceUsd!) * 100)}% lower.`,
      burnNote,
      ...(anchorNote ? [anchorNote] : []),
      `Dates differ by a day between sources for some posts (SEC: Kardashian June 13, Pierce June 5; class-action complaint as summarized by the court: June 14 and June 6), probably time-zone or reading differences; this file uses the SEC dates. The court order also misprints 2022 for 2021 in places.`,
      `Pierce's May 28, 2021 tweet is emoji-only (a row of 😳 and a 😘) with a screenshot of an EMAX wallet worth "$2,520,087.34" — the SEC found it was someone else's holdings, provided to him for promotion; no text is quoted because the emoji count cannot be read reliably from the order's image. Pierce's follower count is the SEC's "in excess of approximately 4 million"; Kardashian's is the SEC's "approximately 225 million".`,
      `disclosedPayment: Kardashian's June 13 post ended with "#AD", but the SEC found she did not disclose that EthereumMax paid her or the amount, which Section 17(b) requires — so it is recorded as false. Her May 30, 2021 story (a "Groot Hospitality / LIV / STORY" graphic saying "now accepting cryptocurrency … exclusively accepting EthereumMax.org") is an allegation in the class-action complaint, reproduced as an image in the court's Dec. 6, 2022 order; the text field transcribes that image, with " · " marking line breaks between logos and lines. The SEC order does not mention this post, and no payment for it is documented.`,
      `Mayweather: no Mayweather post text is quoted by a regulator or court. The court's summary of the complaint says that on or around May 26, 2021 he encouraged people to buy pay-per-view tickets for his June 6, 2021 exhibition with Logan Paul using EMAX, and that at a Bitcoin conference in Miami he wore an EthereumMax T-shirt and said the quoted line on a panel (the conference date is not given in the source; the Financial Times chart reproduced in the order places it in early June 2021). The complaint alleges he was paid in ETH (amount unknown) and NBC reports the complaint says he did not appear to disclose payment; these remain allegations, so disclosedPayment is null.`,
      `Pierce's payment ($244,116 in EMAX) is the SEC's total for all his promotional tweets from May 24 to June 18, 2021, recorded on his first tweet only so it is not double-counted. The SEC press release gives his penalty as $1,115,000; the order says $1,150,000, and the order's figures are the ones that add up to the release's $1.409 million total.`,
      ...(holderNote ? [holderNote] : []),
      `Rebuild: npx tsx scripts/build-emax.mts (add --fresh to bypass the local cache; set RPC_URL to use another archive node that returns blockTimestamp on logs).`,
    ],
    sources: [
      S.secKardashianRelease,
      S.secKardashianOrder,
      S.secPierceRelease,
      S.secPierceOrder,
      S.secMayweather2018,
      S.courtDec2022,
      S.docket,
      S.fortuneFiling,
      S.nbcFiling,
      S.scottJun2023,
      S.coinspeakerJun2023,
      S.ctAug2025,
      S.wikiFight,
      S.bsToken,
      S.bsTokenV1,
      S.bsPair,
      S.bsUsdcPair,
      S.rpc,
      S.script,
    ],
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(caseFile, null, 2) + "\n");
  console.log(`wrote ${OUT}: peak ${peak.t} $${peak.priceUsd}, collapse ${collapse.t} $${collapse.priceUsd} (-${collapse.dropPct}%), buyers ${kb.first.size}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
