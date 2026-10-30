// Collapse detection: the first day the price is down >= threshold (default 80%) from its high so far.
import type { CaseFile, PricePoint } from "../types";
import { fmtUsd, pct, priceId, sorted, withPrice } from "./series";
import type { CollapseResult } from "./types";

export function detectCollapse(prices: PricePoint[], thresholdPct = 80, caseFile?: Pick<CaseFile, "collapse">): CollapseResult {
  const ps = withPrice(prices);
  let high: (typeof ps)[number] | null = null;
  for (const p of ps) {
    if (!high || p.priceUsd > high.priceUsd) {
      high = p;
      continue;
    }
    const drop = -pct(high.priceUsd, p.priceUsd);
    if (drop >= thresholdPct) {
      const all = sorted(prices);
      const liqHigh = all.find((x) => x.t === high!.t)?.liquidityUsd ?? null;
      const liqLow = all.find((x) => x.t === p.t)?.liquidityUsd ?? null;
      const liquidityDropPct = liqHigh && liqLow != null ? -pct(liqHigh, liqLow) : null;
      const matches = caseFile ? caseFile.collapse.dropPct >= thresholdPct : null;
      return {
        detected: true,
        thresholdPct,
        peak: { t: high.t, priceUsd: high.priceUsd },
        collapse: { t: p.t, priceUsd: p.priceUsd, dropPct: drop },
        liquidityDropPct,
        matchesCaseFile: matches,
        explanation: `The price peaked at ${fmtUsd(high.priceUsd)} on ${high.t.slice(0, 10)} and by ${p.t.slice(0, 10)} had fallen ${drop}% to ${fmtUsd(p.priceUsd)}, past the ${thresholdPct}% collapse line.${
          liquidityDropPct !== null ? ` Liquidity fell ${liquidityDropPct}% over the same days.` : ""
        }${matches === false ? " Note: the case file's own collapse figure is below this line." : ""}`,
        evidenceIds: [priceId(high), priceId(p)],
      };
    }
  }
  return {
    detected: false,
    thresholdPct,
    peak: high ? { t: high.t, priceUsd: high.priceUsd } : null,
    collapse: null,
    liquidityDropPct: null,
    matchesCaseFile: caseFile ? caseFile.collapse.dropPct < thresholdPct : null,
    explanation: high ? `No fall of ${thresholdPct}% or more from a high was found in the price data.` : "No price data to check.",
    evidenceIds: high ? [priceId(high)] : [],
  };
}
