// Practice trades, paper only: nothing here can place a real order.
// A trade is ONE decision object (entry, size, stop, exit — the "Buy the Dip" plan), checked
// against the user's own risk limits. The ledger accepts it or refuses it, in plain words.
// A limit that cannot be checked for lack of data refuses the trade instead of guessing.

import type { PricePoint } from "../types";
import type { Clock } from "./trail";
import { systemClock } from "./trail";
import { fmtUsd, ms, pct, priceId, withPrice } from "./series";
import type { MarketSnapshot, RiskCheck, RiskLimits, TradeDecision, TradePlan } from "./types";

export const DEFAULT_LIMITS: RiskLimits = {
  maxPositionUsd: 1000,
  minLiquidityUsd: 250_000,
  maxTop10HolderPct: 50,
  refuseUndisclosedPaidPromotion: true,
  maxDrawdownPct: 25,
  dailyLossLimitUsd: 300,
  unknownHolders: "half-size",
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Check one plan against the limits. `lossTodayUsd` = losses already realised today. */
export function evaluatePlan(input: TradePlan, market: MarketSnapshot, limits: RiskLimits, lossTodayUsd = 0): TradeDecision {
  const checks: RiskCheck[] = [];
  // Holder data is often missing (RYO's tools don't report it). The published rule: unless the user chose
  // "refuse", trade at most half the maximum size, so an unknown can only shrink the risk, never hide it.
  const halfSize = market.top10HolderPct === null && (limits.unknownHolders ?? "half-size") === "half-size";
  const cap = r2(limits.maxPositionUsd / 2);
  const plan: TradePlan = halfSize && input.sizeUsd > cap ? { ...input, sizeUsd: cap, rationale: `${input.rationale} Size halved to ${fmtUsd(cap)} because who holds the supply is unknown.` } : input;
  const add = (c: RiskCheck) => checks.push(c);
  const sane = plan.entryPriceUsd > 0 && plan.sizeUsd > 0 && plan.stopPriceUsd < plan.entryPriceUsd && plan.exitPriceUsd > plan.entryPriceUsd;
  add({ limit: "data", ok: sane, value: sane ? "ok" : "invalid", threshold: "stop < entry < exit, size > 0", reason: sane ? "The plan has an entry, a stop below it and an exit above it." : "The plan is not a complete decision: it needs a positive size, a stop below the entry and an exit above it." });

  add({ limit: "maxPositionUsd", ok: plan.sizeUsd <= limits.maxPositionUsd, value: plan.sizeUsd, threshold: limits.maxPositionUsd,
    reason: plan.sizeUsd <= limits.maxPositionUsd ? `Size ${fmtUsd(plan.sizeUsd)} is within your ${fmtUsd(limits.maxPositionUsd)} maximum.` : `Size ${fmtUsd(plan.sizeUsd)} is more than your ${fmtUsd(limits.maxPositionUsd)} maximum per trade.` });

  const liq = market.liquidityUsd;
  add({ limit: "minLiquidityUsd", ok: liq !== null && liq >= limits.minLiquidityUsd, value: liq, threshold: limits.minLiquidityUsd,
    reason: liq === null ? "Liquidity is unknown, so we cannot tell whether you could sell; refused rather than guessed." : liq >= limits.minLiquidityUsd ? `Liquidity ${fmtUsd(liq)} meets your ${fmtUsd(limits.minLiquidityUsd)} minimum.` : `Only ${fmtUsd(liq)} of liquidity, below your ${fmtUsd(limits.minLiquidityUsd)} minimum: you might not be able to sell.` });

  const top = market.top10HolderPct;
  add({ limit: "maxTop10HolderPct", ok: top !== null ? top <= limits.maxTop10HolderPct : halfSize, value: top, threshold: limits.maxTop10HolderPct,
    reason: top === null ? (halfSize ? `Who holds the supply is unknown, so your rule allows only half size (${fmtUsd(cap)} at most).` : "Who holds the supply is unknown; refused rather than guessed (your rule).") : top <= limits.maxTop10HolderPct ? `Top 10 wallets hold ${top}%, within your ${limits.maxTop10HolderPct}% limit.` : `Top 10 wallets hold ${top}% of the supply, above your ${limits.maxTop10HolderPct}% limit: a few sellers could crash it.` });

  if (limits.refuseUndisclosedPaidPromotion) {
    const bad = market.undisclosedPaidPromotion === true;
    add({ limit: "refuseUndisclosedPaidPromotion", ok: !bad, value: market.undisclosedPaidPromotion === null ? "unknown" : String(bad), threshold: "no undisclosed paid promotion",
      reason: bad ? "This token was promoted by people who were paid and did not say so. Your rules refuse those tokens." : market.undisclosedPaidPromotion === null ? "No paid promotion is documented for this token (not proof there was none)." : "No undisclosed paid promotion found." });
  }

  const stopPct = plan.entryPriceUsd > 0 ? r2(((plan.entryPriceUsd - plan.stopPriceUsd) / plan.entryPriceUsd) * 100) : 100;
  add({ limit: "maxDrawdownPct", ok: sane && stopPct <= limits.maxDrawdownPct, value: stopPct, threshold: limits.maxDrawdownPct,
    reason: stopPct <= limits.maxDrawdownPct ? `The stop is ${stopPct}% below the entry, within your ${limits.maxDrawdownPct}% limit.` : `The stop is ${stopPct}% below the entry; your limit is ${limits.maxDrawdownPct}%.` });

  const worst = r2(plan.sizeUsd * Math.max(0, Math.min(1, stopPct / 100)));
  const total = r2(lossTodayUsd + worst);
  const tripped = lossTodayUsd >= limits.dailyLossLimitUsd;
  add({ limit: "dailyLossLimitUsd", ok: !tripped && total <= limits.dailyLossLimitUsd, value: total, threshold: limits.dailyLossLimitUsd,
    reason: tripped ? `Circuit breaker: you already lost ${fmtUsd(lossTodayUsd)} today, at or over your ${fmtUsd(limits.dailyLossLimitUsd)} daily limit. No more trades today.` : total <= limits.dailyLossLimitUsd ? `Worst case today ${fmtUsd(total)} stays within your ${fmtUsd(limits.dailyLossLimitUsd)} daily loss limit.` : `If the stop is hit, today's losses would reach ${fmtUsd(total)}, over your ${fmtUsd(limits.dailyLossLimitUsd)} daily limit.` });

  const failed = checks.filter((c) => !c.ok);
  return {
    symbol: plan.symbol,
    side: "buy",
    sizeUsd: plan.sizeUsd,
    decision: failed.length ? "refused" : "accepted",
    reasons: failed.length ? failed.map((c) => c.reason) : ["Every one of your limits passed. Practice trade only: no real order is placed."],
    limits: { ...limits, refuseUndisclosedPaidPromotion: String(limits.refuseUndisclosedPaidPromotion), unknownHolders: limits.unknownHolders ?? "half-size" },
    plan,
    checks,
    worstCaseLossUsd: worst,
  };
}

/** Paper ledger: keeps the day's realised losses so the circuit breaker works across trades. */
export class PaperLedger {
  readonly decisions: TradeDecision[] = [];
  readonly open = new Map<string, TradePlan>();
  private losses: { at: string; usd: number }[] = [];
  constructor(
    public limits: RiskLimits = DEFAULT_LIMITS,
    private clock: Clock = systemClock,
  ) {}

  lossToday(day = this.clock().slice(0, 10)): number {
    return r2(this.losses.filter((l) => l.at.slice(0, 10) === day).reduce((s, l) => s + l.usd, 0));
  }

  propose(plan: TradePlan, market: MarketSnapshot): TradeDecision {
    const d = evaluatePlan(plan, market, this.limits, this.lossToday(plan.at.slice(0, 10)));
    this.decisions.push(d);
    if (d.decision === "accepted") this.open.set(plan.symbol, plan);
    return d;
  }

  /** Close an open paper position at a price; losses count toward the daily circuit breaker. */
  close(symbol: string, priceUsd: number, at = this.clock()): { pnlUsd: number } | null {
    const p = this.open.get(symbol);
    if (!p) return null;
    this.open.delete(symbol);
    const pnlUsd = r2(p.sizeUsd * (priceUsd / p.entryPriceUsd - 1));
    if (pnlUsd < 0) this.losses.push({ at, usd: -pnlUsd });
    return { pnlUsd };
  }
}

export type DipOptions = { dipPct?: number; stopPct?: number; rewardRisk?: number };

/**
 * "Buy the Dip": the first day the price is dipPct below its high so far, plan entry, size, stop
 * and exit together. Size risks at most half the daily loss budget at the stop, capped by max position.
 */
export function planDip(symbol: string, prices: PricePoint[], limits: RiskLimits, opts: DipOptions = {}): TradePlan | null {
  const dip = opts.dipPct ?? 30;
  const stopPct = opts.stopPct ?? 20;
  const rr = opts.rewardRisk ?? 2;
  const ps = withPrice(prices);
  let high = ps[0];
  for (const p of ps) {
    if (!high || p.priceUsd > high.priceUsd) high = p;
    else if (pct(high.priceUsd, p.priceUsd) <= -dip) {
      const entry = p.priceUsd;
      const stop = entry * (1 - stopPct / 100);
      const exit = Math.min(high.priceUsd, entry * (1 + (rr * stopPct) / 100));
      const size = r2(Math.min(limits.maxPositionUsd, (limits.dailyLossLimitUsd * 0.5) / (stopPct / 100)));
      return {
        symbol,
        side: "buy",
        at: p.t,
        entryPriceUsd: entry,
        sizeUsd: size,
        stopPriceUsd: stop,
        exitPriceUsd: exit,
        rationale: `The price is ${-pct(high.priceUsd, entry)}% below its high of ${fmtUsd(high.priceUsd)} (${high.t.slice(0, 10)}). Plan: buy ${fmtUsd(size)} at ${fmtUsd(entry)}, stop ${stopPct}% lower at ${fmtUsd(stop)}, take profit at ${fmtUsd(exit)}.`,
        evidenceIds: [priceId(high), priceId(p)],
      };
    }
  }
  return null;
}

/** What the plan would have done on the later prices (daily data: a stop can fill far below its level on a gap). */
export function hindsight(plan: TradePlan, prices: PricePoint[]): TradeDecision["hindsight"] | undefined {
  const after = withPrice(prices).filter((p) => ms(p.t) > ms(plan.at));
  if (!after.length) return undefined;
  const hit = after.find((p) => p.priceUsd <= plan.stopPriceUsd || p.priceUsd >= plan.exitPriceUsd) ?? after[after.length - 1];
  const pnlUsd = r2(plan.sizeUsd * (hit.priceUsd / plan.entryPriceUsd - 1));
  const kind = hit.priceUsd <= plan.stopPriceUsd ? "the stop" : hit.priceUsd >= plan.exitPriceUsd ? "the profit target" : "the end of the data";
  const gap = hit.priceUsd < plan.stopPriceUsd ? ` The price gapped through the stop (${fmtUsd(plan.stopPriceUsd)}), so the loss is bigger than planned.` : "";
  return { priceUsd: hit.priceUsd, at: hit.t, pnlUsd, note: `Had it been taken, it would have ended at ${kind} on ${hit.t.slice(0, 10)} at ${fmtUsd(hit.priceUsd)}: ${pnlUsd >= 0 ? "+" : "-"}${fmtUsd(Math.abs(pnlUsd))}.${gap}` };
}


export type LivePlanOptions = DipOptions & { change24hPct?: number | null };

/**
 * The live "Buy the Dip" decision: entry at RYO's current price, with size, stop and take-profit
 * set together. Size risks at most half the daily loss budget at the stop, capped by max position.
 * With no price the plan is left empty on purpose, so the risk desk refuses it instead of guessing.
 */
export function planAtPrice(symbol: string, priceUsd: number | null, at: string, limits: RiskLimits, opts: LivePlanOptions = {}, evidenceIds: string[] = []): TradePlan {
  const stopPct = opts.stopPct ?? 20;
  const rr = opts.rewardRisk ?? 2;
  if (!priceUsd || !(priceUsd > 0))
    return { symbol, side: "buy", at, entryPriceUsd: 0, sizeUsd: 0, stopPriceUsd: 0, exitPriceUsd: 0, rationale: "No current price, so no entry can be set.", evidenceIds };
  const entry = priceUsd;
  const stop = entry * (1 - stopPct / 100);
  const exit = entry * (1 + (rr * stopPct) / 100);
  const size = r2(Math.min(limits.maxPositionUsd, (limits.dailyLossLimitUsd * 0.5) / (stopPct / 100)));
  const ch = opts.change24hPct;
  const move = typeof ch === "number" && Number.isFinite(ch) ? (ch < 0 ? `It is down ${Math.abs(ch)}% over 24 hours (a dip). ` : `It is up ${ch}% over 24 hours (not a dip). `) : "";
  return {
    symbol,
    side: "buy",
    at,
    entryPriceUsd: entry,
    sizeUsd: size,
    stopPriceUsd: stop,
    exitPriceUsd: exit,
    rationale: `${move}Plan: buy ${fmtUsd(size)} at RYO's current price ${fmtUsd(entry)}, sell if it falls ${stopPct}% to ${fmtUsd(stop)}, take profit at ${fmtUsd(exit)} (${rr}× the risk). Size chosen so the stop costs at most half your daily loss limit.`,
    evidenceIds,
  };
}
