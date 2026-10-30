// The risk limits a visitor may adjust on /radar, with their published defaults and the ranges the
// server clamps to. Browser-safe: the sliders and the API read the same table.
import { DEFAULT_LIMITS } from "../engine/risk";
import type { RiskLimits } from "../engine/types";

export type LimitKey = "maxPositionUsd" | "minLiquidityUsd" | "maxTop10HolderPct" | "stopPct" | "dailyLossLimitUsd";

export type LimitField = {
  key: LimitKey;
  label: string;
  help: string;
  unit: "usd" | "pct";
  default: number;
  min: number;
  max: number;
  /** allowed values for a stepped slider (money spans orders of magnitude) */
  stops?: number[];
  step?: number;
};

export const DEFAULT_STOP_PCT = 20;

export const LIMIT_FIELDS: LimitField[] = [
  { key: "maxPositionUsd", label: "Most practice money per trade", help: "The biggest single paper trade the desk may plan.", unit: "usd", default: DEFAULT_LIMITS.maxPositionUsd, min: 50, max: 10_000, stops: [50, 100, 250, 500, 1000, 2000, 5000, 10_000] },
  { key: "minLiquidityUsd", label: "Least money in the trading pool", help: "Below this you might not be able to sell, so the trade is refused.", unit: "usd", default: DEFAULT_LIMITS.minLiquidityUsd, min: 10_000, max: 50_000_000, stops: [10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 5_000_000, 10_000_000, 50_000_000] },
  { key: "maxTop10HolderPct", label: "Most the 10 biggest wallets may own", help: "Above this, a handful of wallets could crash the price by selling.", unit: "pct", default: DEFAULT_LIMITS.maxTop10HolderPct, min: 5, max: 100, step: 5 },
  { key: "stopPct", label: "Stop-loss distance", help: `How far below the entry the trade sells to cut a loss. At most ${DEFAULT_LIMITS.maxDrawdownPct}%.`, unit: "pct", default: DEFAULT_STOP_PCT, min: 2, max: DEFAULT_LIMITS.maxDrawdownPct, step: 1 },
  { key: "dailyLossLimitUsd", label: "Most you may lose in a day", help: "The circuit breaker: once today's losses reach this, no new trades today.", unit: "usd", default: DEFAULT_LIMITS.dailyLossLimitUsd, min: 10, max: 5000, stops: [10, 25, 50, 100, 200, 300, 500, 1000, 2000, 5000] },
];

export type LimitValues = Record<LimitKey, number>;
export const DEFAULT_VALUES: LimitValues = Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, f.default])) as LimitValues;

export type ParsedLimits = { limits: RiskLimits; stopPct: number; values: LimitValues; notes: string[]; errors: string[] };

/**
 * Read limits from query parameters (or a plain object). Missing → default; not a number → error;
 * out of range → clamped, with a note saying so.
 */
export function parseLimits(input: URLSearchParams | Record<string, unknown>): ParsedLimits {
  const get = (k: string): unknown => (input instanceof URLSearchParams ? input.get(k) : input[k]);
  const values = { ...DEFAULT_VALUES };
  const notes: string[] = [];
  const errors: string[] = [];
  for (const f of LIMIT_FIELDS) {
    const raw = get(f.key);
    if (raw === null || raw === undefined || raw === "") continue;
    const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isFinite(n)) {
      errors.push(`${f.key} must be a number`);
      continue;
    }
    const v = Math.min(f.max, Math.max(f.min, n));
    if (v !== n) notes.push(`${f.label} ${n} was outside ${f.min}–${f.max} and was set to ${v}.`);
    values[f.key] = v;
  }
  const limits: RiskLimits = {
    ...DEFAULT_LIMITS,
    maxPositionUsd: values.maxPositionUsd,
    minLiquidityUsd: values.minLiquidityUsd,
    maxTop10HolderPct: values.maxTop10HolderPct,
    dailyLossLimitUsd: values.dailyLossLimitUsd,
  };
  const uh = get("unknownHolders");
  if (uh === "refuse" || uh === "half-size") limits.unknownHolders = uh;
  else if (uh !== null && uh !== undefined && uh !== "") errors.push("unknownHolders must be refuse or half-size");
  return { limits, stopPct: values.stopPct, values, notes, errors };
}

/** Query string for the API from slider values (only the ones that differ from the defaults). */
export const limitsQuery = (v: LimitValues) =>
  LIMIT_FIELDS.filter((f) => v[f.key] !== f.default)
    .map((f) => `&${f.key}=${encodeURIComponent(String(v[f.key]))}`)
    .join("");
