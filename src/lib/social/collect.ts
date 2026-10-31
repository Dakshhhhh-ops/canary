// Social-post collector: today's promoter posts from free, public sources, for the Multi-KOL watcher.
//
// Sources (each pluggable, each optional):
//   telegram  — public channel web previews, https://t.me/s/<channel>. No key.
//   bluesky   — app.bsky.feed.searchPosts on Bluesky's public AppView (its robots.txt allows the API). No key.
//   reddit    — Reddit's official API, only with REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET (a free Reddit app).
//               Reddit's robots.txt disallows automated access and its public .json answered 403 when
//               tested, so without credentials Canary does not ask and records why.
//   farcaster — Neynar cast search, only with NEYNAR_API_KEY. Farcaster's keyless endpoints disallow
//               automated access (robots.txt) and public hubs ask for a key or a payment.
//
// Rules, same as the RYO client: collect() never throws and never invents a post. A block, 403, 429,
// timeout, oversized or unparseable reply becomes a recorded Gap. Requests go one at a time per source,
// spaced, with short timeouts, small caps and an honest User-Agent. Read-only GETs (plus Reddit's token
// request when credentials are configured). Every raw reply is kept in `log`, so the notebook can
// fingerprint it and a saved run can be re-checked.
import type { Clock } from "../engine/trail";
import { systemClock } from "../engine/trail";
import type { Gap } from "../engine/types";
import { isChannelName, ParseError, parseBluesky, parseFarcaster, parseReddit, parseTelegram, type ParsedPost } from "./parse";
import { readSignals, symbolsIn } from "./signals";
import { SOCIAL_SOURCES, SOURCE_LABEL, type SocialPost, type SocialRawCall, type SocialSourceId, type SourceStatus } from "./types";

export const USER_AGENT = "Canary/1.0 (+https://github.com/Dakshhhhh-ops/canary; hackathon research)";

// Public channels whose previews answered when tested (2026-10-30): news, on-chain trackers, analysts
// and a call bot. Override with TELEGRAM_CHANNELS. Being on this list says nothing bad about a channel.
export const DEFAULT_TELEGRAM_CHANNELS = ["WatcherGuru", "lookonchainchannel", "thecryptoexpress", "gem_tools_calls", "WhaleBotAlerts", "wublockchainenglish"];
export const DEFAULT_SUBREDDITS = ["CryptoMoonShots", "SatoshiStreetBets", "CryptoCurrency"];
export const DEFAULT_BSKY_URL = "https://api.bsky.app"; // public.api.bsky.app answered 403 to search when tested

export const MAX_CHANNELS = 8;
export const MAX_SUBREDDITS = 4;
export const MAX_SEARCH_SYMBOLS = 6;

export type SocialConfig = {
  sources: SocialSourceId[];
  telegramChannels: string[];
  subreddits: string[];
  bskyUrl: string;
  reddit: { clientId: string; clientSecret: string } | null;
  neynarKey: string | null;
};

export type SocialOptions = Partial<SocialConfig> & {
  fetch?: typeof fetch; // injectable for tests
  clock?: Clock; // the collector's own clock (it runs alongside RYO, so it never shares the run's clock)
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number; // per request (default 8 s)
  spacingMs?: number; // between two requests to the same source (default 700 ms)
  budgetMs?: number; // stop starting new requests after this long (default 45 s)
  windowHours?: number; // default 72
  maxPosts?: number; // posts kept for the page and the notebook (default 90, newest first, shared fairly between the coins)
  maxBodyBytes?: number; // a bigger reply is a gap, not parsed (default 2 MB)
};

export type SocialCollection = {
  at: string;
  windowHours: number;
  sources: SourceStatus[];
  posts: SocialPost[];
  read: number;
  outsideWindow: number;
  gaps: Gap[];
  logFrom: number; // this collection's raw calls are log.slice(logFrom, logTo)
  logTo: number;
};

const env = (k: string): string | undefined => (typeof process !== "undefined" ? process.env?.[k] : undefined);
const list = (s: string | undefined) => (s ?? "").split(/[,\s]+/).map((x) => x.trim().replace(/^@|^r\//i, "")).filter(Boolean);

/** Configuration from the environment: SOCIAL_SOURCES, TELEGRAM_CHANNELS, SUBREDDITS, BSKY_APPVIEW_URL, REDDIT_CLIENT_ID/SECRET, NEYNAR_API_KEY. */
export function socialConfigFromEnv(get: (k: string) => string | undefined = env): SocialConfig {
  const raw = get("SOCIAL_SOURCES");
  const off = raw != null && /^(?:off|none|0|false)$/i.test(raw.trim());
  const asked = raw == null || !raw.trim() ? [...SOCIAL_SOURCES] : off ? [] : list(raw).map((s) => s.toLowerCase());
  const id = get("REDDIT_CLIENT_ID");
  const secret = get("REDDIT_CLIENT_SECRET");
  return {
    sources: SOCIAL_SOURCES.filter((s) => asked.includes(s)),
    telegramChannels: list(get("TELEGRAM_CHANNELS")).length ? list(get("TELEGRAM_CHANNELS")) : DEFAULT_TELEGRAM_CHANNELS,
    subreddits: list(get("SUBREDDITS")).length ? list(get("SUBREDDITS")) : DEFAULT_SUBREDDITS,
    bskyUrl: (get("BSKY_APPVIEW_URL") || DEFAULT_BSKY_URL).replace(/\/+$/, ""),
    reddit: id && secret ? { clientId: id, clientSecret: secret } : null,
    neynarKey: get("NEYNAR_API_KEY") || null,
  };
}

type Got = { ok: true; body: string; index: number } | { ok: false; reason: string; index: number | null };

/** One source's requests: spaced, timed out, logged locally (merged into the collector's log in a fixed order). */
class SourceRun {
  readonly log: SocialRawCall[] = [];
  readonly gaps: Gap[] = [];
  asked = 0;
  answered = 0;
  read = 0;
  private last = 0;
  constructor(
    readonly id: SocialSourceId,
    private c: Required<Pick<SocialOptions, "fetch" | "clock" | "sleep" | "timeoutMs" | "spacingMs" | "maxBodyBytes">> & { deadline: number },
  ) {}

  gap(what: string, reason: string) {
    this.gaps.push({ source: `social:${this.id}`, what, reason, at: this.c.clock() });
  }

  /** GET (or the one token POST). Always resolves. keepBody=false for replies that are credentials. */
  async get(target: string, url: string, init: { headers?: Record<string, string>; method?: string; body?: string; keepBody?: boolean } = {}): Promise<Got> {
    const what = `${SOURCE_LABEL[this.id]} ${target}`;
    if (Date.now() > this.c.deadline) {
      this.gap(what, "not asked: the run's time budget for social sources was used up");
      return { ok: false, reason: "time budget used up", index: null };
    }
    const wait = this.last + this.c.spacingMs - Date.now();
    if (this.last && wait > 0) await this.c.sleep(wait);
    this.last = Date.now();
    this.asked++;
    const t0 = Date.now();
    const entry: SocialRawCall = { source: this.id, target, url, ok: false, status: null, contentType: null, body: null, error: null, fetchedAt: this.c.clock(), latencyMs: 0 };
    const index = this.log.push(entry) - 1;
    const fail = (reason: string): Got => {
      entry.error = reason;
      entry.latencyMs = Date.now() - t0;
      this.gap(what, reason);
      return { ok: false, reason, index };
    };
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          ctrl.abort();
          reject(new Error(`timed out after ${this.c.timeoutMs} ms`));
        }, this.c.timeoutMs);
      });
      const res = await Promise.race([
        this.c.fetch(url, { method: init.method ?? "GET", headers: { "user-agent": USER_AGENT, accept: "application/json, text/html;q=0.9, */*;q=0.5", ...init.headers }, body: init.body, signal: ctrl.signal, redirect: "follow", cache: "no-store" }),
        timeout,
      ]);
      entry.status = res.status;
      entry.contentType = res.headers.get("content-type");
      const text = await Promise.race([res.text(), timeout]);
      entry.latencyMs = Date.now() - t0;
      if (res.status === 429) return fail(`rate limited (429)${res.headers.get("retry-after") ? `, retry after ${res.headers.get("retry-after")} s` : ""}`);
      if (res.status === 401 || res.status === 403) return fail(`refused (http ${res.status}): the site turned this request away; servers in the cloud are often blocked`);
      if (res.status === 404) return fail("not found (404)");
      if (res.status >= 400) return fail(`http ${res.status}`);
      if (text.length > this.c.maxBodyBytes) return fail(`reply too large (${text.length} characters); not read`);
      entry.ok = true;
      entry.body = init.keepBody === false ? null : text;
      if (init.keepBody === false) entry.error = "reply not kept: it is a credential";
      return { ok: true, body: text, index };
    } catch (err) {
      return fail(ctrl.signal.aborted ? `timed out after ${this.c.timeoutMs} ms` : err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }
  }

  /** Parse a reply; a parse failure is a gap, never a crash. */
  parse(got: Got & { ok: true }, target: string, fn: () => ParsedPost[]): ParsedPost[] {
    try {
      const posts = fn();
      this.answered++;
      this.read += posts.length;
      return posts.map((p) => ({ ...p, rawIndex: got.index }) as ParsedPost & { rawIndex: number });
    } catch (err) {
      const reason = err instanceof ParseError ? err.message : `could not read the reply: ${err instanceof Error ? err.message : String(err)}`;
      this.log[got.index].error = reason;
      this.gap(`${SOURCE_LABEL[this.id]} ${target}`, reason);
      return [];
    }
  }
}

type Located = ParsedPost & { rawIndex?: number };

export class SocialCollector {
  readonly config: SocialConfig;
  /** Every request, in a fixed source order, with the reply text as received. Never holds a key. */
  readonly log: SocialRawCall[] = [];
  private o: Required<Omit<SocialOptions, keyof SocialConfig>>;

  constructor(opts: SocialOptions = {}) {
    const base = socialConfigFromEnv();
    this.config = {
      sources: opts.sources ?? base.sources,
      telegramChannels: opts.telegramChannels ?? base.telegramChannels,
      subreddits: opts.subreddits ?? base.subreddits,
      bskyUrl: (opts.bskyUrl ?? base.bskyUrl).replace(/\/+$/, ""),
      reddit: opts.reddit === undefined ? base.reddit : opts.reddit,
      neynarKey: opts.neynarKey === undefined ? base.neynarKey : opts.neynarKey,
    };
    this.o = {
      fetch: opts.fetch ?? ((...a) => fetch(...a)),
      clock: opts.clock ?? systemClock,
      sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      timeoutMs: opts.timeoutMs ?? 8000,
      spacingMs: opts.spacingMs ?? 700,
      budgetMs: opts.budgetMs ?? 45_000,
      windowHours: opts.windowHours ?? 72,
      maxPosts: opts.maxPosts ?? 90,
      maxBodyBytes: opts.maxBodyBytes ?? 2_000_000,
    };
  }

  get enabled(): boolean {
    return this.config.sources.length > 0;
  }

  /** Collect posts about `symbols` from every enabled source. Always resolves. */
  async collect(symbols: string[]): Promise<SocialCollection> {
    const syms = [...new Set(symbols.map((s) => s.toUpperCase()))];
    const at = this.o.clock();
    const ctx = { ...this.o, deadline: Date.now() + this.o.budgetMs };
    const runs = new Map<SocialSourceId, SourceRun>();
    const found = new Map<SocialSourceId, Located[]>();
    const notes = new Map<SocialSourceId, string>();

    await Promise.all(
      this.config.sources.map(async (id) => {
        const r = new SourceRun(id, ctx);
        runs.set(id, r);
        const { posts, note } = await this.source(id, r, syms);
        found.set(id, posts);
        notes.set(id, note);
      }),
    );

    // merge logs in a fixed order so the same replies always give the same notebook
    const logFrom = this.log.length;
    const offset = new Map<SocialSourceId, number>();
    const gaps: Gap[] = [];
    for (const id of SOCIAL_SOURCES) {
      const r = runs.get(id);
      if (!r) continue;
      offset.set(id, this.log.length);
      this.log.push(...r.log);
      gaps.push(...r.gaps);
    }

    const now = Date.parse(at);
    const from = now - this.o.windowHours * 3_600_000;
    const seen = new Set<string>();
    let read = 0;
    let outsideWindow = 0;
    const posts: SocialPost[] = [];
    for (const id of SOCIAL_SOURCES) {
      for (const p of found.get(id) ?? []) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        read++;
        const symbolsHere = symbolsIn(p.text, syms);
        if (!symbolsHere.length) continue;
        const t = Date.parse(p.postedAt);
        if (t < from || t > now + 10 * 60_000) {
          outsideWindow++;
          continue;
        }
        posts.push(toSocialPost(id, p, symbolsHere, (offset.get(id) ?? 0) + (p.rawIndex ?? 0) - logFrom));
      }
    }
    posts.sort((a, b) => b.postedAt.localeCompare(a.postedAt) || a.id.localeCompare(b.id));
    // each coin keeps its newest posts, so chatter about one big coin cannot crowd out the others
    const perCoin = Math.max(5, Math.floor(this.o.maxPosts / Math.max(1, syms.length)));
    const keep = new Set<string>();
    for (const s of syms) posts.filter((p) => p.symbols.includes(s)).slice(0, perCoin).forEach((p) => keep.add(p.id));
    const kept = posts.filter((p) => keep.has(p.id)).slice(0, this.o.maxPosts);

    const sources: SourceStatus[] = SOCIAL_SOURCES.map((id) => {
      const r = runs.get(id);
      if (!r) return { id, label: SOURCE_LABEL[id], state: "off", asked: 0, answered: 0, read: 0, kept: 0, note: "Turned off (SOCIAL_SOURCES)." };
      const k = kept.filter((p) => p.network === id).length;
      const state: SourceStatus["state"] = r.answered === 0 ? "gap" : r.answered < r.asked ? "partial" : "answered";
      return { id, label: SOURCE_LABEL[id], state, asked: r.asked, answered: r.answered, read: r.read, kept: k, note: notes.get(id) ?? "" };
    });
    return { at, windowHours: this.o.windowHours, sources, posts: kept, read, outsideWindow, gaps, logFrom, logTo: this.log.length };
  }

  private async source(id: SocialSourceId, r: SourceRun, syms: string[]): Promise<{ posts: Located[]; note: string }> {
    const posts: Located[] = [];
    if (id === "telegram") {
      const asked = this.config.telegramChannels.slice(0, MAX_CHANNELS);
      if (this.config.telegramChannels.length > MAX_CHANNELS) r.gap("Telegram channels", `only the first ${MAX_CHANNELS} of ${this.config.telegramChannels.length} configured channels were read`);
      for (const ch of asked) {
        if (!isChannelName(ch)) {
          r.gap(`Telegram @${ch}`, "not a valid public channel name; not asked");
          continue;
        }
        const got = await r.get(`@${ch}`, `https://t.me/s/${ch}`, { headers: { accept: "text/html" } });
        if (got.ok) posts.push(...r.parse(got, `@${ch}`, () => parseTelegram(got.body, ch).posts));
      }
      return { posts, note: `Read the public web preview of ${r.answered} of ${asked.length} channel${asked.length === 1 ? "" : "s"} (${asked.map((c) => `@${c}`).join(", ")}). A preview shows each channel's latest posts only.` };
    }
    if (id === "bluesky") {
      const asked = syms.slice(0, MAX_SEARCH_SYMBOLS);
      if (syms.length > MAX_SEARCH_SYMBOLS) r.gap("Bluesky search", `only the first ${MAX_SEARCH_SYMBOLS} coins were searched`);
      for (const s of asked) {
        const got = await r.get(`#${s}`, `${this.config.bskyUrl}/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(`#${s}`)}&sort=latest&limit=25`);
        if (got.ok) posts.push(...r.parse(got, `#${s}`, () => parseBluesky(got.body)));
      }
      return { posts, note: `Searched the newest posts tagged ${asked.map((s) => `#${s}`).join(", ")} through Bluesky's public API (25 per coin).` };
    }
    if (id === "reddit") {
      if (!this.config.reddit) {
        const reason = "not asked: Reddit's robots.txt disallows automated access and its public .json pages answered 403 when tested. Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET (a free Reddit app) to read it through Reddit's official API.";
        r.gap("Reddit posts", reason);
        return { posts, note: "Not asked: needs Reddit API credentials (free). Reddit does not allow reading its pages automatically without them." };
      }
      const subs = this.config.subreddits.filter((s) => /^[A-Za-z0-9_]{2,21}$/.test(s)).slice(0, MAX_SUBREDDITS);
      const basic = typeof btoa === "function" ? btoa(`${this.config.reddit.clientId}:${this.config.reddit.clientSecret}`) : Buffer.from(`${this.config.reddit.clientId}:${this.config.reddit.clientSecret}`).toString("base64");
      const tok = await r.get("access token", "https://www.reddit.com/api/v1/access_token", { method: "POST", body: "grant_type=client_credentials", headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" }, keepBody: false });
      let token: string | null = null;
      if (tok.ok)
        try {
          token = (JSON.parse(tok.body) as { access_token?: string }).access_token ?? null;
        } catch {
          /* handled below */
        }
      if (!token) {
        if (tok.ok) r.gap("Reddit access token", "Reddit's token reply had no access token");
        return { posts, note: "Reddit did not issue an API token, so no subreddit was read." };
      }
      for (const sub of subs) {
        const got = await r.get(`r/${sub}`, `https://oauth.reddit.com/r/${sub}/new?limit=50&raw_json=1`, { headers: { authorization: `Bearer ${token}` } });
        if (got.ok) posts.push(...r.parse(got, `r/${sub}`, () => parseReddit(got.body)));
      }
      r.asked--; // the token request is not a source of posts
      r.answered = Math.min(r.answered, r.asked);
      return { posts, note: `Read the newest posts of ${subs.map((s) => `r/${s}`).join(", ")} through Reddit's official API.` };
    }
    // farcaster
    if (!this.config.neynarKey) {
      r.gap("Farcaster casts", "not asked: Farcaster's keyless endpoints disallow automated access (robots.txt) and public hubs ask for a key or a payment. Set NEYNAR_API_KEY to search casts.");
      return { posts, note: "Not asked: needs a Neynar API key. Farcaster's free endpoints do not allow automated reading." };
    }
    const asked = syms.slice(0, MAX_SEARCH_SYMBOLS);
    for (const s of asked) {
      const got = await r.get(`$${s}`, `https://api.neynar.com/v2/farcaster/cast/search?q=${encodeURIComponent(`$${s}`)}&limit=25`, { headers: { "x-api-key": this.config.neynarKey, accept: "application/json" } });
      if (got.ok) posts.push(...r.parse(got, `$${s}`, () => parseFarcaster(got.body)));
    }
    return { posts, note: `Searched casts mentioning ${asked.map((s) => `$${s}`).join(", ")} through Neynar.` };
  }
}

function toSocialPost(id: SocialSourceId, p: ParsedPost, symbols: string[], rawIndex: number): SocialPost {
  const signals = readSignals(p.text, p.forwardedFrom);
  const handle = id === "reddit" ? `u/${p.account}` : `@${p.account}`;
  return {
    id: p.id,
    promoter: `${handle} (${SOURCE_LABEL[id]})`,
    handle,
    platform: id === "telegram" ? "telegram" : "other",
    ...(p.followers != null ? { followers: p.followers } : {}),
    postedAt: p.postedAt,
    datePrecision: "datetime",
    text: p.text.length > 2000 ? `${p.text.slice(0, 2000)}…` : p.text,
    disclosedPayment: signals.disclosure.said, // what the text says; nobody has documented a payment
    sources: [{ label: `${SOURCE_LABEL[id]} post by ${handle}${p.displayName ? ` (${p.displayName})` : ""}`, url: p.url }],
    network: id,
    url: p.url,
    symbols,
    views: p.views,
    signals,
    rawIndex,
  };
}

/** A post is a live social post (as opposed to one quoted from a case file). */
export const isSocialPost = (p: object): p is SocialPost => "network" in p && "signals" in p;
