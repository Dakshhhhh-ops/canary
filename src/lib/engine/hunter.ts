// Token Hunter: score each candidate on explicit numeric rules and explain every one of them,
// for the tokens it SELECTS for a case review and the ones it REJECTS. A rule with no data is
// "unknown": it adds no points and is listed, so a missing number never becomes a fake one.

import type { CaseFile } from "../types";
import { liquidityStats, ms, pct, peakOf, priceId, withPrice } from "./series";
import type { ConvergenceResult, HunterCandidate, HunterResult, HunterRule, HunterVerdict } from "./types";

export type HunterThresholds = {
  minLiquidityToMcapPct: number; // red flag below: thin liquidity behind a big claimed value
  maxTop10HolderPct: number; // red flag above
  maxLiquidityDropPct: number; // red flag at or above (drop from peak)
  minConvergingPromoters: number; // red flag at or above
  maxUndisclosedPaidPosts: number; // red flag above (default 0: any one is a flag)
  maxRunUpPct: number; // red flag at or above
  selectThreshold: number; // points needed to select a token for review
};

export const DEFAULT_THRESHOLDS: HunterThresholds = {
  minLiquidityToMcapPct: 2,
  maxTop10HolderPct: 50,
  maxLiquidityDropPct: 50,
  minConvergingPromoters: 3,
  maxUndisclosedPaidPosts: 0,
  maxRunUpPct: 100,
  selectThreshold: 4,
};

const POINTS: Record<HunterRule["id"], number> = {
  "liquidity-depth": 2,
  "holder-concentration": 2,
  "liquidity-drop": 2,
  "promoter-convergence": 2,
  "undisclosed-paid": 3,
  "price-run-up": 1,
};

const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round1 = (v: number) => Math.round(v * 10) / 10;

function rule(id: HunterRule["id"], label: string, value: number | null, threshold: number, comparison: string, isFlag: (v: number) => boolean, say: (v: number, flag: boolean) => string): HunterRule {
  if (value === null) return { id, label, value, threshold, comparison, outcome: "unknown", points: 0, explanation: `${label}: no data, so this rule could not be checked (no points either way).` };
  const flag = isFlag(value);
  return { id, label, value, threshold, comparison, outcome: flag ? "red-flag" : "clear", points: flag ? POINTS[id] : 0, explanation: say(value, flag) };
}

export function scoreCandidate(c: HunterCandidate, t: HunterThresholds = DEFAULT_THRESHOLDS): HunterVerdict {
  const liq = n(c.liquidityUsd);
  const mcap = n(c.claimedMarketCapUsd);
  const depth = liq !== null && mcap ? round1((liq / mcap) * 100) : null;
  const peakLiq = n(c.peakLiquidityUsd);
  const drop = peakLiq && liq !== null ? round1(-pct(peakLiq, liq)) : null;
  const promoters = n(c.convergingPromoters);
  const voices = n(c.independentVoices);

  const rules: HunterRule[] = [
    rule("liquidity-depth", "Liquidity vs claimed market cap", depth, t.minLiquidityToMcapPct, `< ${t.minLiquidityToMcapPct}%`, (v) => v < t.minLiquidityToMcapPct, (v, f) =>
      `Only $${liq!.toLocaleString("en-US")} of liquidity stands behind a claimed $${mcap!.toLocaleString("en-US")} market cap (${v}%). ${f ? `Below ${t.minLiquidityToMcapPct}%: the "value" could not be sold for anything near that.` : `At or above ${t.minLiquidityToMcapPct}%: deep enough.`}`),
    rule("holder-concentration", "Top-10 holders' share of supply", n(c.top10HolderPct), t.maxTop10HolderPct, `> ${t.maxTop10HolderPct}%`, (v) => v > t.maxTop10HolderPct, (v, f) =>
      `The 10 largest wallets hold ${v}% of the supply. ${f ? `Above ${t.maxTop10HolderPct}%: a handful of wallets can crash the price by selling.` : `Not above ${t.maxTop10HolderPct}%.`}`),
    rule("liquidity-drop", "Liquidity drop from its peak", drop, t.maxLiquidityDropPct, `>= ${t.maxLiquidityDropPct}%`, (v) => v >= t.maxLiquidityDropPct, (v, f) =>
      `Liquidity fell ${v}% from its peak ($${peakLiq!.toLocaleString("en-US")} → $${liq!.toLocaleString("en-US")}). ${f ? `At least ${t.maxLiquidityDropPct}%: money was pulled out of the pool.` : `Less than ${t.maxLiquidityDropPct}%.`}`),
    rule("promoter-convergence", "Promoters pushing it in the same window", promoters, t.minConvergingPromoters, `>= ${t.minConvergingPromoters}`, (v) => v >= t.minConvergingPromoters, (v, f) =>
      `${v} promoter${v === 1 ? "" : "s"} pushed it in the same window${voices !== null ? `, ${voices} of them independent` : ""}. ${f ? `At least ${t.minConvergingPromoters}: many voices pushing one token at once.` : `Fewer than ${t.minConvergingPromoters}.`}`),
    rule("undisclosed-paid", "Paid posts that did not disclose payment", n(c.undisclosedPaidPosts), t.maxUndisclosedPaidPosts, `> ${t.maxUndisclosedPaidPosts}`, (v) => v > t.maxUndisclosedPaidPosts, (v, f) =>
      `${v} post${v === 1 ? " was" : "s were"} documented as paid without saying so. ${f ? "Undisclosed paid promotion of a security is illegal touting (Securities Act §17(b))." : "None found."}`),
    rule("price-run-up", "Price run-up during the promotion", n(c.priceRunUpPct), t.maxRunUpPct, `>= ${t.maxRunUpPct}%`, (v) => v >= t.maxRunUpPct, (v, f) =>
      `The price rose ${v}% during the promotion. ${f ? `At least ${t.maxRunUpPct}%: the classic "pump".` : `Less than ${t.maxRunUpPct}%.`}`),
  ];
  const score = rules.reduce((s, r) => s + r.points, 0);
  const maxScore = Object.values(POINTS).reduce((a, b) => a + b, 0);
  const selected = score >= t.selectThreshold;
  const flags = rules.filter((r) => r.outcome === "red-flag");
  const unknown = rules.filter((r) => r.outcome === "unknown");
  const explanation = `${c.symbol}: ${score} of ${maxScore} points (${selected ? "selected" : "rejected"}; ${t.selectThreshold} needed). ${
    flags.length ? `Red flags: ${flags.map((r) => r.label.toLowerCase()).join("; ")}.` : "No red flags."
  }${unknown.length ? ` Not checked for lack of data: ${unknown.map((r) => r.label.toLowerCase()).join("; ")}.` : ""}`;
  return { symbol: c.symbol, score, maxScore, selected, rules, unknownCount: unknown.length, explanation, evidenceIds: c.evidenceIds };
}

/** Score every candidate; highest score first within each list. */
export function hunt(candidates: HunterCandidate[], thresholds: Partial<HunterThresholds> = {}): HunterResult {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const all = candidates.map((c) => scoreCandidate(c, t)).sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  return { selectThreshold: t.selectThreshold, selected: all.filter((v) => v.selected), rejected: all.filter((v) => !v.selected) };
}

/** Build the case token's candidate from the case file and the convergence result. */
export function candidateFromCase(cf: CaseFile, conv: ConvergenceResult, claimedMarketCapUsd: number | null = null): HunterCandidate {
  const liq = liquidityStats(cf.prices);
  const ps = withPrice(cf.prices);
  const start = ps.find((p) => ms(p.t) >= ms(cf.window.pumpStart.slice(0, 10))) ?? null; // run-up measured from the case's pump start
  const peak = peakOf(cf.prices);
  const best = conv.events[0] ?? conv.bestCluster;
  const undisclosed = cf.posts.filter((p) => p.paid && p.disclosedPayment === false);
  return {
    symbol: cf.token.symbol,
    claimedMarketCapUsd,
    liquidityUsd: liq?.lowAfterPeak.liquidityUsd ?? null,
    peakLiquidityUsd: liq?.peak.liquidityUsd ?? null,
    top10HolderPct: cf.holders?.top10Pct ?? null,
    priceRunUpPct: start && peak && ms(peak.t) >= ms(start.t) ? pct(start.priceUsd, peak.priceUsd) : null,
    convergingPromoters: best ? best.promoters.length : 0,
    independentVoices: best ? best.independentVoices : 0,
    undisclosedPaidPosts: undisclosed.length,
    evidenceIds: [
      ...(liq ? [priceId(liq.peak), priceId(liq.lowAfterPeak)] : []),
      ...(start ? [priceId(start)] : []),
      ...(peak ? [priceId(peak)] : []),
      ...(cf.holders ? ["holders"] : []),
      ...(best ? ["convergence"] : []),
      ...undisclosed.map((p) => p.id),
    ].filter((v, i, a) => a.indexOf(v) === i),
  };
}
