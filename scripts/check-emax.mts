/**
 * Checks data/cases/emax.json against the CaseFile type (compile time) and basic invariants (run time).
 *
 *   npx tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler --resolveJsonModule --skipLibCheck --types node scripts/check-emax.mts
 *   npx tsx scripts/check-emax.mts
 */
import { readFileSync } from "node:fs";
import type { CaseFile } from "../src/lib/types";
import raw from "../data/cases/emax.json" with { type: "json" };

// Compile-time: the JSON must be assignable to CaseFile (literal unions are widened by
// resolveJsonModule, so string-literal fields are checked at run time below instead).
type Widen<T> = T extends string ? string : T extends (infer U)[] ? Widen<U>[] : T extends object ? { [K in keyof T]: Widen<T[K]> } : T;
const _shape: Widen<CaseFile> = raw;
void _shape;

const c = JSON.parse(readFileSync(new URL("../data/cases/emax.json", import.meta.url), "utf8")) as CaseFile;
const errors: string[] = [];
const need = (ok: unknown, msg: string) => void (!ok && errors.push(msg));
const isDate = (s: string) => /^\d{4}-\d{2}(-\d{2}(T[\d:.]+Z)?)?$/.test(s);
const isAddr = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);
const isTx = (s: string) => /^0x[0-9a-f]{64}$/.test(s);

need(c.slug === "emax", "slug");
need(c.token.chain === "ethereum" && isAddr(c.token.address) && Number.isInteger(c.token.decimals), "token");
need(!c.token.pair || isAddr(c.token.pair), "token.pair");
need(c.oneLiner.length > 20, "oneLiner");
for (const k of ["pumpStart", "peak", "collapse"] as const) need(isDate(c.window[k]), `window.${k}`);
need(c.window.pumpStart <= c.window.peak && c.window.peak <= c.window.collapse, "window order");
const platforms = ["instagram", "x", "telegram", "youtube", "tiktok", "other"];
for (const p of c.posts) {
  need(p.id && p.promoter && platforms.includes(p.platform), `post ${p.id} fields`);
  need(isDate(p.postedAt) && ["day", "month", "datetime"].includes(p.datePrecision), `post ${p.id} date`);
  need(p.disclosedPayment === null || typeof p.disclosedPayment === "boolean", `post ${p.id} disclosedPayment`);
  need(p.sources.length > 0 && p.sources.every((s) => s.label && s.url), `post ${p.id} sources`);
}
need(new Set(c.posts.map((p) => p.id)).size === c.posts.length, "unique post ids");
need(c.prices.length > 30, "prices length");
for (let i = 0; i < c.prices.length; i++) {
  const p = c.prices[i];
  need(isDate(p.t), `price ${i} t`);
  need(p.priceUsd === null || (typeof p.priceUsd === "number" && p.priceUsd > 0), `price ${i} priceUsd`);
  need(p.liquidityUsd === null || (typeof p.liquidityUsd === "number" && p.liquidityUsd >= 0), `price ${i} liquidityUsd`);
  if (i) need(p.t > c.prices[i - 1].t, `price ${i} order`);
}
const at = (t: string) => c.prices.find((p) => p.t === t);
need(at(c.peak.t)?.priceUsd === c.peak.priceUsd, "peak matches series");
need(at(c.collapse.t)?.priceUsd === c.collapse.priceUsd, "collapse matches series");
need(Math.abs(c.collapse.dropPct - (1 - c.collapse.priceUsd / c.peak.priceUsd) * 100) < 0.05, "dropPct consistent");
need(c.prices.every((p) => p.priceUsd === null || p.priceUsd <= c.peak.priceUsd), "peak is the max");
if (c.buyersInWindow) {
  need(c.buyersInWindow.count >= c.buyersInWindow.sample.length && c.buyersInWindow.sample.length <= 12, "buyers sample size");
  for (const s of c.buyersInWindow.sample) need(isAddr(s.address) && isTx(s.txHash) && isDate(s.firstBuy), `buyer ${s.address}`);
}
if (c.holders) need(c.holders.top10Pct > 0 && c.holders.top10Pct <= 100 && isDate(c.holders.asOf), "holders");
const kinds = ["sec", "class-action", "ftc", "doj", "state", "other"];
for (const l of c.legal) need(kinds.includes(l.kind) && isDate(l.date) && l.sources.length > 0, `legal ${l.id}`);
need(c.dataNotes.length > 0 && c.sources.length > 0, "notes/sources");

if (errors.length) {
  console.error("emax.json FAILED:\n - " + errors.join("\n - "));
  process.exitCode = 1;
} else {
  console.log(`emax.json OK: ${c.posts.length} posts, ${c.prices.length} daily prices, ${c.legal.length} legal actions, peak ${c.peak.t} $${c.peak.priceUsd}, collapse ${c.collapse.t} (-${c.collapse.dropPct}%)`);
}
