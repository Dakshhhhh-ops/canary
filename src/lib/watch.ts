// The watch list: every case the Chainlink CRE workflow canary-watch keeps an eye on.
//   GET /api/watch/snapshot?list=1  →  { format, cases: [snapshot, …], skipped: [{ symbol, reason }, …] }
// It holds the documented case files (EMAX) and every coin the live radar flagged, as long as
//   - the coin's LATEST saved, real radar run (data/radar/runs) verifies and its judge says level ≥ 1, and
//   - the coin has a known ERC-20 token and Uniswap V2 pool on Ethereum mainnet (RADAR_TOKENS below),
//     because the workflow checks the pool on-chain itself.
// Anything else is listed under `skipped` with the reason, never guessed.
//
// Every DON node must get byte-identical JSON, so nothing here reads a clock or a random number: the
// list depends only on the files on disk, in a fixed order (case files first, then radar coins A→Z).
// No "server-only" import, so tests can use it (like src/lib/radar/store.ts).
import { createHash, timingSafeEqual } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { keccak256, toBytes } from "viem";
import type { LiveRun } from "./engine/pipeline";
import { RUN_FORMAT, verifySavedRun } from "./radar/saved";
import { radarDir, readRun, reachedRyo, RUN_FILE_RE } from "./radar/store";
import type { Snapshot } from "./snapshot";
import type { Verdict } from "./types";

export const WATCH_FORMAT = "canary.watch.list/1";
/** Most cases in one list (the workflow refuses longer lists; see cre/canary-watch MAX_LIST). */
export const MAX_WATCHED = 25;
/** How many saved runs are read, newest first, to find each coin's latest verdict. */
const MAX_RUNS_READ = 40;

/**
 * Coins the radar may hand to Chainlink: their ERC-20 token and their Uniswap V2 pool against WETH on
 * Ethereum mainnet. Each pool was checked on 2026-10-30 (Ethereum mainnet, around block 26,302,107):
 * UniswapV2Factory(0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f).getPair(token, WETH) returned this pair,
 * the pair's token0()/token1() are exactly {token, WETH}, and the token's symbol() matches.
 * Coins that are not ERC-20s on Ethereum (BTC, SOL, XRP, WIF, …) can't be checked on-chain this way and
 * are skipped with that reason. Add a coin only after the same check; never add a guessed address.
 */
export const RADAR_TOKENS: Record<string, { token: `0x${string}`; pair: `0x${string}` }> = {
  FLOKI: { token: "0xcf0C122c6b73ff809C693DB761e7BaeBe62b6a2E", pair: "0xca7c2771D248dCBe09EABE0CE57A62e18dA178c0" },
  MOG: { token: "0xaaeE1A9723aaDB7afA2810263653A34bA2C21C7a", pair: "0xc2eaB7d33d3cB97692eCB231A5D0e4A649Cb539d" },
  PEPE: { token: "0x6982508145454Ce325dDbE47a25d4ec3d2311933", pair: "0xA43fe16908251ee70EF74718545e4FE6C5cCEc9f" },
  SHIB: { token: "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE", pair: "0x811beEd0119b4AfCE20D2583EB608C6F7AF1954f" },
};

/** Case id of a radar coin on-chain: keccak256("canary:radar:<SYMBOL>"). Case files use keccak256("canary:<slug>"). */
export const radarCaseId = (symbol: string) => keccak256(toBytes(`canary:radar:${symbol.toUpperCase()}`));

/** The same mapping the case files use: 1 suspicious, 2 pump-and-dump (3 "collapsed" needs a collapse check). */
export const levelOfVerdict = (v: Verdict): Snapshot["level"] => (v === "pump-and-dump" ? 2 : v === "suspicious" ? 1 : 0);

export type WatchEntry = Snapshot & {
  source: "case" | "radar";
  slug?: string; // case files: /case/<slug>
  run?: string; // radar coins: the saved run file the verdict comes from (/api/radar?run=<file>)
  gaps?: string[]; // what this entry could not say, in plain words
};
export type WatchSkip = { symbol: string; reason: string; run: string | null };
export type WatchList = { format: typeof WATCH_FORMAT; caseIds: string; cases: WatchEntry[]; skipped: WatchSkip[] };

const CASE_ID_RULE = 'case files: keccak256("canary:<slug>"); radar coins: keccak256("canary:radar:<SYMBOL>")';

type Latest = { symbol: string; file: string; run: LiveRun; verified: boolean; problems: string[] };

/** Each coin's newest saved real run (newest file first; only the first run that mentions a coin counts). */
async function latestRunPerSymbol(dir: string): Promise<Latest[]> {
  const names = (await readdir(path.join(dir, "runs")).catch(() => [] as string[])).filter((n) => RUN_FILE_RE.test(n)).sort().reverse();
  const seen = new Map<string, Latest>();
  for (const file of names.slice(0, MAX_RUNS_READ)) {
    const saved = await readRun(file, dir);
    if (!saved || saved.format !== RUN_FORMAT || saved.run.mode !== "live" || !reachedRyo(saved.run)) continue;
    const fresh = saved.run.perSymbol.map((p) => p.symbol.toUpperCase()).filter((s) => !seen.has(s));
    if (!fresh.length) continue;
    const check = await verifySavedRun(saved);
    for (const symbol of fresh) seen.set(symbol, { symbol, file, run: saved.run, verified: check.ok, problems: check.problems });
  }
  return [...seen.values()];
}

/** Radar coins for the watch list, and the ones left out with why. Sorted by symbol. */
export async function radarWatch(dir = radarDir()): Promise<{ cases: WatchEntry[]; skipped: WatchSkip[] }> {
  const cases: WatchEntry[] = [];
  const skipped: WatchSkip[] = [];
  for (const l of (await latestRunPerSymbol(dir)).sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0))) {
    const p = l.run.perSymbol.find((x) => x.symbol.toUpperCase() === l.symbol)!;
    const level = levelOfVerdict(p.debate.judge.verdict);
    const known = RADAR_TOKENS[l.symbol];
    const skip = (reason: string) => skipped.push({ symbol: l.symbol, reason, run: l.file });
    if (!l.verified) skip(`its latest saved run does not verify (${l.problems[0] ?? "trail check failed"}), so it is not sent`);
    else if (!/^[0-9a-f]{64}$/.test(l.run.headHash)) skip("its latest saved run has no valid notebook head");
    else if (level < 1) skip("the judge's latest verdict is no fraud signal (level 0)");
    else if (!known) skip("no verified ERC-20 token and Uniswap V2 pool on Ethereum mainnet on record, so Chainlink can't check its pool");
    else {
      const f = l.run.facts.find((x) => x.symbol.toUpperCase() === l.symbol);
      const ev = l.run.convergence?.events.find((e) => e.token.toUpperCase() === l.symbol);
      const gaps = ['no "before" liquidity from this same pool, so the workflow writes an alert but never judges a collapse for it'];
      if (f?.liquidityUsd == null) gaps.push("RYO gave no liquidity figure (sent as 0; the workflow reads the pool itself)");
      if (!l.run.convergence) gaps.push("no promoter posts were supplied to this run, so promoters is 0");
      cases.push({
        caseId: radarCaseId(l.symbol),
        symbol: l.symbol,
        token: known.token,
        level,
        promoters: ev?.promoters.length ?? 0,
        trailHash: `0x${l.run.headHash}`,
        liquidityBeforeUsd: 0,
        liquidityNowUsd: f?.liquidityUsd == null ? 0 : Math.round(f.liquidityUsd),
        pair: known.pair,
        source: "radar",
        run: l.file,
        gaps,
      });
    }
  }
  return { cases, skipped };
}

/** Case files first (in the given order), then radar coins; repeated case ids dropped; at most MAX_WATCHED. */
export function buildWatchList(caseSnapshots: WatchEntry[], radar: { cases: WatchEntry[]; skipped: WatchSkip[] }): WatchList {
  const seen = new Set<string>();
  const cases: WatchEntry[] = [];
  const skipped = [...radar.skipped];
  for (const c of [...caseSnapshots, ...radar.cases]) {
    const id = c.caseId.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    if (cases.length >= MAX_WATCHED) skipped.push({ symbol: c.symbol, reason: `the list is full (${MAX_WATCHED} cases)`, run: c.run ?? null });
    else cases.push(c);
  }
  return { format: WATCH_FORMAT, caseIds: CASE_ID_RULE, cases, skipped };
}

// ---------- the optional bearer token (WATCH_TOKEN) ----------

/**
 * True when the request may read the watch list. With no WATCH_TOKEN configured the list is public.
 * With one, the caller (the Chainlink DON, which reads it from a CRE secret) must send
 * "Authorization: Bearer <WATCH_TOKEN>". Compared in constant time.
 */
export function watchTokenOk(authorization: string | null, expected: string | undefined): boolean {
  if (!expected) return true;
  const m = /^Bearer\s+(.+)$/i.exec(authorization?.trim() ?? "");
  if (!m) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(m[1].trim()), digest(expected));
}
