// Engine-only shapes. Shared app shapes (PromoterPost, CaseFile, TrailEntry, ...) live in ../types.
import type { PracticeTrade, TrailEntry, Verdict } from "../types";

/** Something we tried to learn and could not. Recorded, never papered over with a made-up number. */
export type Gap = {
  source: string; // "ryo:analyze_token", "case.holders", "llm:bull", ...
  what: string; // what was missing, in plain words
  reason: string; // why (no key, timeout, isError, missing field, ...)
  at: string; // ISO, from the injected clock
};

/** One fact the agents may cite. Bull and Bear receive the same list. */
export type EvidenceItem = {
  id: string; // "post-1", "price:2021-06-14", "holders", "convergence", ...
  kind: "post" | "price" | "legal" | "holders" | "buyers" | "peak" | "collapse" | "finding" | "market";
  text: string; // one plain-words line, numbers included
  data?: unknown;
};

export type EvidenceBundle = { items: EvidenceItem[]; ids: string[]; hash: string };

// ---------- convergence ----------

export type EchoLink = {
  a: string; // post id
  b: string; // post id
  reason: "same-payer" | "copy-paste";
  detail: string;
};

export type ConvergenceEvent = {
  token: string;
  windowStart: string; // earliest possible time of the first post in the cluster
  windowEnd: string; // latest possible time of the last post
  windowHours: number;
  postIds: string[];
  promoters: string[]; // distinct promoters in the cluster
  independentGroups: string[][]; // promoters grouped by shared payer / copied text
  independentVoices: number; // = independentGroups.length
  echoLinks: EchoLink[];
  /** Enough promoters, but fewer independent voices than the threshold: looks organised, not organic. */
  coordinated: boolean;
  disclosure: {
    disclosed: string[]; // post ids that said they were paid
    undisclosed: string[]; // post ids that did not say so
    unknown: string[];
    paidButUndisclosed: string[]; // documented payment + no disclosure (Securities Act §17(b) concern)
  };
  precisionNote?: string; // set when month-precision dates widen the window
  reasoning: string[]; // plain-words sentences
};

export type ConvergenceResult = {
  params: { minPromoters: number; windowHours: number; copyThreshold: number };
  events: ConvergenceEvent[]; // detected clusters (>= minPromoters distinct promoters)
  bestCluster: ConvergenceEvent | null; // largest cluster even if below the threshold
  detected: boolean;
  skipped: { postId: string; reason: string }[]; // posts with no token we could attribute
};

// ---------- news ----------

export type Claim = {
  id: string; // evidence id of the claim, e.g. a post id
  text: string;
  at: string; // ISO date/datetime the claim was made
  direction?: "up" | "down"; // inferred from the text when not given
  source?: string; // who made it
};

export type NewsCheck = {
  claimId: string;
  direction: "up" | "down" | "unclear";
  cause: string; // plain words
  effect: {
    startPriceUsd: number | null;
    shortPriceUsd: number | null;
    longPriceUsd: number | null;
    shortChangePct: number | null;
    longChangePct: number | null;
    maxRunUpPct: number | null;
    maxDrawdownPct: number | null; // worst fall from the post-claim peak, inside the long horizon
    liquidityChangePct: number | null;
  };
  shortVerdict: "supported" | "contradicted" | "insufficient-data";
  verdict: "supported" | "contradicted" | "insufficient-data"; // over the long horizon
  explanation: string;
  evidenceIds: string[];
};

// ---------- hunter ----------

export type HunterCandidate = {
  symbol: string;
  claimedMarketCapUsd?: number | null;
  liquidityUsd?: number | null;
  peakLiquidityUsd?: number | null;
  top10HolderPct?: number | null;
  priceRunUpPct?: number | null;
  convergingPromoters?: number | null;
  independentVoices?: number | null;
  undisclosedPaidPosts?: number | null;
  evidenceIds: string[];
};

export type RuleOutcome = "red-flag" | "clear" | "unknown";

export type HunterRule = {
  id: "liquidity-depth" | "holder-concentration" | "liquidity-drop" | "promoter-convergence" | "undisclosed-paid" | "price-run-up";
  label: string;
  value: number | null;
  threshold: number;
  comparison: string; // e.g. "< 2%" — the side that raises a red flag
  outcome: RuleOutcome;
  points: number; // points added when red-flag
  explanation: string;
};

export type HunterVerdict = {
  symbol: string;
  score: number;
  maxScore: number;
  selected: boolean; // selected for a case review (enough red flags)
  rules: HunterRule[];
  unknownCount: number;
  explanation: string;
  evidenceIds: string[];
};

export type HunterResult = { selectThreshold: number; selected: HunterVerdict[]; rejected: HunterVerdict[] };

// ---------- debate ----------

export type DebateClaim = { text: string; evidenceIds: string[] };

export type GuardRejection = { side: "bull" | "bear" | "judge"; text: string; reason: string };

export type DebateSide = {
  side: "bull" | "bear";
  stance: string;
  claims: DebateClaim[];
  mode: "llm" | "rules"; // rules = deterministic fallback
  fallbackReason?: string;
};

export type JudgeFactor = { id: string; label: string; weight: number; present: boolean | null; detail: string; evidenceIds: string[] };

export type JudgeResult = {
  verdict: Verdict;
  score: number; // sum of weights of present factors, 0..1
  weights: Record<string, number>;
  factors: JudgeFactor[];
  tally: { bullClaims: number; bearClaims: number };
  reasoning: string;
  mode: "llm" | "rules"; // who wrote the reasoning; the verdict itself is always rule-based
};

export type DebateResult = {
  bundleHash: string; // both sides were given exactly this bundle
  bull: DebateSide;
  bear: DebateSide;
  judge: JudgeResult;
  rejected: GuardRejection[];
  gaps: Gap[];
};

// ---------- risk ----------

export type RiskLimits = {
  maxPositionUsd: number;
  minLiquidityUsd: number;
  maxTop10HolderPct: number;
  refuseUndisclosedPaidPromotion: boolean;
  maxDrawdownPct: number; // the stop may sit at most this far below entry
  dailyLossLimitUsd: number; // circuit breaker: realised + worst-case loss today
  /** When nobody knows who holds the supply: refuse, or allow at half the maximum size (default). */
  unknownHolders?: "refuse" | "half-size";
};

/** Entry, size, stop and exit as ONE decision (the "Buy the Dip" plan). Paper only. */
export type TradePlan = {
  symbol: string;
  side: "buy";
  at: string;
  entryPriceUsd: number;
  sizeUsd: number;
  stopPriceUsd: number;
  exitPriceUsd: number;
  rationale: string;
  evidenceIds: string[];
};

export type MarketSnapshot = {
  liquidityUsd: number | null;
  top10HolderPct: number | null;
  undisclosedPaidPromotion: boolean | null;
};

export type RiskCheck = { limit: keyof RiskLimits | "data"; ok: boolean; value: number | string | null; threshold: number | string; reason: string };

export type TradeDecision = PracticeTrade & {
  plan: TradePlan;
  checks: RiskCheck[];
  worstCaseLossUsd: number;
  hindsight?: { priceUsd: number; at: string; pnlUsd: number; note: string }; // what would have happened
};

// ---------- collapse ----------

export type CollapseResult = {
  detected: boolean;
  thresholdPct: number;
  peak: { t: string; priceUsd: number } | null;
  collapse: { t: string; priceUsd: number; dropPct: number } | null;
  liquidityDropPct: number | null;
  matchesCaseFile: boolean | null; // agrees with the case file's own collapse point
  explanation: string;
  evidenceIds: string[];
};

// ---------- pipeline ----------

export type StepName = TrailEntry["agent"];

export type StepEvent = { step: StepName; entry: TrailEntry; result: unknown };

export type CaseRun = {
  slug: string;
  symbol: string;
  bundle: EvidenceBundle;
  convergence: ConvergenceResult;
  news: NewsCheck[];
  hunter: HunterResult;
  debate: DebateResult;
  trade: TradeDecision;
  collapse: CollapseResult;
  gaps: Gap[];
  trail: TrailEntry[];
  trailOk: boolean;
  headHash: string;
};
