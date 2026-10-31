// Parsers for each free source's raw reply. Pure functions: raw text in, plain posts out.
// A reply that is not what we expect throws ParseError, which the collector turns into a Gap.
// No DOM, no dependencies: Telegram's public preview is read with small, documented regexes.

export class ParseError extends Error {}

/** A post as read from a source, before signals and coin matching. */
export type ParsedPost = {
  id: string; // "tg:channel/123", "bsky:did/rkey", ...
  account: string; // stable handle, no "@"
  displayName: string | null;
  postedAt: string; // ISO
  text: string;
  url: string;
  views: number | null;
  followers: number | null;
  forwardedFrom: string | null;
};

// ---------- html helpers ----------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** HTML fragment → plain text: <br> to newlines, tags dropped (their inner text kept), entities decoded. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|blockquote)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** "1.2K" → 1200, "3.4M" → 3400000, "987" → 987. */
export function parseCount(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.trim().replace(/,/g, "").match(/^(\d+(?:\.\d+)?)\s*([KMB])?$/i);
  if (!m) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? "").toUpperCase() as "K" | "M" | "B"] ?? 1;
  return Math.round(Number(m[1]) * mult);
}

const iso = (s: string | number | null | undefined): string | null => {
  if (s == null || s === "") return null;
  const t = typeof s === "number" ? s : Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

// ---------- Telegram: https://t.me/s/<channel> (public channel web preview) ----------

const CHANNEL_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;
export const isChannelName = (s: string) => CHANNEL_RE.test(s);

export type TelegramPage = { channel: string; title: string | null; subscribers: number | null; posts: ParsedPost[] };

export function parseTelegram(html: string, channel: string): TelegramPage {
  if (!/tgme_channel_history|tgme_widget_message_wrap/.test(html)) {
    throw new ParseError(/tgme_page_extra|tgme_action_button|Contact @/.test(html) ? "no public web preview (private, renamed, or not a channel)" : "the page is not a Telegram channel preview");
  }
  const title = decodeEntities(html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] ?? "") || null;
  const counter = [...html.matchAll(/<span class="counter_value">([^<]+)<\/span>\s*<span class="counter_type">([^<]+)<\/span>/g)].find((m) => /subscriber|member/i.test(m[2]));
  const subscribers = parseCount(counter?.[1]);
  const posts: ParsedPost[] = [];
  const chunks = html.split(/<div class="tgme_widget_message_wrap[^"]*"[^>]*>/).slice(1);
  for (const c of chunks) {
    const dataPost = c.match(/data-post="([A-Za-z0-9_]+)\/(\d+)"/);
    if (!dataPost) continue;
    const [, chan, num] = dataPost;
    const at = iso(c.match(/<time datetime="([^"]+)"/)?.[1]);
    if (!at) continue;
    // the post's own text; a quoted reply's text has class js-message_reply_text and is skipped
    const textHtml = c.match(/<div class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    const caption = textHtml ? "" : (c.match(/<div class="tgme_widget_message_document_title[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "");
    const text = htmlToText(textHtml || caption);
    // "Forwarded from <a href=https://t.me/x>Name</a>" (or a plain <span> when the origin is hidden): prefer the handle
    const fwdTag = c.match(/<(?:a|span) class="tgme_widget_message_forwarded_from_name"([^>]*)>([\s\S]*?)<\/(?:a|span)>/);
    const fwdHandle = fwdTag?.[1].match(/href="https:\/\/t\.me\/([A-Za-z0-9_]+)/)?.[1];
    const fwd = fwdHandle ? `@${fwdHandle}` : fwdTag?.[2];
    posts.push({
      id: `tg:${chan.toLowerCase()}/${num}`,
      account: chan,
      displayName: title,
      postedAt: at,
      text,
      url: `https://t.me/${chan}/${num}`,
      views: parseCount(c.match(/<span class="tgme_widget_message_views">([^<]+)<\/span>/)?.[1]),
      followers: subscribers,
      forwardedFrom: fwd ? htmlToText(fwd) || null : null,
    });
  }
  return { channel, title, subscribers, posts };
}

// ---------- Bluesky: app.bsky.feed.searchPosts on the public AppView ----------

type BskyPost = { uri?: string; author?: { did?: string; handle?: string; displayName?: string }; record?: { text?: string; createdAt?: string }; indexedAt?: string };

export function parseBluesky(body: string): ParsedPost[] {
  let j: { posts?: BskyPost[] };
  try {
    j = JSON.parse(body);
  } catch {
    throw new ParseError("reply was not JSON");
  }
  if (!j || !Array.isArray(j.posts)) throw new ParseError("reply has no posts list");
  const out: ParsedPost[] = [];
  for (const p of j.posts) {
    const m = p.uri?.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/);
    const handle = p.author?.handle;
    // indexedAt = when Bluesky saw it; createdAt is whatever the author's app claimed
    const at = iso(p.indexedAt) ?? iso(p.record?.createdAt);
    if (!m || !handle || !at) continue;
    out.push({ id: `bsky:${m[1]}/${m[2]}`, account: handle, displayName: p.author?.displayName?.trim() || null, postedAt: at, text: p.record?.text ?? "", url: `https://bsky.app/profile/${handle}/post/${m[2]}`, views: null, followers: null, forwardedFrom: null });
  }
  return out;
}

// ---------- Reddit: official API listing (oauth.reddit.com/r/<sub>/new) ----------

type RedditChild = { kind?: string; data?: { id?: string; author?: string; title?: string; selftext?: string; created_utc?: number; permalink?: string; subreddit?: string; promoted?: boolean } };

export function parseReddit(body: string): ParsedPost[] {
  let j: { data?: { children?: RedditChild[] } };
  try {
    j = JSON.parse(body);
  } catch {
    throw new ParseError("reply was not JSON");
  }
  const children = j?.data?.children;
  if (!Array.isArray(children)) throw new ParseError("reply is not a Reddit listing");
  const out: ParsedPost[] = [];
  for (const c of children) {
    const d = c.data;
    const at = d?.created_utc ? iso(d.created_utc * 1000) : null;
    if (!d?.id || !d.author || d.author === "[deleted]" || !at || !d.permalink) continue;
    out.push({ id: `reddit:${d.id}`, account: d.author, displayName: null, postedAt: at, text: [d.title, d.selftext].filter(Boolean).join("\n").slice(0, 4000), url: `https://www.reddit.com${d.permalink}`, views: null, followers: null, forwardedFrom: null });
  }
  return out;
}

// ---------- Farcaster: Neynar cast search (needs NEYNAR_API_KEY) ----------

type NeynarCast = { hash?: string; text?: string; timestamp?: string; author?: { username?: string; display_name?: string; follower_count?: number } };

export function parseFarcaster(body: string): ParsedPost[] {
  let j: { result?: { casts?: NeynarCast[] } };
  try {
    j = JSON.parse(body);
  } catch {
    throw new ParseError("reply was not JSON");
  }
  const casts = j?.result?.casts;
  if (!Array.isArray(casts)) throw new ParseError("reply has no casts list");
  const out: ParsedPost[] = [];
  for (const c of casts) {
    const at = iso(c.timestamp);
    const user = c.author?.username;
    if (!c.hash || !user || !at) continue;
    out.push({ id: `fc:${c.hash}`, account: user, displayName: c.author?.display_name?.trim() || null, postedAt: at, text: c.text ?? "", url: `https://farcaster.xyz/${user}/${c.hash.slice(0, 10)}`, views: null, followers: typeof c.author?.follower_count === "number" ? c.author.follower_count : null, forwardedFrom: null });
  }
  return out;
}
