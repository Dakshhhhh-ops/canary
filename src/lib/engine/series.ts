// Small helpers over a price/liquidity series (PricePoint[] from the case file).
import type { PricePoint } from "../types";

export const DAY = 86_400_000;

/** Evidence id for one price point. */
export const priceId = (p: PricePoint) => `price:${p.t}`;

export const ms = (t: string) => Date.parse(t.length === 10 ? `${t}T00:00:00Z` : t);

/** Points sorted by time, oldest first. */
export const sorted = (prices: PricePoint[]) => [...prices].sort((a, b) => ms(a.t) - ms(b.t));

export const withPrice = (prices: PricePoint[]) => sorted(prices).filter((p): p is PricePoint & { priceUsd: number } => typeof p.priceUsd === "number" && p.priceUsd > 0);

/** Percent change from a to b, rounded to one decimal. */
export const pct = (a: number, b: number) => Math.round(((b - a) / a) * 1000) / 10;

/** Highest-priced point (first one on ties). */
export function peakOf(prices: PricePoint[]) {
  const ps = withPrice(prices);
  return ps.reduce<(typeof ps)[number] | null>((best, p) => (!best || p.priceUsd > best.priceUsd ? p : best), null);
}

/** Highest liquidity seen, and the latest liquidity figure. */
export function liquidityStats(prices: PricePoint[]) {
  const ls = sorted(prices).filter((p) => typeof p.liquidityUsd === "number") as (PricePoint & { liquidityUsd: number })[];
  if (!ls.length) return null;
  const peak = ls.reduce((b, p) => (p.liquidityUsd > b.liquidityUsd ? p : b));
  const last = ls[ls.length - 1];
  const afterPeak = ls.filter((p) => ms(p.t) >= ms(peak.t));
  const low = afterPeak.reduce((b, p) => (p.liquidityUsd < b.liquidityUsd ? p : b));
  return { peak, last, lowAfterPeak: low, dropPct: peak.liquidityUsd > 0 ? -pct(peak.liquidityUsd, low.liquidityUsd) : null };
}

/** $1.25M, $45.0k, $3.10, or plain decimals with 3 significant digits for tiny token prices ($0.000000230). */
export const fmtUsd = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : n >= 0.01 || n === 0 ? `$${n.toFixed(2)}` : `$${n.toFixed(Math.min(20, Math.ceil(-Math.log10(n)) + 2))}`;

export const fmtPct = (n: number) => `${n > 0 ? "+" : ""}${n}%`;
