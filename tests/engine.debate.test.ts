import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBundle, factGuard, numbersIn, runDebate, ruleVerdict, type LlmJsonFn } from "../src/lib/engine/debate";
import { stepClock } from "../src/lib/engine/trail";
import type { JudgeFactor } from "../src/lib/engine/types";

const items = [
  { id: "post-a", kind: "post" as const, text: "Celebrity A was paid $250,000 by Agency X and did not say so." },
  { id: "price:2021-06-08", kind: "price" as const, text: "2021-06-08: price $0.0000012, liquidity $2,500,000." },
  { id: "collapse.detected", kind: "finding" as const, text: "The price fell 95.8% from its peak." },
];
const factors: JudgeFactor[] = [
  { id: "undisclosed-paid", label: "Paid posts that did not disclose payment", weight: 0.3, present: true, detail: "Celebrity A was paid $250,000 and did not say so.", evidenceIds: ["post-a"] },
  { id: "collapse", label: "Price collapse", weight: 0.25, present: true, detail: "The price fell 95.8% from its peak.", evidenceIds: ["collapse.detected"] },
  { id: "promoter-convergence", label: "Promoters at once", weight: 0.2, present: true, detail: "Several promoters.", evidenceIds: ["post-a"] },
  { id: "price-run-up", label: "Run-up", weight: 0.1, present: null, detail: "", evidenceIds: [] },
  { id: "holder-concentration", label: "Holders", weight: 0.1, present: false, detail: "Top 10 hold 20%.", evidenceIds: ["price:2021-06-08"] },
  { id: "liquidity-drop", label: "Liquidity drop", weight: 0.05, present: null, detail: "", evidenceIds: [] },
];

test("numbers are read with separators and scale words", () => {
  assert.deepEqual(numbersIn("paid $250,000 then 1.2M and 3 million, fell 95.8%"), [250000, 1200000, 3000000, 95.8]);
});

test("fact guard rejects missing ids, uncited claims and invented numbers", async () => {
  const b = await buildBundle(items);
  const { kept, rejected } = factGuard("bear", [
    { text: "Celebrity A was paid $250,000 without disclosure.", evidenceIds: ["post-a"] },
    { text: "The token was listed on 40 exchanges.", evidenceIds: ["post-z"] },
    { text: "It is obviously a scam.", evidenceIds: [] },
    { text: "Celebrity A was paid $900,000.", evidenceIds: ["post-a"] },
    { text: "Liquidity was 2.5 million at the peak.", evidenceIds: ["price:2021-06-08"] },
  ], b);
  assert.equal(kept.length, 2);
  assert.deepEqual(rejected.map((r) => r.reason.split(":")[0].split(" ").slice(0, 3).join(" ")), ["cites evidence that", "cites no evidence", "number 900000 not"]);
});

test("verdict is rule-based and published", () => {
  assert.deepEqual(ruleVerdict(factors), { verdict: "pump-and-dump", score: 0.75 });
  assert.equal(ruleVerdict(factors.map((f) => ({ ...f, present: f.id === "promoter-convergence" ? true : false }))).verdict, "no-signal");
  assert.equal(ruleVerdict(factors.map((f) => ({ ...f, present: f.id === "undisclosed-paid" }))).verdict, "suspicious");
});

test("a lying model is caught by the fact guard and the side falls back to rules", async () => {
  const b = await buildBundle(items);
  const prompts: string[] = [];
  const liar: LlmJsonFn = async (o) => {
    prompts.push(o.user);
    if (o.name === "judge_reasoning") return { reasoning: "It lost 99.9% and 12 victims sued.", evidenceIds: ["post-a"] };
    return { stance: "x", claims: [{ text: "The founder fled to 7 countries with $5,000,000.", evidenceIds: ["post-q"] }] };
  };
  const r = await runDebate(b, factors, { llm: liar, clock: stepClock("2026-01-01T00:00:00Z") });
  assert.equal(prompts[0], prompts[1], "bull and bear receive the identical evidence bundle");
  assert.equal(r.bull.mode, "rules");
  assert.equal(r.bear.mode, "rules");
  assert.match(r.bear.fallbackReason!, /fact guard/);
  assert.equal(r.judge.mode, "rules", "judge reasoning with invented numbers is rejected");
  assert.equal(r.rejected.filter((x) => /post-q|99\.9|5000000/.test(x.reason)).length, 3, "bull, bear and judge model output each rejected");
  assert.equal(r.judge.verdict, "pump-and-dump");
  assert.equal(r.bundleHash, b.hash);
});

test("an honest model's claims are kept; a broken model is a recorded gap", async () => {
  const b = await buildBundle(items);
  const honest: LlmJsonFn = async (o) =>
    o.name === "judge_reasoning"
      ? { reasoning: "Payment of $250,000 was hidden and the price fell 95.8%.", evidenceIds: ["post-a", "collapse.detected"] }
      : { stance: "s", claims: [{ text: "The price fell 95.8% from its peak.", evidenceIds: ["collapse.detected"] }] };
  const r = await runDebate(b, factors, { llm: honest });
  assert.equal(r.bull.mode, "llm");
  assert.equal(r.judge.mode, "llm");
  assert.equal(r.rejected.length, 0);

  const broken: LlmJsonFn = async () => {
    throw new Error("OpenRouter 500");
  };
  const r2 = await runDebate(b, factors, { llm: broken });
  assert.equal(r2.bull.mode, "rules");
  assert.ok(r2.gaps.some((g) => g.source === "llm:bull" && /500/.test(g.reason)));
});

test("rule-based claims go through the same fact guard", async () => {
  const b = await buildBundle(items);
  const r = await runDebate(b, factors, { llm: null });
  for (const side of [r.bull, r.bear]) assert.equal(factGuard(side.side, side.claims, b).rejected.length, 0, JSON.stringify(side.claims));
  // the holders factor's "20%" is not in the item it cites, so even a rule-written claim is dropped
  assert.ok(r.rejected.some((x) => x.side === "bull" && /20 not found/.test(x.reason)));
  assert.ok(!r.bull.claims.some((c) => c.text.includes("20%")));
});
