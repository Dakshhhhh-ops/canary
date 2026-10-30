// News Checker: take a claim (a promoter's post, or a news item), line it up against the
// price/liquidity series, and say in plain words whether the market bore it out.
// It shows timing (cause → effect), never proof of causation, and says so.

import type { PricePoint, PromoterPost } from "../types";
import { DAY, fmtPct, fmtUsd, ms, pct, priceId, sorted, withPrice } from "./series";
import type { Claim, NewsCheck } from "./types";

export type NewsOptions = { shortDays?: number; longDays?: number };

const UP = /\b(moon|mooning|buy|buying|pump|gem|rocket|bullish|going up|get in|don'?t miss|to the moon|lambo|next big|100x|10x|1000x|huge|explod\w*|skyrocket\w*)\b|🚀/i;
const DOWN = /\b(crash\w*|dump\w*|sell|selling|bearish|scam|rug\w*|going down|collapse\w*)\b/i;

/** "up" / "down" from the words used, or "unclear". */
export function inferDirection(text: string): "up" | "down" | "unclear" {
  const up = UP.test(text);
  const down = DOWN.test(text);
  return up && !down ? "up" : down && !up ? "down" : "unclear";
}

/** A promoter post read as a claim: promoting a token implies "it is worth buying". */
export const claimFromPost = (p: PromoterPost): Claim => ({
  id: p.id,
  text: p.text ?? `${p.promoter} promoted the token (no exact quote documented)`,
  at: p.postedAt,
  direction: "up",
  source: p.promoter,
});

const day = (t: string) => t.slice(0, 10);

export function checkClaim(claim: Claim, prices: PricePoint[], opts: NewsOptions = {}): NewsCheck {
  const shortDays = opts.shortDays ?? 3;
  const longDays = opts.longDays ?? 30;
  const direction = claim.direction ?? inferDirection(claim.text);
  const ps = withPrice(prices);
  const t0 = ms(day(claim.at));
  // a claim dated only to the month, or with no price within 2 days, cannot be lined up with the market
  const first = claim.at.length >= 10 ? (ps.find((p) => ms(p.t) >= t0) ?? null) : null;
  const start = first && ms(first.t) - t0 <= 2 * DAY ? first : null;
  const upTo = (days: number) => (start ? [...ps].reverse().find((p) => ms(p.t) <= ms(start.t) + days * DAY && ms(p.t) > ms(start.t)) ?? null : null);
  const short = upTo(shortDays);
  const long = upTo(longDays);
  const who = claim.source ? `${claim.source} ` : "";
  const cause = `${who}said on ${day(claim.at)}: "${claim.text.slice(0, 160)}"${direction === "unclear" ? "" : ` (read as: price will go ${direction})`}.`;

  const empty: NewsCheck["effect"] = { startPriceUsd: null, shortPriceUsd: null, longPriceUsd: null, shortChangePct: null, longChangePct: null, maxRunUpPct: null, maxDrawdownPct: null, liquidityChangePct: null };
  if (!start || !long) {
    return {
      claimId: claim.id,
      direction,
      cause,
      effect: { ...empty, startPriceUsd: start?.priceUsd ?? null },
      shortVerdict: "insufficient-data",
      verdict: "insufficient-data",
      explanation: `${cause} ${claim.at.length < 10 ? "The claim is only dated to the month, so it cannot be lined up with daily prices." : "There is not enough price data around that date to check it."}`,
      evidenceIds: [claim.id, ...(start ? [priceId(start)] : [])],
    };
  }

  const inside = ps.filter((p) => ms(p.t) > ms(start.t) && ms(p.t) <= ms(long.t));
  const top = inside.reduce((b, p) => (p.priceUsd > b.priceUsd ? p : b), start);
  const afterTop = inside.filter((p) => ms(p.t) >= ms(top.t));
  const bottom = afterTop.reduce((b, p) => (p.priceUsd < b.priceUsd ? p : b), top);
  const all = sorted(prices);
  const liqStart = all.find((p) => p.t === start.t)?.liquidityUsd ?? null;
  const liqEnd = all.find((p) => p.t === long.t)?.liquidityUsd ?? null;

  const effect: NewsCheck["effect"] = {
    startPriceUsd: start.priceUsd,
    shortPriceUsd: short?.priceUsd ?? null,
    longPriceUsd: long.priceUsd,
    shortChangePct: short ? pct(start.priceUsd, short.priceUsd) : null,
    longChangePct: pct(start.priceUsd, long.priceUsd),
    maxRunUpPct: pct(start.priceUsd, top.priceUsd),
    maxDrawdownPct: top === bottom ? 0 : -pct(top.priceUsd, bottom.priceUsd),
    liquidityChangePct: liqStart && liqEnd != null ? pct(liqStart, liqEnd) : null,
  };
  const judge = (chg: number | null): NewsCheck["verdict"] =>
    chg === null || direction === "unclear" ? "insufficient-data" : (direction === "up" ? chg > 0 : chg < 0) ? "supported" : "contradicted";
  const shortVerdict = judge(effect.shortChangePct);
  const verdict = judge(effect.longChangePct);

  const lines = [
    cause,
    effect.shortChangePct !== null ? `In the next ${shortDays} days the price moved ${fmtPct(effect.shortChangePct)} (${fmtUsd(start.priceUsd)} → ${fmtUsd(short!.priceUsd)}).` : "",
    `Over ${longDays} days it moved ${fmtPct(effect.longChangePct!)} (to ${fmtUsd(long.priceUsd)}); at its best it was ${fmtPct(effect.maxRunUpPct!)}, then fell ${effect.maxDrawdownPct}% from that high.`,
    effect.liquidityChangePct !== null ? `Money available to sell into (liquidity) changed ${fmtPct(effect.liquidityChangePct)}.` : "",
    verdict === "supported"
      ? `The market bore the claim out over ${longDays} days.`
      : verdict === "contradicted"
        ? shortVerdict === "supported"
          ? `It looked right for a few days, then the opposite happened: someone who bought on the day of the claim would be down ${Math.abs(Math.min(0, effect.longChangePct!))}% a month later.`
          : `The market went the other way.`
        : `The claim does not say which way the price should go, so it cannot be scored.`,
    `Timing is not proof that the post caused the move.`,
  ];
  return {
    claimId: claim.id,
    direction,
    cause,
    effect,
    shortVerdict,
    verdict,
    explanation: lines.filter(Boolean).join(" "),
    evidenceIds: [...new Set([claim.id, priceId(start), ...(short ? [priceId(short)] : []), priceId(top), priceId(bottom), priceId(long)])],
  };
}

export const checkClaims = (claims: Claim[], prices: PricePoint[], opts?: NewsOptions) => claims.map((c) => checkClaim(c, prices, opts));
