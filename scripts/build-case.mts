/**
 * Builds data/cases/<slug>.json for a case whose token traded on a Uniswap-V2-style pool, from a per-case
 * module in scripts/cases/<slug>.mts (addresses, window, and the sourced facts typed in from the documents).
 *
 *   npx tsx scripts/build-case.mts saitama             (reuses the local cache of RPC answers if present)
 *   npx tsx scripts/build-case.mts saitama --fresh     (refetches everything)
 *   npx tsx scripts/build-case.mts saitama --series    (prints the daily series only, writes nothing)
 *   npx tsx scripts/build-case.mts emax --compare      (re-derives EMAX's price series with the generic
 *                                                      builder and checks it equals data/cases/emax.json)
 *
 * Set RPC_URL to use another archive node that returns blockTimestamp on logs.
 * The EMAX file itself is still built by scripts/build-emax.mts (unchanged), so it stays byte-identical.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CaseFile, PricePoint } from "../src/lib/types";
import { makeChain, sig, type PoolConfig } from "./lib/pool-series.mts";

export type CaseModule = {
  config: (opts: { fresh: boolean }) => PoolConfig & { seriesFrom: string; seriesTo: string };
  build?: (chain: ReturnType<typeof makeChain>, cfg: PoolConfig & { seriesFrom: string; seriesTo: string }) => Promise<CaseFile>;
};

const here = dirname(fileURLToPath(import.meta.url));
const slug = process.argv[2];
if (!slug || !/^[a-z0-9-]+$/.test(slug)) throw new Error("usage: npx tsx scripts/build-case.mts <slug> [--fresh|--series|--compare]");
const FRESH = process.argv.includes("--fresh");
const mod = (await import(`./cases/${slug}.mts`)) as CaseModule;
const cfg = mod.config({ fresh: FRESH });
const chain = makeChain(cfg);
console.log(`rpc ${cfg.rpc}\ncache ${cfg.cacheDir}${FRESH ? " (fresh)" : ""}`);
const info = await chain.verify();
console.log(`verified on-chain: ${info.name} (${info.symbol}), ${info.decimals} decimals; pair ${cfg.pair} and USD pool ${cfg.usdPool.pair} match their tokens and factories`);

const OUT = join(here, "..", "data", "cases", `${slug}.json`);

if (process.argv.includes("--compare")) {
  const { days } = await chain.buildSeries(cfg.seriesFrom, cfg.seriesTo, false);
  const mine: PricePoint[] = days.map((d) => ({ t: d.date, priceUsd: sig(d.priceUsd), liquidityUsd: Math.round(d.liquidityUsd), volumeUsd: Math.round(d.volumeUsd) }));
  const published = (JSON.parse(readFileSync(OUT, "utf8")) as CaseFile).prices;
  const same = JSON.stringify(mine) === JSON.stringify(published);
  console.log(same ? `OK: the generic builder reproduces all ${published.length} daily points of data/cases/${slug}.json exactly.` : `MISMATCH: generic ${mine.length} points vs published ${published.length}.`);
  if (!same) {
    const diff = mine.findIndex((p, i) => JSON.stringify(p) !== JSON.stringify(published[i]));
    console.log("first difference at", diff, mine[diff], published[diff]);
    process.exitCode = 1;
  }
} else if (process.argv.includes("--series") || !mod.build) {
  await chain.buildSeries(cfg.seriesFrom, cfg.seriesTo, true);
} else {
  const cf = await mod.build(chain, cfg);
  if (cf.slug !== slug) throw new Error(`module built slug ${cf.slug}, expected ${slug}`);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(cf, null, 2) + "\n");
  console.log(`wrote ${OUT}: peak ${cf.peak.t} $${cf.peak.priceUsd}, collapse ${cf.collapse.t} $${cf.collapse.priceUsd} (-${cf.collapse.dropPct}%), buyers ${cf.buyersInWindow?.count ?? "n/a"}`);
}
