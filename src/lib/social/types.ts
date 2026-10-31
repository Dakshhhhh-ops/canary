// Live promoter posts from free, public sources. Shapes only (browser-safe).
// A SocialPost IS a PromoterPost, so the Multi-KOL convergence agent reads it unchanged; the extra
// fields say where it came from and what its text shows (payment disclosure, shill words, contracts).
import type { Gap } from "../engine/types";
import type { PromoterPost } from "../types";

export const SOCIAL_SOURCES = ["telegram", "bluesky", "reddit", "farcaster"] as const;
export type SocialSourceId = (typeof SOCIAL_SOURCES)[number];

export const SOURCE_LABEL: Record<SocialSourceId, string> = { telegram: "Telegram", bluesky: "Bluesky", reddit: "Reddit", farcaster: "Farcaster" };

/** What a post's own words show. Read from the text only: nothing here says who really paid whom. */
export type PostSignals = {
  disclosure: {
    said: boolean; // the post says it is paid / sponsored / an ad
    terms: string[]; // the words that said so ("#ad", "sponsored", ...)
    payer: string | null; // "paid by X" / "sponsored by X", when the post names one
    amount: string | null; // an amount next to the payment words, when the post states one
    complete: boolean; // payment + payer + amount: what Securities Act §17(b) asks of a paid promoter
  };
  shill: string[]; // promotion-style phrases found ("100x", "to the moon", "buy now", ...)
  promotional: boolean; // reads like a push to buy (shill words, or the post says it is an ad)
  cashtags: string[]; // $ABC, upper-cased
  hashtags: string[]; // #abc, upper-cased
  contracts: { chain: "evm" | "solana"; address: string }[];
  forwardedFrom: string | null; // Telegram: the channel this post was forwarded from
};

export type SocialPost = Omit<PromoterPost, "text"> & {
  text: string; // the post's text as read (always present for a live post)
  network: SocialSourceId;
  url: string; // the original post
  symbols: string[]; // which of the run's coins it is about (cashtag, hashtag or ticker in capitals)
  views: number | null; // Telegram view counter, when shown
  signals: PostSignals;
  rawIndex: number; // which raw reply in the collector's log it was read from
};

/** One request exactly as it went over the wire. The body is the reply text as received; never holds a key. */
export type SocialRawCall = {
  source: SocialSourceId;
  target: string; // "@channel", "#PEPE", "r/CryptoMoonShots", ...
  url: string; // no credentials ever go in a URL
  ok: boolean;
  status: number | null;
  contentType: string | null;
  body: string | null; // null when nothing arrived, or when it is a credential (token replies are never kept)
  error: string | null;
  fetchedAt: string;
  latencyMs: number;
  withheld?: string; // set by the saver when a body looked key-shaped and was left out of the file
};

/** A raw call as the notebook records it: the body itself lives in the saved run, bound here by its SHA-256. */
export type SocialRawDigest = { source: SocialSourceId; target: string; url: string; ok: boolean; status: number | null; fetchedAt: string; bytes: number | null; digest: string | null };

export type SourceStatus = {
  id: SocialSourceId;
  label: string;
  state: "answered" | "partial" | "gap" | "off";
  asked: number; // requests made
  answered: number; // requests that came back usable
  read: number; // posts parsed from the replies (before matching the coins)
  kept: number; // posts about the run's coins inside the window
  note: string; // plain words: what was asked, or why not
};

export type SocialSymbolView = {
  symbol: string;
  h24: { posts: number; accounts: number; promotional: number };
  h72: { posts: number; accounts: number; promotional: number; promotionalAccounts: number; disclosed: number; disclosedComplete: number; contracts: string[] };
  convergence: { promoters: number; independentVoices: number; echoGroups: string[][]; echoes: string[]; coordinated: boolean; detected: boolean } | null;
  summary: string; // one plain-words sentence
};

export type SocialSummary = {
  at: string; // when collection started (the window ends here)
  windowHours: number;
  sources: SourceStatus[];
  posts: SocialPost[]; // posts about the run's coins inside the window, newest first (capped)
  read: number; // every post parsed, before filtering
  outsideWindow: number;
  perSymbol: SocialSymbolView[];
  raw: SocialRawDigest[];
  gaps: Gap[];
};
