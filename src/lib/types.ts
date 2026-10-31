// Shared shapes for Canary. Every fact that comes from the outside world carries a source.

export type Source = { label: string; url: string };

/** A promoter post, as documented by a regulator, a court filing or an archive. Never invented. */
export type PromoterPost = {
  id: string;
  promoter: string; // e.g. "Kim Kardashian"
  handle?: string; // e.g. "@kimkardashian"
  platform: "instagram" | "x" | "telegram" | "youtube" | "tiktok" | "other";
  followers?: number; // at the time, if documented
  postedAt: string; // ISO date (or datetime if known)
  datePrecision: "day" | "month" | "datetime";
  text?: string; // exact quote, only if quoted in a source
  disclosedPayment: boolean | null; // did the post say it was paid? null = unknown
  paid?: { amountUsd: number; by: string } | null; // only if documented
  /** A documented tie between promoters (e.g. officers of the same company). Promoters who share one are not independent voices. */
  affiliation?: string;
  sources: Source[];
};

export type PricePoint = { t: string; priceUsd: number | null; liquidityUsd: number | null; volumeUsd?: number | null };

export type LegalAction = {
  id: string;
  kind: "sec" | "class-action" | "ftc" | "doj" | "state" | "other";
  title: string; // "SEC v. Kardashian (settled order)"
  date: string;
  summary: string; // plain words
  outcome?: string;
  statute?: string; // "Securities Act of 1933, Section 17(b)"
  sources: Source[];
};

/** A real, publicly documented case, replayed by the agents. */
export type CaseFile = {
  slug: string; // "emax"
  token: { name: string; symbol: string; chain: "ethereum"; address: string; decimals: number; pair?: string; pairDex?: string; pairCreatedBlock?: number };
  oneLiner: string; // plain-words summary for a newcomer
  window: { pumpStart: string; peak: string; collapse: string };
  posts: PromoterPost[];
  prices: PricePoint[]; // daily, from on-chain data
  peak: { t: string; priceUsd: number };
  collapse: { t: string; priceUsd: number; dropPct: number };
  buyersInWindow?: { count: number; method: string; sample: { address: string; firstBuy: string; txHash: string }[] };
  holders?: { top10Pct: number; asOf: string; method: string };
  legal: LegalAction[];
  dataNotes: string[]; // how the numbers were produced, and their limits
  sources: Source[];
};

/** One entry in the hash-chained reasoning trail. */
export type TrailEntry = {
  seq: number;
  at: string; // ISO
  agent: "collector" | "convergence" | "news" | "hunter" | "bull" | "bear" | "judge" | "risk" | "collapse" | "claims";
  kind: string; // short machine label, e.g. "convergence.detected"
  summary: string; // one plain-words sentence
  evidenceIds: string[]; // ids of the inputs this step used
  data: unknown;
  prevHash: string; // hex sha-256 of previous entry, "0".repeat(64) for the first
  hash: string; // sha-256 of canonical JSON of this entry without `hash`
};

export type Verdict = "pump-and-dump" | "suspicious" | "no-signal";

export type PracticeTrade = {
  symbol: string;
  side: "buy";
  sizeUsd: number;
  decision: "accepted" | "refused";
  reasons: string[]; // which risk limit refused it, in plain words
  limits: Record<string, number | string>;
};
