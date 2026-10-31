// Turns a collection plus the convergence agent's result into what the page and the notebook show:
// per coin, how many accounts posted about it in the last 24 and 72 hours, how many in promotion-style
// words, how many said they were paid, and whether the promoters converge or echo one another.
import { sha256Hex } from "../canonical";
import type { ConvergenceResult, EvidenceItem } from "../engine/types";
import type { SocialCollection } from "./collect";
import { disclosureText } from "./signals";
import type { SocialPost, SocialRawCall, SocialRawDigest, SocialSummary, SocialSymbolView } from "./types";

const HOUR = 3_600_000;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const distinct = (ps: SocialPost[]) => new Set(ps.map((p) => p.promoter)).size;

/** SHA-256 of a raw reply body exactly as received (no canonicalisation: it is text, not JSON we rebuilt). */
export const socialDigest = async (body: string | null) => (body == null ? null : sha256Hex(body));

export async function socialDigests(log: SocialRawCall[]): Promise<SocialRawDigest[]> {
  return Promise.all(log.map(async (c) => ({ source: c.source, target: c.target, url: c.url, ok: c.ok, status: c.status, fetchedAt: c.fetchedAt, bytes: c.body == null ? null : c.body.length, digest: await socialDigest(c.body) })));
}

/** Only posts in promotion-style words (or that say they are ads) count as "pushing" a coin. */
export const promotionalPosts = (posts: SocialPost[]) => posts.filter((p) => p.signals.promotional);

export function symbolView(symbol: string, posts: SocialPost[], convergence: ConvergenceResult | null, at: string, minPromoters = 3, windowHours = 72): SocialSymbolView {
  const now = Date.parse(at);
  const mine = posts.filter((p) => p.symbols.includes(symbol));
  const day = mine.filter((p) => Date.parse(p.postedAt) >= now - 24 * HOUR);
  const promo = promotionalPosts(mine);
  const disclosed = mine.filter((p) => p.signals.disclosure.said);
  const complete = disclosed.filter((p) => p.signals.disclosure.complete);
  const payerOnly = disclosed.filter((p) => p.signals.disclosure.payer && !p.signals.disclosure.amount).length;
  const contracts = [...new Set(mine.flatMap((p) => p.signals.contracts.map((c) => c.address)))].slice(0, 6);
  const events = (convergence?.events ?? []).filter((e) => e.token === symbol && e.postIds.some((id) => mine.some((p) => p.id === id)));
  const ev = events.sort((a, b) => b.promoters.length - a.promoters.length)[0] ?? null;
  const conv = ev
    ? { promoters: ev.promoters.length, independentVoices: ev.independentVoices, echoGroups: ev.independentGroups.filter((g) => g.length > 1), echoes: [...new Set(ev.echoLinks.map((l) => l.detail))], coordinated: ev.coordinated, detected: true }
    : null;

  const promoAccounts = distinct(promo);
  const parts: string[] = [];
  if (!mine.length) parts.push(`${symbol}: no post about it in the last ${windowHours} hours from the sources that answered.`);
  else {
    parts.push(`${symbol}: ${plural(distinct(mine), "account")} posted about it in the last ${windowHours} hours (${distinct(day)} in the last 24); ${promoAccounts} of them in promotion-style words.`);
    if (conv)
      parts.push(
        conv.echoes.length
          ? `${conv.promoters} promoters converge, but ${conv.echoes.join("; ")}, so they count as ${plural(conv.independentVoices, "independent voice")}${conv.coordinated ? ": that looks organised, not organic" : ""}.`
          : `${conv.promoters} promoters converge, each an independent voice.`,
      );
    else if (promoAccounts) parts.push(`Fewer than ${minPromoters} promoters, so no convergence.`);
    parts.push(
      disclosed.length
        ? `${plural(disclosed.length, "post")} said ${disclosed.length === 1 ? "it was" : "they were"} paid; ${complete.length ? `${complete.length} named who paid and how much` : `none named both who paid and how much, which Securities Act §17(b) requires${payerOnly ? ` (${payerOnly} named the payer only)` : ""}`}.`
        : "No post said it was paid. That is not proof anyone was paid.",
    );
  }
  return {
    symbol,
    h24: { posts: day.length, accounts: distinct(day), promotional: promotionalPosts(day).length },
    h72: { posts: mine.length, accounts: distinct(mine), promotional: promo.length, promotionalAccounts: promoAccounts, disclosed: disclosed.length, disclosedComplete: complete.length, contracts },
    convergence: conv,
    summary: parts.join(" "),
  };
}

export function socialSummary(col: SocialCollection, convergence: ConvergenceResult | null, symbols: string[], raw: SocialRawDigest[], minPromoters = 3): SocialSummary {
  return {
    at: col.at,
    windowHours: col.windowHours,
    sources: col.sources,
    posts: col.posts,
    read: col.read,
    outsideWindow: col.outsideWindow,
    perSymbol: symbols.map((s) => symbolView(s, col.posts, convergence, col.at, minPromoters, col.windowHours)),
    raw,
    gaps: col.gaps,
  };
}

/** One citable evidence line per live post. */
export function socialEvidence(p: SocialPost): EvidenceItem {
  const s = p.signals;
  const quote = p.text.length > 280 ? `${p.text.slice(0, 280)}…` : p.text;
  return {
    id: p.id,
    kind: "post",
    text: `${p.promoter}${p.followers ? `, ${p.followers.toLocaleString("en-US")} followers` : ""}, ${p.postedAt.slice(0, 16).replace("T", " ")} UTC: "${quote}" (${p.url}). ${disclosureText(s)}. ${s.shill.length ? `Promotion-style words: ${s.shill.join(", ")}.` : "No promotion-style words."}${s.contracts.length ? ` Contracts named: ${s.contracts.map((c) => c.address).join(", ")}.` : ""}${s.forwardedFrom ? ` Forwarded from ${s.forwardedFrom}.` : ""}`,
    data: { promoter: p.promoter, postedAt: p.postedAt, url: p.url, network: p.network, disclosedPayment: p.disclosedPayment, signals: s },
  };
}
