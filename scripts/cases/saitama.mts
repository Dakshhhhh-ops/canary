/**
 * Saitama Inu (SAITAMA, 2021): the second real case. Built by `npx tsx scripts/build-case.mts saitama`.
 *
 * Why this case: unlike EMAX (celebrities paid to post, Securities Act §17(b) anti-touting), here the
 * promoters were the project's own officers. The SEC alleges they staged buying to "create an illusion of
 * massive buys", hired "market makers" to wash trade, hyped a launch they knew was not ready, and told the
 * public they were holding or buying while they sold: market manipulation and fraud (Exchange Act §§9(a)(2),
 * 10(b), Securities Act §17(a)). A parallel criminal case is pending in Boston.
 *
 * Text facts are typed in from the SEC complaint (D. Mass. No. 1:24-cv-12586, filed Oct. 9, 2024) and the
 * other documents cited next to each one. Posts are quoted exactly as the complaint quotes them, including
 * its [brackets], [sic] and ellipses; emoji are transcribed from the complaint's images. Nothing is generated:
 * if a source did not state something, the field is left out. Every on-chain number is computed below.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CaseFile, LegalAction, PricePoint, PromoterPost, Source } from "../../src/lib/types";
import { detectCollapse } from "../../src/lib/engine/collapse";
import { addDays, dayStartTs, evenlySpaced, iso, pct, sig, usd, type makeChain, type PoolConfig } from "../lib/pool-series.mts";

export const SAITAMA = "0x8b3192f5eebd8579568a2ed41e6feb402f93f73f"; // "Saitama Inu" (SAITAMA), 9 decimals, read on-chain
export const PAIR = "0x9cbfb60a09a9a33a10312da0f39977cbdb7fde23"; // Uniswap V2 SAITAMA/WETH (token0 = SAITAMA, token1 = WETH)
export const PAIR_CREATED_BLOCK = 12535727; // PairCreated on the Uniswap V2 factory, 2021-05-30 12:24:31 UTC, tx 0x8dbee7da…bfcf1
const SUSHI_PAIR = "0xf4bfe9b4ef01f27920e490cea87fe2642a8da18d"; // SushiSwap SAITAMA/WETH (exists; not counted)
const USDC_WETH = "0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc";
const UNIV2_FACTORY = "0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f";

const SERIES_FROM = "2021-05-30"; // the day the pair was created
const SERIES_TO = "2022-05-31"; // end of the SEC's sales table period ("From June 2021 through the end of May 2022"); v2 token came mid-2022

export const config = ({ fresh }: { fresh: boolean }) => ({
  rpc: process.env.RPC_URL ?? "https://mainnet.gateway.tenderly.co",
  cacheDir: join(tmpdir(), "canary-case-saitama"),
  fresh,
  token: SAITAMA,
  tokenDecimals: 9,
  pair: PAIR,
  pairCreatedBlock: PAIR_CREATED_BLOCK,
  factory: UNIV2_FACTORY,
  router: "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
  quote: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  quoteDecimals: 18,
  usdPool: { pair: USDC_WETH, stable: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", stableDecimals: 6, factory: UNIV2_FACTORY },
  searchLo: PAIR_CREATED_BLOCK - 200_000,
  searchHi: 15_200_000,
  logChunk: 8_000,
  seriesFrom: SERIES_FROM,
  seriesTo: SERIES_TO,
});

// ---------------------------------------------------------------------------------------------
// Sources (each read for this file; see data/cases/saitama.sources.md for what each one supports)
// ---------------------------------------------------------------------------------------------
const S = {
  complaint: { label: "SEC complaint, SEC v. Armand, Hernandez, Kohli and Tran, No. 1:24-cv-12586 (D. Mass., filed Oct. 9, 2024)", url: "https://www.sec.gov/files/litigation/complaints/2024/comp-pr2024-166-saitama.pdf" },
  release: { label: "SEC press release 2024-166 (Oct. 9, 2024): SEC Charges Three So-Called Market Makers and Nine Individuals in Crackdown on Manipulation of Crypto Assets", url: "https://www.sec.gov/newsroom/press-releases/2024-166" },
  litRelease: { label: "SEC Litigation Release No. 26155 (Oct. 15, 2024): SEC v. Armand et al., No. 1:24-cv-12586-AK", url: "https://www.sec.gov/enforcement-litigation/litigation-releases/lr-26155" },
  pham: { label: "SEC complaint, SEC v. Vy Pham (D. Mass., filed Oct. 9, 2024)", url: "https://www.sec.gov/files/litigation/complaints/2024/comp-pr2024-166-pham.pdf" },
  fortune: { label: "Fortune (Oct. 9, 2024): FBI and DOJ charge crypto market makers and Saitama executives (\"Operation Token Mirrors\")", url: "https://fortune.com/crypto/2024/10/09/fbi-doj-crypto-market-manipulation-fraud-charges" },
  cryptobriefing: { label: "Crypto Briefing (Aug. 26, 2026): Crypto executive loses bid to block extradition to US on fraud charges", url: "https://cryptobriefing.com/crypto-ceo-extradition-uk-us-fraud/" },
  bsToken: { label: "Blockscout: Saitama Inu (SAITAMA) token contract", url: "https://eth.blockscout.com/token/0x8B3192f5eEBD8579568A2Ed41E6FEB402f93f73F" },
  bsPair: { label: "Blockscout: Uniswap V2 SAITAMA/WETH pair", url: "https://eth.blockscout.com/address/0x9cbfb60a09A9a33a10312dA0f39977CbDb7fdE23" },
  bsUsdcPair: { label: "Blockscout: Uniswap V2 USDC/WETH pair (ETH/USD reference)", url: "https://eth.blockscout.com/address/0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc" },
  rpc: { label: "Ethereum mainnet event logs via Tenderly public RPC gateway (eth_getLogs)", url: "https://mainnet.gateway.tenderly.co" },
  script: { label: "Build script that recomputes every on-chain number in this file", url: "scripts/build-case.mts" },
} satisfies Record<string, Source>;

// The SEC complaint says the four defendants were Saitama LLC's officers and "collectively controlled the
// official Saitama social media accounts" (¶¶13–16, 49), so they are one team, not independent voices.
const TEAM = "part of Saitama's leadership team, per the SEC complaint";
const P = (promoter: string, x: Omit<PromoterPost, "promoter" | "affiliation" | "disclosedPayment" | "sources"> & { sources?: Source[] }): PromoterPost => ({
  promoter,
  ...x,
  disclosedPayment: null,
  affiliation: TEAM,
  sources: x.sources ?? [S.complaint],
});

const POSTS: PromoterPost[] = [
  P("Russell Armand", { id: "armand-2021-07-16", platform: "x", postedAt: "2021-07-16", datePrecision: "day", text: "RT @InuSaitama: Looks [sic] at this chart! We will have new [all time] high price soon!! 💥🔥🚀💵 and we are Top Trending Dextools 5 days in the roll now ❤️ #SaitamaIn…[sic]" }),
  P("Manpreet Singh Kohli", { id: "kohli-2021-07-25", platform: "x", postedAt: "2021-07-25", datePrecision: "day", text: "RT @InuSaitama: 🐺Update on 07/25 🎉New ATH 1260! ... 💸Top 7 Dextools … 🟦105.2% 24h; 🟦1446.72 % WoW💰8286+ Holders" }),
  P("Saitama (official X account)", { id: "wearesaitama-2021-08-01", handle: "@WeAreSaitama", platform: "x", postedAt: "2021-08-01", datePrecision: "day", text: "💸Top 3 Dextools." }),
  P("Nam Tran", { id: "tran-2021-09-13", handle: "@Ntran1234", platform: "x", postedAt: "2021-09-13", datePrecision: "day", text: "We are #1 Dextools Trending 6 days straight and the 4 hour chart is so Bullish 🔥🚀." }),
  P("Nam Tran", { id: "tran-2021-09-15-buying", handle: "@Ntran1234", platform: "x", postedAt: "2021-09-15", datePrecision: "day", text: "I am buying more" }),
  P("Nam Tran", { id: "tran-2021-09-15-trending", handle: "@Ntran1234", platform: "x", postedAt: "2021-09-15", datePrecision: "day", text: "🔥Top 6 Trending Dextools." }),
  P("Maxwell Hernandez", { id: "hernandez-2021-09-15", platform: "youtube", postedAt: "2021-09-15", datePrecision: "day", text: "I myself haven't really sold anything since the beginning . . . and if I have taken anything out of my wallet it's been, you know, to donate for like you know giveaways and other stuff like that." }),
  P("Russell Armand", { id: "armand-2021-09-16", platform: "x", postedAt: "2021-09-16", datePrecision: "day", text: "November 13th will go down in history" }),
  P("Nam Tran", { id: "tran-2021-10-23", handle: "@Ntran1234", platform: "x", postedAt: "2021-10-23", datePrecision: "day", text: "I said HOLD! #SaitamaWolfPack #SaitamaInu #SaitamaToken #Saitama100k #SaitaMask" }),
  P("Russell Armand", { id: "armand-2021-10-31", platform: "x", postedAt: "2021-10-31", datePrecision: "day", text: "zero 👌 saitama sold just to be clear lol." }),
  P("Russell Armand", { id: "armand-2021-11-02", platform: "youtube", postedAt: "2021-11-02", datePrecision: "day" }),
  P("Manpreet Singh Kohli", { id: "kohli-2021-11-08", platform: "x", postedAt: "2021-11-08", datePrecision: "day", text: "6 more days to go for SaitaMask Launch 🚀🚀🚀🚀🚀. Lot more coming this week and weekend," }),
  P("Russell Armand", { id: "armand-2021-11-09", platform: "youtube", postedAt: "2021-11-09", datePrecision: "day", text: "We've already put all the preliminary measures in place and the wallet itself is done like the swap function's done. Everything is done." }),
  P("Manpreet Singh Kohli", { id: "kohli-2021-11-12", platform: "x", postedAt: "2021-11-12", datePrecision: "day", text: "[One] Day left for our Launch and few great announcements" }),
  P("Russell Armand", { id: "armand-2021-11-13", platform: "x", postedAt: "2021-11-13", datePrecision: "day" }),
  P("Russell Armand", { id: "armand-2022-01-ama", platform: "youtube", postedAt: "2022-01-01", datePrecision: "month", text: "[A]ll the different things that we're doing, it's all geared with the same premise--and that's to make the token more valuable--to make Saitama more valuable, to make the price increase, to burn more of the circulating supply, to give it more of a use case." }),
];

const LEGAL: LegalAction[] = [
  {
    id: "sec-saitama-2024",
    kind: "sec",
    title: "SEC v. Armand, Hernandez, Kohli and Tran (civil fraud and market-manipulation complaint), D. Mass. No. 1:24-cv-12586",
    date: "2024-10-09",
    summary:
      "The SEC sued Saitama's chief executive Russell Armand, technology chief Maxwell Hernandez, finance chief Manpreet Singh Kohli and business chief Nam Tran. It alleges they staged coordinated small buys on July 3–4, 2021 to \"create an illusion of massive buys and new holders\", paid so-called market makers (ZM Quant, at least $27,000; Gotbit) to wash trade, gamed the DEXTools trending list and then advertised the rankings, falsely claimed an \"anti-whale\" feature and regulator review, promoted a SaitaMask launch they knew was not ready, and told the public they were holding or buying while they sold. Per the complaint, from June 2021 through May 2022 they sold about $2.13 million (Armand), $10.97 million (Hernandez), $22.09 million (Kohli) and $14.56 million (Tran) of Saitama.",
    outcome:
      "Allegations, not findings. Armand and Hernandez consented to bifurcated settlements (injunctions and officer-and-director bars, with money to be decided by the court later), subject to court approval; Kohli and Tran did not settle at filing. Later docket events were not verified for this file.",
    statute: "Securities Act of 1933, Sections 5(a), 5(c) and 17(a); Securities Exchange Act of 1934, Sections 9(a)(2) (market manipulation) and 10(b), and Rule 10b-5",
    sources: [S.complaint, S.release, S.litRelease],
  },
  {
    id: "sec-pham-2024",
    kind: "sec",
    title: "SEC v. Vy Pham (civil complaint), D. Mass.",
    date: "2024-10-09",
    summary:
      "A separate SEC complaint against Vy Pham, who the SEC says took part in Saitama's launch in spring 2021 and in the July 2021 coordinated buying (\"How much are we gonna pump now?\"), then sold and left the project that summer; it also covers another token, Robo Inu.",
    outcome: "Pham consented to a bifurcated settlement, subject to court approval (per the SEC press release).",
    sources: [S.pham, S.release],
  },
  {
    id: "doj-token-mirrors-2024",
    kind: "doj",
    title: "Parallel criminal case (\"Operation Token Mirrors\"), US Attorney for the District of Massachusetts",
    date: "2024-10-09",
    summary:
      "Unsealed the same day: criminal charges against 18 people and companies, including the market makers and Saitama executives, who prosecutors allege secretly sold their tokens for tens of millions of dollars while the token was manipulated to a market value of $7.5 billion. The FBI created its own token, NexFundAI, to catch market makers offering wash trading.",
    outcome: "Per the press report, five defendants had pleaded guilty or agreed to plead guilty when the case was announced (not specified which). Taken from a press report; the US Attorney's release itself could not be fetched for this file.",
    sources: [S.fortune],
  },
  {
    id: "kohli-extradition-2026",
    kind: "doj",
    title: "US v. Kohli: motion to dismiss denied in Boston; UK extradition challenge rejected",
    date: "2026-08-19",
    summary:
      "Kohli, arrested in London in 2024, is charged in Boston with wire fraud and market manipulation; prosecutors say he personally made about $20 million. Earlier in August 2026 a federal judge in Boston refused to dismiss the indictment (Kohli had argued Saitama is not a security). On August 19, 2026 a UK judge rejected his challenge to extradition and sent the case to British ministers.",
    outcome: "Pending; Kohli has not been convicted and can still appeal (per the press report).",
    sources: [S.cryptobriefing],
  },
];

// ---------------------------------------------------------------------------------------------
const PUMP_START = "2021-07-03"; // the SEC's documented coordinated buying (complaint ¶¶71–89: July 3–4, 2021)
const SAITAMASK_FROM = "2021-11-08"; // Kohli: "6 more days to go for SaitaMask Launch"
const SAITAMASK_TO = "2021-11-13"; // launch-party day
const PUMP_BUYERS_EXTRA_DAYS = 3;
const COLLAPSE_FRACTION = 0.1; // collapse = first daily close at or below 10% of the peak close (a 90% fall)

export async function build(chain: ReturnType<typeof makeChain>, cfg: PoolConfig & { seriesFrom: string; seriesTo: string }): Promise<CaseFile> {
  const { days, endBlock, totalSwaps, syncs } = await chain.buildSeries(cfg.seriesFrom, cfg.seriesTo, true);
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
  const dayOfSeries = (t: string) => days.find((d) => d.date === t)!;
  // an earlier crash: the first 80% fall from the highest close so far, by the collapse watcher's own rule
  const watcher = detectCollapse(prices, 80);
  const early = watcher.detected && watcher.peak && watcher.collapse ? { high: watcher.peak, low: watcher.collapse } : null;
  const min = prices.filter((p) => p.t > peak.t).reduce((a, b) => ((b.priceUsd ?? Infinity) < (a.priceUsd ?? Infinity) ? b : a));
  const last = prices[prices.length - 1];
  const start = get(SERIES_FROM);
  const pumpDayBefore = get(addDays(PUMP_START, -1));
  const runUpPct = (peak.priceUsd / pumpDayBefore.priceUsd! - 1) * 100;
  const pumpVolume = prices.filter((p) => p.t >= PUMP_START && p.t <= peak.t).reduce((s, p) => s + (p.volumeUsd ?? 0), 0);
  const pumpSwaps = days.filter((d) => d.date >= PUMP_START && d.date <= peak.t).reduce((s, d) => s + d.swaps, 0);
  const peakLiq = prices.reduce((a, b) => ((b.liquidityUsd ?? 0) > (a.liquidityUsd ?? 0) ? b : a));

  // ---- check 1: the SEC's "approximately 60 percent" during the July 3–4 coordinated buying (pool price in ETH)
  const julFrom = dayStartTs(PUMP_START);
  const julTo = dayStartTs(addDays(PUMP_START, 2)) - 1;
  const preJul = syncs.filter((s) => s.ts < julFrom).at(-1)!;
  const inJul = syncs.filter((s) => s.ts >= julFrom && s.ts <= julTo);
  const julHigh = inJul.reduce((a, b) => (b.priceQuote > a.priceQuote ? b : a));
  const julEnd = inJul.at(-1)!;
  const julyNote = `July 3–4, 2021 (the SEC's coordinated-buying days): measured in ETH from every Sync of the pool, the price went from ${preJul.priceQuote.toExponential(3)} ETH just before 00:00 UTC July 3 to a high of ${julHigh.priceQuote.toExponential(3)} ETH at ${iso(julHigh.ts)} (+${pct((julHigh.priceQuote / preJul.priceQuote - 1) * 100)}%) and ended July 4 (UTC) at ${julEnd.priceQuote.toExponential(3)} ETH (${julEnd.priceQuote >= preJul.priceQuote ? "+" : ""}${pct((julEnd.priceQuote / preJul.priceQuote - 1) * 100)}%). The complaint says the price "increased by approximately 60 percent" during the "approximately two-day buying spree" (¶73); its exact start and end times are not given, so this is a check of order of magnitude, not of the exact figure. ${inJul.length.toLocaleString("en-US")} pool updates happened in those two days.`;

  // ---- check 2: the SEC's all-time high ($0.0000001394 on Nov 12, 2021) vs the pool
  const nov12 = dayOfSeries("2021-11-12");
  const n12From = dayStartTs("2021-11-12");
  const n12 = syncs.filter((s) => s.ts >= n12From && s.ts < n12From + 86_400);
  const n12High = n12.reduce((a, b) => (b.priceQuote > a.priceQuote ? b : a));
  const athNote = `All-time high: the complaint gives $0.0000001394 on November 12, 2021 (¶134; the data source for that figure is not stated, likely an intraday aggregator price). In this pool the highest November 12 (UTC) reading was ${n12High.priceQuote.toExponential(4)} ETH at ${iso(n12High.ts)}, about $${sig(n12High.priceQuote * nov12.quoteUsd, 4)} at that day's closing ETH price ($${Math.round(nov12.quoteUsd).toLocaleString("en-US")}); the November 12 close was $${get("2021-11-12").priceUsd}. The highest daily close in the series is $${peak.priceUsd} on ${peak.t}.`;

  // ---- check 3: the fall after the launch slipped ("27 percent over two days, and 72 percent over the following month")
  const p2 = get(addDays(peak.t, 2));
  const p30 = get(addDays(peak.t, 30));
  const fallNote = `After the peak: the complaint says that after the SaitaMask launch was delayed the price fell "27 percent over two days, and 72 percent over the course of the following month" (¶137, no dates given). In this pool's daily closes, two days after the peak close (${p2.t}) the price was ${pct((1 - p2.priceUsd! / peak.priceUsd) * 100)}% lower and thirty days after (${p30.t}) ${pct((1 - p30.priceUsd! / peak.priceUsd) * 100)}% lower.`;

  // ---- buyers: during the SaitaMask countdown (Kohli's "6 more days" post through launch day)
  const kFrom = dayStartTs(SAITAMASK_FROM);
  const kTo = dayStartTs(addDays(SAITAMASK_TO, 1)) - 1;
  const kb = await chain.buyersBetween(kFrom, kTo, [SUSHI_PAIR]);
  const jb = await chain.buyersBetween(julFrom, julTo, [SUSHI_PAIR]);
  const pumpTo = addDays(peak.t, PUMP_BUYERS_EXTRA_DAYS);
  const pb = await chain.buyersBetween(dayStartTs(PUMP_START), dayStartTs(addDays(pumpTo, 1)) - 1, [SUSHI_PAIR]);
  const sample = evenlySpaced([...kb.first.entries()], 12).map(([address, v]) => ({ address, firstBuy: v.firstBuy, txHash: v.txHash }));
  console.log(`buyers ${SAITAMASK_FROM}..${SAITAMASK_TO}: ${kb.first.size}; July 3–4: ${jb.first.size}; pump ${PUMP_START}..${pumpTo}: ${pb.first.size}`);
  const kStart = get(addDays(SAITAMASK_FROM, -1));
  const kEnd = get(SAITAMASK_TO);
  const kVolume = prices.filter((p) => p.t >= SAITAMASK_FROM && p.t <= SAITAMASK_TO).reduce((s, p) => s + (p.volumeUsd ?? 0), 0);

  const fold = Math.round(peak.priceUsd / pumpDayBefore.priceUsd!);
  return {
    slug: "saitama",
    token: { name: "Saitama Inu", symbol: "SAITAMA", chain: "ethereum", address: "0x8B3192f5eEBD8579568A2Ed41E6FEB402f93f73F", decimals: 9, pair: "0x9cbfb60a09A9a33a10312dA0f39977CbDb7fdE23", pairDex: "Uniswap V2 (SAITAMA/WETH)", pairCreatedBlock: PAIR_CREATED_BLOCK },
    oneLiner: `In 2021 the four people running a dog-themed coin called Saitama Inu hyped it on X, Telegram and YouTube. The SEC says they secretly staged buying to "create an illusion" of demand, paid traders to fake volume, and said they were holding or buying while they sold tens of millions of dollars' worth. In its main trading pool the price rose about ${fold.toLocaleString("en-US")}-fold from July to its November peak, then fell ${Math.round(collapse.dropPct)}% by ${new Date(collapse.t + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}. The SEC sued all four in 2024; criminal charges are pending in Boston.`,
    window: { pumpStart: PUMP_START, peak: peak.t, collapse: collapse.t },
    posts: POSTS,
    prices,
    peak,
    collapse,
    buyersInWindow: {
      count: kb.first.size,
      method: `Distinct addresses that received SAITAMA directly from the Uniswap V2 SAITAMA/WETH pair (ERC-20 Transfer events on the SAITAMA contract with from = pair, i.e. buys from the pool) during the SaitaMask launch countdown: from Kohli's "6 more days to go" post (${SAITAMASK_FROM}, counted from 00:00 UTC) to the end of launch day ${SAITAMASK_TO} (${iso(kFrom)} to ${iso(kTo)}; blocks ${kb.fromBlock}–${kb.toBlock}; ${kb.transfers.toLocaleString("en-US")} transfers out of the pair). The SEC says the four defendants sold large amounts in the weeks up to the launch, knowing the app was not ready (complaint ¶¶135–136). The router, the pair, the SushiSwap SAITAMA/WETH pair, the token contract itself, the zero and burn addresses are excluded; everything else is counted, including bots and aggregator contracts, and buys through other pools or the centralized exchanges Saitama later traded on are not seen. Sample: 12 buyers evenly spaced through the window in order of first purchase. Same method: ${jb.first.size.toLocaleString("en-US")} addresses bought from the pool during the July 3–4 coordinated buying (a count that may include the insiders' own wallets, which the SEC says they spread their buys across), and ${pb.first.size.toLocaleString("en-US")} from ${PUMP_START} to ${pumpTo} (peak + ${PUMP_BUYERS_EXTRA_DAYS} days).`,
      sample,
    },
    legal: LEGAL,
    dataNotes: [
      `Contract: Saitama Inu (SAITAMA) ${SAITAMA}, an ERC-20 token with 9 decimals and a total supply of 100 quadrillion (read on-chain; the complaint says "approximately 100 quadrillion"). The Uniswap V2 SAITAMA/WETH pair ${PAIR} was created at 2021-05-30 12:24:31 UTC (block ${PAIR_CREATED_BLOCK}; PairCreated event on the Uniswap V2 factory). The complaint says Saitama "initially traded on Uniswap, and later on numerous other platforms, including at various times Bybit, OKX, Gate, LBank, Bitmart, MEXC, and XT" (¶67); only this pool is measured here. In mid-2022 the project replaced the token with a "v2" contract (complaint, footnote 5), so the series stops at ${SERIES_TO}.`,
      `Prices: for each UTC day, the pair's reserves after its last Sync event that day; price in ETH = (WETH reserve / 10^18) / (SAITAMA reserve / 10^9). ETH/USD is the same end-of-day reading of the Uniswap V2 USDC/WETH pair ${USDC_WETH}; USDC is treated as $1. Liquidity = 2 x the pool's WETH reserve x ETH/USD. Volume = the WETH side of every Swap that day x that day's closing ETH/USD. ${totalSwaps.toLocaleString("en-US")} swaps were processed from ${SERIES_FROM} to ${SERIES_TO} (blocks ${PAIR_CREATED_BLOCK}–${endBlock}). The same code reproduces the published EMAX price series exactly (npx tsx scripts/build-case.mts emax --compare).`,
      `Window: pumpStart = ${PUMP_START}, the first day of the coordinated buying the SEC documents from the insiders' private Telegram chat (¶¶71–89). From the ${pumpDayBefore.t} close ($${pumpDayBefore.priceUsd}) to the peak close on ${peak.t} ($${peak.priceUsd}) the price rose ${Math.round(runUpPct).toLocaleString("en-US")}%; ${pumpSwaps.toLocaleString("en-US")} swaps and about ${usd(pumpVolume)} of volume went through this pool in that time. The complaint gives "an increase of over 477,000 percent from July 2021" to its all-time high (¶134). The pair opened at $${start.priceUsd} on ${SERIES_FROM}. Pool liquidity peaked at ${usd(peakLiq.liquidityUsd ?? 0)} on ${peakLiq.t}.`,
      julyNote,
      athNote,
      fallNote,
      `Collapse: the first daily close at or below 10% of the peak close (a fall of 90% or more), the same mechanical rule as the EMAX case: ${collapse.t}, $${collapse.priceUsd}, ${collapse.dropPct}% below the peak. Lowest close after the peak in the series: $${min.priceUsd} on ${min.t} (${pct((1 - min.priceUsd! / peak.priceUsd) * 100)}% below peak); last point: $${last.priceUsd} on ${last.t}.${early && early.low.t < peak.t ? ` There was also an earlier crash inside the run-up: the close fell from $${early.high.priceUsd} (${early.high.t}) to $${early.low.priceUsd} (${early.low.t}), ${early.low.dropPct}% down, before the climb to the November peak. Canary's collapse watcher looks for the first fall of 80% or more from the highest close so far, so it reports that earlier crash, not the fall after the peak.` : ""}`,
      `SaitaMask countdown, daily view: the close went from $${kStart.priceUsd} on ${kStart.t} to $${kEnd.priceUsd} on ${kEnd.t} (${kEnd.priceUsd! >= kStart.priceUsd! ? "+" : ""}${pct((kEnd.priceUsd! / kStart.priceUsd! - 1) * 100)}%), with about ${usd(kVolume)} of volume through this pool from ${SAITAMASK_FROM} to ${SAITAMASK_TO}. Over roughly the same weeks (October 1 – November 12, 2021) the complaint says Armand, Hernandez, Tran and Kohli sold Saitama for about $369,000, $6,593,000, $8,337,000 and $6,520,000 (¶136).`,
      `Quotes: every post text is exactly what the SEC complaint puts inside quotation marks, including its [brackets], [sic], ellipses and any punctuation inside the quotes; the complaint may quote only part of a post. Emoji were transcribed from the complaint's printed images. Tran's October 23, 2021 post is reproduced in the complaint as a screenshot (handle @Ntran1234, "1:26 AM · Oct 23, 2021", time zone not shown), so its text is complete; the @Ntran1234 handle is taken from that screenshot and applied to his other posts. No source gives follower counts.`,
      `Posts without a quote: on November 2, 2021 Armand said in a YouTube interview that he had not used Saitama as a "revenue stream" or for "personal gain" (the complaint quotes only those words; by then, it says, he had sold about 32 trillion Saitama for more than $1 million); on November 13, 2021, launch day, he tweeted that the platform was ready and "out of beta". The January 2022 quote is from an "ask me anything" YouTube interview the complaint dates only to the month; Hernandez, Kohli and three others were on it.`,
      `disclosedPayment is null ("unknown") for every post: these promoters were not paid by someone else to post, so §17(b)'s duty to disclose a promoter's payment is not the theory here. What the SEC says they hid was their own selling ("zero 👌 saitama sold" on the day Armand sold 490 billion; "I am buying more" on a day Tran sold nearly 1.2 trillion net). The payments the SEC documents went the other way: at least $27,000 from the defendants to ZM Quant for "creating artificial trading volume" (¶94).`,
      `affiliation: every post carries the same affiliation ("${TEAM}") because the SEC says the four were Saitama LLC's officers and collectively controlled the official accounts (¶¶13–16, 49). Canary's convergence agent therefore counts them as ONE voice, not four independent promoters.`,
      `Holder concentration is left out: the 2021 token was replaced by a v2 contract in 2022, so today's holder list of this contract says nothing about who held it in 2021.`,
      `Criminal case: the details come from press reports (Fortune, Oct. 9, 2024; Crypto Briefing, Aug. 26, 2026). The US Attorney's own release (justice.gov) returned a bot challenge to our read-only fetch and was not read. No court document from the criminal case was read.`,
      `Rebuild: npx tsx scripts/build-case.mts saitama (add --fresh to bypass the local cache; set RPC_URL to use another archive node that returns blockTimestamp on logs).`,
    ],
    sources: [S.complaint, S.release, S.litRelease, S.pham, S.fortune, S.cryptobriefing, S.bsToken, S.bsPair, S.bsUsdcPair, S.rpc, S.script],
  };
}
