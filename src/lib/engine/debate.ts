// Bull vs Bear, then a Judge. Both sides get the IDENTICAL evidence bundle (same ids, same hash).
// With a model configured they argue in structured output; every claim must cite evidence ids that
// exist, and every number in a claim must appear in the evidence it cites (the "fact guard").
// Claims that fail are dropped and recorded; a side with no surviving claim falls back to rules.
// The verdict is ALWAYS rule-based (weighted factors); the model may only write the explanation.

import { z } from "zod";
import { canonical, sha256Hex } from "../canonical";
import type { Verdict } from "../types";
import type { Clock } from "./trail";
import { systemClock } from "./trail";
import type { DebateClaim, DebateResult, DebateSide, EvidenceBundle, EvidenceItem, Gap, GuardRejection, JudgeFactor, JudgeResult } from "./types";

/** Structured-output LLM call: resolves to an object matching the schema, or null. May throw. */
export type LlmJsonFn = (opts: { system: string; user: string; schema: z.ZodType; name: string; maxTokens?: number }) => Promise<unknown | null>;

/** OpenRouter (OPENROUTER_API_KEY) when configured, else null = rules only. Server-side only. */
export async function defaultLlm(): Promise<LlmJsonFn | null> {
  if (typeof process === "undefined" || !process.env?.OPENROUTER_API_KEY) return null;
  const { openRouterJson, openRouterPaused } = await import("../openrouter");
  if (openRouterPaused()) return null;
  return (o) => openRouterJson({ ...o, maxTokens: o.maxTokens ?? 1500 });
}

export async function buildBundle(items: EvidenceItem[]): Promise<EvidenceBundle> {
  const clean = JSON.parse(JSON.stringify(items)) as EvidenceItem[];
  return { items: clean, ids: clean.map((i) => i.id), hash: await sha256Hex(canonical(clean)) };
}

// ---------- fact guard ----------

const SCALE: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, thousand: 1e3, million: 1e6, billion: 1e9 };

/** Numbers written in text, with k/M/B and "million" understood; dates split into parts. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)(?:\s?(k|m|b|thousand|million|billion)\b)?/gi)) {
    const v = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(v)) out.push(v * (m[2] ? SCALE[m[2].toLowerCase()] : 1));
  }
  return out;
}

const numbersOfItem = (it: EvidenceItem) => [...numbersIn(it.text), ...numbersIn(JSON.stringify(it.data ?? null))];

/** A number "matches" when within 2% (or 0.51 absolute, for rounded percentages). Small numbers (< 10) are not checked. */
const matches = (claimed: number, known: number[]) => claimed < 10 || known.some((k) => Math.abs(Math.abs(k) - claimed) <= Math.max(0.02 * Math.abs(k), 0.51));

export function factGuard(side: GuardRejection["side"], claims: DebateClaim[], bundle: EvidenceBundle): { kept: DebateClaim[]; rejected: GuardRejection[] } {
  const byId = new Map(bundle.items.map((i) => [i.id, i]));
  const kept: DebateClaim[] = [];
  const rejected: GuardRejection[] = [];
  for (const c of claims) {
    const ids = [...new Set(c.evidenceIds ?? [])];
    const missing = ids.filter((id) => !byId.has(id));
    if (!c.text?.trim()) rejected.push({ side, text: String(c.text ?? ""), reason: "empty claim" });
    else if (!ids.length) rejected.push({ side, text: c.text, reason: "cites no evidence" });
    else if (missing.length) rejected.push({ side, text: c.text, reason: `cites evidence that does not exist: ${missing.join(", ")}` });
    else {
      const known = ids.flatMap((id) => numbersOfItem(byId.get(id)!));
      const bad = numbersIn(c.text).filter((n) => !matches(n, known));
      if (bad.length) rejected.push({ side, text: c.text, reason: `number${bad.length > 1 ? "s" : ""} ${bad.join(", ")} not found in the cited evidence` });
      else kept.push({ text: c.text.trim(), evidenceIds: ids });
    }
  }
  return { kept, rejected };
}

// ---------- prompts ----------

const SideSchema = z.object({
  stance: z.string(),
  claims: z.array(z.object({ text: z.string(), evidenceIds: z.array(z.string()) })),
});
const JudgeSchema = z.object({ reasoning: z.string(), evidenceIds: z.array(z.string()) });

const RULES = `Rules: use ONLY the evidence list. Every claim cites at least one evidence id exactly as written in [brackets]. Copy numbers exactly as they appear in the evidence you cite; never compute or invent a number. Write 2 to 5 short claims in plain words a newcomer understands. If the evidence is against your side, concede it honestly in a claim.`;

const SYSTEM = {
  bull: `You are the BULL agent in a crypto fraud review. Argue that this token's rise was organic and that the promotion was lawful (no signal of fraud). ${RULES}`,
  bear: `You are the BEAR agent in a crypto fraud review. Argue that this was illegal undisclosed paid promotion (touting, US Securities Act §17(b)) and/or a pump-and-dump. ${RULES}`,
  judge: `You are the JUDGE in a crypto fraud review. The verdict has already been fixed by transparent weighted rules; do not change it. Explain it in 3 to 5 plain-words sentences a victim can understand, weighing the bull and bear claims. Cite evidence ids you rely on. Copy numbers exactly from the evidence; never invent one.`,
};

const bundleText = (b: EvidenceBundle) => `Evidence (bundle ${b.hash.slice(0, 12)}):\n${b.items.map((i) => `[${i.id}] ${i.text}`).join("\n")}`;

// ---------- deterministic sides ----------

function rulesSide(side: "bull" | "bear", factors: JudgeFactor[], bundle: EvidenceBundle): DebateSide {
  const has = (id: string) => bundle.ids.includes(id);
  const cite = (ids: string[]) => ids.filter(has);
  const claims: DebateClaim[] = [];
  if (side === "bear") {
    for (const f of factors.filter((f) => f.present === true)) if (cite(f.evidenceIds).length) claims.push({ text: f.detail, evidenceIds: cite(f.evidenceIds) });
    const unknown = factors.filter((f) => f.present === null);
    if (!claims.length) claims.push({ text: "None of the warning signs is clearly present in this evidence; the bear case rests on what could not be checked.", evidenceIds: bundle.ids.slice(0, 1) });
    else if (unknown.length && claims.length < 5) claims.push({ text: `Even without data on ${unknown.map((f) => f.label.toLowerCase()).join(", ")}, the signs above are enough to look closer.`, evidenceIds: claims[0].evidenceIds });
    return { side, stance: "This was paid promotion that was not disclosed and/or a pump-and-dump.", claims: claims.slice(0, 5), mode: "rules" };
  }
  for (const f of factors.filter((f) => f.present === false)) if (cite(f.evidenceIds).length) claims.push({ text: `Not seen: ${f.label.toLowerCase()}. ${f.detail}`, evidenceIds: cite(f.evidenceIds) });
  const disclosed = bundle.items.filter((i) => i.kind === "post" && (i.data as { disclosedPayment?: boolean } | undefined)?.disclosedPayment === true);
  if (disclosed.length) claims.push({ text: `${disclosed.length === 1 ? "One promoter" : "Some promoters"} did say the post was paid.`, evidenceIds: disclosed.map((d) => d.id) });
  const unknown = factors.filter((f) => f.present === null);
  if (unknown.length) claims.push({ text: `Some warning signs could not be checked for lack of data (${unknown.map((f) => f.label.toLowerCase()).join(", ")}); missing data is not proof of fraud.`, evidenceIds: cite(unknown.flatMap((f) => f.evidenceIds)).slice(0, 3).concat(bundle.ids.slice(0, 1)).slice(0, 3) });
  claims.push({ text: "A price move right after a post shows timing, not that the post caused it.", evidenceIds: cite(factors.flatMap((f) => f.evidenceIds)).slice(0, 2).concat(bundle.ids.slice(0, 1)).slice(0, 2) });
  return { side, stance: "The rise could be organic and the promotion lawful.", claims: claims.slice(0, 5), mode: "rules" };
}

// ---------- judge ----------

export const JUDGE_WEIGHTS: Record<string, number> = {
  "undisclosed-paid": 0.3,
  collapse: 0.25,
  "promoter-convergence": 0.2,
  "price-run-up": 0.1,
  "holder-concentration": 0.1,
  "liquidity-drop": 0.05,
};

/** Fixed, published rule: the verdict never depends on the model. */
export function ruleVerdict(factors: JudgeFactor[]): { verdict: Verdict; score: number } {
  const on = (id: string) => factors.some((f) => f.id === id && f.present === true);
  const score = Math.round(factors.reduce((s, f) => s + (f.present === true ? f.weight : 0), 0) * 100) / 100;
  const verdict: Verdict = score >= 0.6 && on("collapse") && (on("undisclosed-paid") || on("promoter-convergence")) ? "pump-and-dump" : score >= 0.25 ? "suspicious" : "no-signal";
  return { verdict, score };
}

function rulesReasoning(verdict: Verdict, score: number, factors: JudgeFactor[], bull: DebateSide, bear: DebateSide): string {
  const present = factors.filter((f) => f.present === true);
  const absent = factors.filter((f) => f.present === false);
  const unknown = factors.filter((f) => f.present === null);
  const word = { "pump-and-dump": "a pump-and-dump", suspicious: "suspicious", "no-signal": "no clear signal of fraud" }[verdict];
  return [
    `Verdict: ${word} (score ${score} of 1).`,
    present.length ? `Weighing against the token: ${present.map((f) => `${f.label.toLowerCase()} (weight ${f.weight})`).join("; ")}.` : "No warning sign was clearly present.",
    absent.length ? `In its favour: no ${absent.map((f) => f.label.toLowerCase()).join(", no ")}.` : "",
    unknown.length ? `Could not be checked: ${unknown.map((f) => f.label.toLowerCase()).join(", ")}.` : "",
    `The bull side made ${bull.claims.length} supported claim${bull.claims.length === 1 ? "" : "s"} and the bear side ${bear.claims.length}; only claims that cite real evidence were counted.`,
  ]
    .filter(Boolean)
    .join(" ");
}

// ---------- run ----------

export type DebateOptions = { llm?: LlmJsonFn | null; clock?: Clock };

export async function runDebate(bundle: EvidenceBundle, factors: JudgeFactor[], opts: DebateOptions = {}): Promise<DebateResult> {
  const clock = opts.clock ?? systemClock;
  const llm = opts.llm ?? null;
  const gaps: Gap[] = [];
  const rejected: GuardRejection[] = [];
  const user = bundleText(bundle); // identical input for both sides

  const argue = async (side: "bull" | "bear"): Promise<DebateSide> => {
    // rule-written claims go through the same guard as model-written ones
    const fallback = (why: string): DebateSide => {
      const s = rulesSide(side, factors, bundle);
      const g = factGuard(side, s.claims, bundle);
      rejected.push(...g.rejected);
      return { ...s, claims: g.kept, fallbackReason: why };
    };
    if (!llm) return fallback("no model configured");
    try {
      const raw = await llm({ system: SYSTEM[side], user, schema: SideSchema, name: `${side}_case` });
      const parsed = SideSchema.safeParse(raw);
      if (!parsed.success) {
        gaps.push({ source: `llm:${side}`, what: `${side} argument`, reason: "model reply was empty or did not match the schema", at: clock() });
        return fallback("model reply did not match the schema");
      }
      const g = factGuard(side, parsed.data.claims, bundle);
      rejected.push(...g.rejected);
      if (!g.kept.length) return fallback(`all ${parsed.data.claims.length} model claims failed the fact guard`);
      return { side, stance: parsed.data.stance, claims: g.kept.slice(0, 5), mode: "llm" };
    } catch (err) {
      gaps.push({ source: `llm:${side}`, what: `${side} argument`, reason: err instanceof Error ? err.message.slice(0, 200) : "model call failed", at: clock() });
      return fallback("model call failed");
    }
  };

  const [bull, bear] = await Promise.all([argue("bull"), argue("bear")]);
  const { verdict, score } = ruleVerdict(factors);
  let reasoning = rulesReasoning(verdict, score, factors, bull, bear);
  let mode: JudgeResult["mode"] = "rules";

  if (llm) {
    try {
      const judgeUser = `${user}\n\nFixed verdict: ${verdict} (score ${score}).\nFactors: ${factors.map((f) => `${f.id}=${f.present} (weight ${f.weight})`).join(", ")}\nBull claims:\n${bull.claims.map((c) => `- ${c.text} [${c.evidenceIds.join(", ")}]`).join("\n")}\nBear claims:\n${bear.claims.map((c) => `- ${c.text} [${c.evidenceIds.join(", ")}]`).join("\n")}`;
      const raw = await llm({ system: SYSTEM.judge, user: judgeUser, schema: JudgeSchema, name: "judge_reasoning" });
      const parsed = JudgeSchema.safeParse(raw);
      if (parsed.success) {
        // the judge weighs everything, so its ids must exist and its numbers must appear somewhere in the bundle
        const text = parsed.data.reasoning;
        const missing = parsed.data.evidenceIds.filter((id) => !bundle.ids.includes(id));
        const known = bundle.items.flatMap(numbersOfItem).concat([score, ...factors.map((f) => f.weight)]);
        const badNums = numbersIn(text).filter((n) => !matches(n, known));
        if (!parsed.data.evidenceIds.length) rejected.push({ side: "judge", text, reason: "cites no evidence" });
        else if (missing.length) rejected.push({ side: "judge", text, reason: `cites evidence that does not exist: ${missing.join(", ")}` });
        else if (badNums.length) rejected.push({ side: "judge", text, reason: `number${badNums.length > 1 ? "s" : ""} ${badNums.join(", ")} not found in the evidence` });
        else {
          reasoning = parsed.data.reasoning.trim();
          mode = "llm";
        }
      } else gaps.push({ source: "llm:judge", what: "judge reasoning", reason: "model reply did not match the schema", at: clock() });
    } catch (err) {
      gaps.push({ source: "llm:judge", what: "judge reasoning", reason: err instanceof Error ? err.message.slice(0, 200) : "model call failed", at: clock() });
    }
  }

  const judge: JudgeResult = {
    verdict,
    score,
    weights: Object.fromEntries(factors.map((f) => [f.id, f.weight])),
    factors,
    tally: { bullClaims: bull.claims.length, bearClaims: bear.claims.length },
    reasoning,
    mode,
  };
  // bull and bear run in parallel: sort so the record doesn't depend on which answered first
  const order = { bull: 0, bear: 1, judge: 2 };
  rejected.sort((a, b) => order[a.side] - order[b.side]);
  gaps.sort((a, b) => a.source.localeCompare(b.source));
  return { bundleHash: bundle.hash, bull, bear, judge, rejected, gaps };
}
