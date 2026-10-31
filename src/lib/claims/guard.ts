// Fact guard: every checkable fact in a document (dates, money, addresses and transaction hashes, links,
// docket numbers, statute sections, phone helplines) must come from the inputs. Anything else is reported.
// Used by the tests on every generated document, and available to any LLM-written text later.

import { longDate, monthYear, usdCents, usdWhole, utcTime } from "./format";

const MONTH = "(?:January|February|March|April|May|June|July|August|September|October|November|December)";

export const FACT_PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "hex", re: /0x[0-9a-fA-F]{40,64}\b/g },
  { kind: "sha256", re: /\b[0-9a-f]{64}\b/g },
  { kind: "url", re: /https?:\/\/[^\s"')<>]+[^\s"')<>.,;:]/g },
  { kind: "money", re: /[$£€₹]\s?\d+(?:,\d{3})*(?:\.\d+)?(?:\s(?:million|billion))?/g },
  { kind: "date", re: new RegExp(`\\b${MONTH} \\d{1,2}, \\d{4}\\b`, "g") },
  { kind: "month", re: new RegExp(`\\b${MONTH} \\d{4}\\b`, "g") },
  { kind: "iso-date", re: /\b20\d\d-\d\d-\d\d\b/g },
  { kind: "docket", re: /\b\d:\d\d-cv-\d+\b/g },
  { kind: "statute", re: /\bSections? \d+\([a-z]\)(?:\(\d\))?/g },
  // law outside the US (src/lib/claims/law.ts): articles, sections, instruments and rule numbers
  { kind: "provision", re: /\bArticles? \d+(?:\(\d+\))?(?:\([a-z]\))?/g },
  { kind: "provision", re: /\b[Ss]ections? \d+(?:\(\d+\))?(?![(\d])/g },
  { kind: "provision", re: /\b(?:Regulation \(EU\)|Directive) \d{4}\/\d+(?:\/EC)?/g },
  { kind: "provision", re: /\bSI \d{4}\/\d+/g },
  { kind: "provision", re: /\bS\.O\. \d+\(E\)/g },
  { kind: "provision", re: /\b(?:FG|PS)\d{2}\/\d+\b/g },
  { kind: "provision", re: /\bCOBS \d+\.\d+[A-Z]?(?:\.\d+[RG])?/g },
  { kind: "phone", re: /\b(0\d{3} \d{3} \d{4})\b/g },
  { kind: "phone", re: /\b(?:call(?:ing)?|helpline|on) (\d{3,4})\b/g },
];

export function extractFacts(text: string): { kind: string; value: string }[] {
  const out: { kind: string; value: string }[] = [];
  for (const { kind, re } of FACT_PATTERNS) for (const m of text.matchAll(re)) out.push({ kind, value: (m[1] ?? m[0]).trim() });
  return out;
}

/** Every fact the inputs support, in every form the documents may print it. */
export function allowedFacts(inputs: unknown[], extras: string[] = []): Set<string> {
  const ok = new Set<string>(extras);
  const addString = (s: string) => {
    ok.add(s);
    for (const f of extractFacts(s)) ok.add(f.value);
    const iso = /^(\d{4}-\d{2}-\d{2})(T\d{2}:\d{2}(:\d{2})?(\.\d+)?Z)?$/.exec(s);
    if (iso) {
      ok.add(longDate(s));
      ok.add(monthYear(s));
      ok.add(iso[1]);
      if (iso[2]) ok.add(utcTime(s));
    }
    if (/^\d{4}-\d{2}$/.test(s)) ok.add(monthYear(s));
    // a hex string inside a URL or sentence is allowed too
    for (const m of s.matchAll(/0x[0-9a-fA-F]{40,64}/g)) ok.add(m[0]);
  };
  const addNumber = (n: number) => {
    ok.add(String(n));
    ok.add(usdCents(n));
    ok.add(usdWhole(n));
    ok.add(`$${n.toLocaleString("en-US")}`);
    for (const sym of ["£", "€", "₹"]) ok.add(`${sym}${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
    ok.add(`$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
  };
  const walk = (v: unknown) => {
    if (typeof v === "string") addString(v);
    else if (typeof v === "number") addNumber(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  inputs.forEach(walk);
  return ok;
}

export type GuardResult = { ok: boolean; unknown: { kind: string; value: string }[] };

/** Bracketed placeholders like "[your name]" are instructions, not facts, and are skipped. */
export function factGuard(text: string, allowed: Set<string>): GuardResult {
  const clean = text.replace(/\[[^\]]{1,80}\]/g, "");
  const unknown = extractFacts(clean).filter(({ kind, value }) => {
    if (allowed.has(value)) return false;
    if (kind === "url") return ![...allowed].some((a) => a === value || a.startsWith(value) || (a.startsWith("http") && value.startsWith(a)));
    if (kind === "money") return !allowed.has(value.replace(/\s/g, ""));
    return true;
  });
  return { ok: unknown.length === 0, unknown };
}
