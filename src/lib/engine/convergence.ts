// Multi-KOL convergence: several promoters pushing the same token inside a short window.
// For traders it is a momentum signal; for Canary it is the shape of a paid campaign.
// Echo detection: promoters paid by the same payer/agency, or posting copy-pasted text,
// count as ONE voice, because they are not independent of each other.

import type { PromoterPost } from "../types";
import type { ConvergenceEvent, ConvergenceResult, EchoLink } from "./types";

export type ConvergenceOptions = {
  minPromoters?: number; // distinct promoters needed (default 3)
  windowHours?: number; // default 72
  copyThreshold?: number; // word-trigram Jaccard similarity that counts as copy-paste (default 0.6)
  /** Which token a post is about. A string = every post is about that token. Default: $CASHTAGS in the text. */
  tokenOf?: string | ((p: PromoterPost) => string[] | string | null);
  defaultToken?: string; // used when a post has no cashtag
};

const HOUR = 3_600_000;

/** Earliest and latest instant a post could have been made, given its date precision. */
export function postInterval(p: PromoterPost): [number, number] {
  const s = p.postedAt;
  if (p.datePrecision === "month") {
    const [y, m] = s.slice(0, 7).split("-").map(Number);
    return [Date.UTC(y, m - 1, 1), Date.UTC(y, m, 1) - 1];
  }
  if (p.datePrecision === "day") {
    const d = Date.parse(`${s.slice(0, 10)}T00:00:00Z`);
    return [d, d + 24 * HOUR - 1];
  }
  const t = Date.parse(s);
  return [t, t];
}

const cashtags = (text = "") => [...new Set([...text.matchAll(/\$([A-Za-z][A-Za-z0-9]{1,11})\b/g)].map((m) => m[1].toUpperCase()))];

function tokensFor(p: PromoterPost, opts: ConvergenceOptions): string[] {
  const t = opts.tokenOf;
  if (typeof t === "string") return [t.toUpperCase()];
  if (typeof t === "function") {
    const r = t(p);
    return r == null ? [] : (Array.isArray(r) ? r : [r]).map((x) => x.toUpperCase());
  }
  const tags = cashtags(p.text);
  return tags.length ? tags : opts.defaultToken ? [opts.defaultToken.toUpperCase()] : [];
}

/** Lower-case words with links, @handles, #tags and punctuation removed. */
export const normalizeText = (s = "") =>
  s
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[@#]\w+/g, " ")
    .replace(/[^\p{L}\p{N}$ ]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Jaccard similarity of word trigrams (single words for very short texts). 1 = identical. */
export function textSimilarity(a?: string, b?: string): number {
  const wa = normalizeText(a);
  const wb = normalizeText(b);
  if (!wa.length || !wb.length) return 0;
  const n = Math.min(wa.length, wb.length) < 6 ? 1 : 3;
  const grams = (w: string[]) => new Set(w.slice(0, w.length - n + 1).map((_, i) => w.slice(i, i + n).join(" ")));
  const ga = grams(wa);
  const gb = grams(wb);
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return inter / (ga.size + gb.size - inter);
}

const payerKey = (p: PromoterPost) => p.paid?.by?.trim().toLowerCase() || null;

/** Group promoters that are not independent (shared payer or copied text). */
function echoGroups(posts: PromoterPost[], copyThreshold: number) {
  const promoters = [...new Set(posts.map((p) => p.promoter))];
  const parent = new Map(promoters.map((p) => [p, p]));
  const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!));
  const union = (a: string, b: string) => parent.set(find(a), find(b));
  const links: EchoLink[] = [];
  for (let i = 0; i < posts.length; i++)
    for (let j = i + 1; j < posts.length; j++) {
      const a = posts[i];
      const b = posts[j];
      if (a.promoter === b.promoter) continue;
      if (payerKey(a) && payerKey(a) === payerKey(b)) {
        links.push({ a: a.id, b: b.id, reason: "same-payer", detail: `${a.promoter} and ${b.promoter} were both paid by ${a.paid!.by}` });
        union(a.promoter, b.promoter);
      }
      const sim = textSimilarity(a.text, b.text);
      if (sim >= copyThreshold) {
        links.push({ a: a.id, b: b.id, reason: "copy-paste", detail: `${a.promoter} and ${b.promoter} posted ${Math.round(sim * 100)}% the same words` });
        union(a.promoter, b.promoter);
      }
    }
  const groups = new Map<string, string[]>();
  for (const p of promoters) groups.set(find(p), [...(groups.get(find(p)) ?? []), p]);
  return { links, groups: [...groups.values()].map((g) => g.sort()).sort((x, y) => x[0].localeCompare(y[0])) };
}

function buildEvent(token: string, posts: PromoterPost[], o: Required<Pick<ConvergenceOptions, "minPromoters" | "windowHours" | "copyThreshold">>): ConvergenceEvent {
  const iv = posts.map(postInterval);
  const start = Math.min(...iv.map((x) => x[0]));
  const end = Math.max(...iv.map((x) => x[1]));
  const promoters = [...new Set(posts.map((p) => p.promoter))].sort();
  const { links, groups } = echoGroups(posts, o.copyThreshold);
  const coordinated = promoters.length >= o.minPromoters && groups.length < o.minPromoters;
  const disclosed = posts.filter((p) => p.disclosedPayment === true).map((p) => p.id);
  const undisclosed = posts.filter((p) => p.disclosedPayment === false).map((p) => p.id);
  const unknown = posts.filter((p) => p.disclosedPayment == null).map((p) => p.id);
  const paidButUndisclosed = posts.filter((p) => p.paid && p.disclosedPayment === false).map((p) => p.id);
  const monthly = posts.filter((p) => p.datePrecision === "month").map((p) => p.id);

  const reasoning = [
    `${promoters.length} different promoter${promoters.length === 1 ? "" : "s"} posted about ${token} within ${spanText(o.windowHours)} (${promoters.join(", ")}).`,
    links.length
      ? `They are not all independent: ${[...new Set(links.map((l) => l.detail))].join("; ")}. That leaves ${groups.length} independent voice${groups.length === 1 ? "" : "s"}.`
      : `No shared payer or copied text was found, so each promoter counts as an independent voice.`,
    coordinated
      ? `Many accounts but few independent voices: this looks organised, not organic.`
      : promoters.length >= o.minPromoters
        ? `At least ${o.minPromoters} independent voices converged on the same token.`
        : `Fewer than ${o.minPromoters} promoters, so this is not a convergence.`,
    paidButUndisclosed.length
      ? `${paidButUndisclosed.length} post${paidButUndisclosed.length === 1 ? " was" : "s were"} documented as paid but did not disclose it. US law (Securities Act §17(b)) requires a promoter of a security to disclose the payment, who paid, and how much.`
      : undisclosed.length
        ? `${undisclosed.length} post${undisclosed.length === 1 ? "" : "s"} did not say they were paid; no payment is documented for them.`
        : `No post is documented as paid-but-undisclosed.`,
  ];
  return {
    token,
    windowStart: new Date(start).toISOString(),
    windowEnd: new Date(end).toISOString(),
    windowHours: o.windowHours,
    postIds: posts.map((p) => p.id),
    promoters,
    independentGroups: groups,
    independentVoices: groups.length,
    echoLinks: links,
    coordinated,
    disclosure: { disclosed, undisclosed, unknown, paidButUndisclosed },
    ...(monthly.length ? { precisionNote: `Posts ${monthly.join(", ")} are only dated to the month, so they are counted if they could have fallen inside the window.` } : {}),
    reasoning,
  };
}

/** Find every window in which >= minPromoters distinct promoters pushed the same token. */
export function detectConvergence(posts: PromoterPost[], opts: ConvergenceOptions = {}): ConvergenceResult {
  const o = { minPromoters: opts.minPromoters ?? 3, windowHours: opts.windowHours ?? 72, copyThreshold: opts.copyThreshold ?? 0.6 };
  const windowMs = o.windowHours * HOUR;
  const byToken = new Map<string, PromoterPost[]>();
  const skipped: ConvergenceResult["skipped"] = [];
  for (const p of posts) {
    const toks = tokensFor(p, opts);
    if (!toks.length) skipped.push({ postId: p.id, reason: "no token could be attributed to this post" });
    for (const t of toks) byToken.set(t, [...(byToken.get(t) ?? []), p]);
  }

  const events: ConvergenceEvent[] = [];
  let best: ConvergenceEvent | null = null;
  for (const token of [...byToken.keys()].sort()) {
    const list = [...byToken.get(token)!].sort((a, b) => postInterval(a)[0] - postInterval(b)[0] || a.id.localeCompare(b.id));
    const kept: PromoterPost[][] = [];
    for (let i = 0; i < list.length; i++) {
      // grow a cluster from post i while its smallest possible time span stays inside the window
      const cluster = [list[i]];
      let minLatest = postInterval(list[i])[1];
      for (let j = i + 1; j < list.length; j++) {
        const [e, l] = postInterval(list[j]);
        if (e - Math.min(minLatest, l) > windowMs) break;
        cluster.push(list[j]);
        minLatest = Math.min(minLatest, l);
      }
      if (kept.some((k) => cluster.every((p) => k.some((q) => q.id === p.id)))) continue; // subset of an earlier cluster
      kept.push(cluster);
      const ev = buildEvent(token, cluster, o);
      if (!best || ev.promoters.length > best.promoters.length) best = ev;
      if (ev.promoters.length >= o.minPromoters) events.push(ev);
    }
  }
  return { params: o, events, bestCluster: best, detected: events.length > 0, skipped };
}

/** "72 hours" stays hours; whole days read better past two days ("14 days"). */
export function spanText(hours: number) {
  return hours > 48 && hours % 24 === 0 ? `${hours / 24} days` : `${hours} hours`;
}
