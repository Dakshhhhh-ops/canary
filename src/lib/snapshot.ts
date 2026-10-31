import "server-only";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { keccak256, toBytes } from "viem";
import { CASES, loadCase } from "./cases";
import { runCase } from "./engine/pipeline";
import { stepClock } from "./engine/trail";
import { loadNotebook } from "./notebooks";
import { radarDir, RUN_FILE_RE } from "./radar/store";
import { buildWatchList, radarWatch, type WatchList } from "./watch";

/** What the Chainlink CRE workflow reads (see cre/README.md). Deterministic: every node must get identical JSON. */
export type Snapshot = {
  caseId: `0x${string}`;
  symbol: string;
  token: string;
  level: 0 | 1 | 2 | 3;
  promoters: number;
  trailHash: `0x${string}`;
  liquidityBeforeUsd: number;
  liquidityNowUsd: number;
  pair?: string;
};

export const caseIdOf = (slug: string) => keccak256(toBytes(`canary:${slug}`));

const cache = new Map<string, Promise<Snapshot | null>>();

export function snapshotFor(slug: string): Promise<Snapshot | null> {
  if (!cache.has(slug)) cache.set(slug, build(slug));
  return cache.get(slug)!;
}

async function build(slug: string): Promise<Snapshot | null> {
  const cf = await loadCase(slug);
  if (!cf) return null;
  // rules only + fixed clock => the same trail head on every call and every node
  const run = await runCase(cf, { llm: null, clock: stepClock("2026-10-30T00:00:00.000Z") });
  const v = run.debate.judge.verdict;
  const level: Snapshot["level"] = run.collapse?.detected ? 3 : v === "pump-and-dump" ? 2 : v === "suspicious" ? 1 : 0;
  // the on-chain record points at the FROZEN notebook (data/notebooks/<slug>.json) when there is one,
  // so code changes after recording never break the match
  const frozen = await loadNotebook(slug);
  const liq = cf.prices.map((p) => p.liquidityUsd).filter((x): x is number => x != null);
  return {
    caseId: caseIdOf(slug),
    symbol: cf.token.symbol,
    token: cf.token.address,
    level,
    promoters: new Set(cf.posts.map((p) => p.promoter)).size,
    trailHash: `0x${frozen?.headHash ?? run.headHash}`,
    liquidityBeforeUsd: Math.round(Math.max(...liq)),
    liquidityNowUsd: Math.round(liq[liq.length - 1] ?? 0),
    ...(cf.token.pair ? { pair: cf.token.pair } : {}),
  };
}

// ---------- the watch list (GET /api/watch/snapshot?list=1, read by canary-watch in list mode) ----------

let watchMemo: { key: string; list: Promise<WatchList> } | null = null;

/**
 * Every case file (CASES) plus the radar coins that qualify (see src/lib/watch.ts). Rebuilt only when the
 * set of saved radar runs changes, so all DON nodes fetching in the same minute get the same bytes.
 */
export async function watchList(): Promise<WatchList> {
  const names = (await readdir(path.join(radarDir(), "runs")).catch(() => [] as string[])).filter((n) => RUN_FILE_RE.test(n)).sort();
  const key = names.join("|");
  if (watchMemo && watchMemo.key === key) return watchMemo.list;
  const list = (async () => {
    const files = (await Promise.all(CASES.map(async (slug) => ({ slug, snap: await snapshotFor(slug) })))).filter((x) => x.snap);
    return buildWatchList(
      files.map(({ slug, snap }) => ({ ...snap!, source: "case" as const, slug })),
      await radarWatch(),
    );
  })();
  watchMemo = { key, list };
  list.catch(() => {
    if (watchMemo?.list === list) watchMemo = null; // don't keep a failure
  });
  return list;
}
