// Orchestrator. runCase replays a documented case; runLive looks at current tokens through RYO.
// Every step appends one hash-chained trail entry and (optionally) streams it to the UI via onStep.
// Order: collector → convergence → news → hunter → collapse → bull → bear → judge → risk → claims.
// (Collapse is measured before the debate because the judge weighs it; the practice trade is
// planned at the dip, before the collapse, and its hindsight shows what the collapse would have cost.)

import { canonical, sha256Hex } from "../canonical";
import type { CaseFile } from "../types";
import { detectCollapse } from "./collapse";
import { detectConvergence, type ConvergenceOptions } from "./convergence";
import { buildBundle, defaultLlm, JUDGE_WEIGHTS, runDebate, type LlmJsonFn } from "./debate";
import { candidateFromCase, hunt, type HunterThresholds } from "./hunter";
import { checkClaims, claimFromPost, type NewsOptions } from "./news";
import { DEFAULT_LIMITS, evaluatePlan, hindsight, planDip, type DipOptions } from "./risk";
import { extractMarketFacts, RyoClient, type MarketFacts, type RyoResult, type RyoTool } from "./ryo";
import { fmtUsd, ms, priceId, sorted } from "./series";
import { systemClock, Trail, verifyTrail, type Clock } from "./trail";
import type {
  CaseRun,
  CollapseResult,
  ConvergenceResult,
  DebateResult,
  EvidenceItem,
  Gap,
  HunterCandidate,
  HunterVerdict,
  JudgeFactor,
  RiskLimits,
  StepEvent,
  TradeDecision,
  TradePlan,
} from "./types";

export type RunOptions = {
  clock?: Clock; // inject stepClock(...) for a deterministic trail
  onStep?: (e: StepEvent) => void | Promise<void>;
  /** "auto" (default) = OpenRouter if OPENROUTER_API_KEY is set; null/false = rules only; or your own function. */
  llm?: LlmJsonFn | null | false | "auto";
  limits?: Partial<RiskLimits>;
  convergence?: ConvergenceOptions;
  hunter?: Partial<HunterThresholds>;
  news?: NewsOptions;
  dip?: DipOptions;
  collapseThresholdPct?: number;
};

export type RunCaseOptions = RunOptions & {
  claimedMarketCapUsd?: number | null; // if a promoter or listing claimed one
  compareWith?: HunterCandidate[]; // other tokens for the hunter to select or reject alongside
};

const resolveLlm = async (o: RunOptions["llm"]) => (o === undefined || o === "auto" ? defaultLlm() : o || null);

/** Wraps a Trail so every append also notifies the UI (a broken listener never breaks the run). */
function recorder(clock: Clock, onStep?: RunOptions["onStep"]) {
  const trail = new Trail(clock);
  const step = async (agent: StepEvent["step"], kind: string, summary: string, evidenceIds: string[], data: unknown) => {
    const entry = await trail.append({ agent, kind, summary, evidenceIds, data });
    if (onStep)
      try {
        await onStep({ step: agent, entry, result: entry.data });
      } catch {
        /* the UI going away must not stop the record */
      }
    return entry;
  };
  return { trail, step };
}

// ---------- evidence ----------

/** One evidence item per promoter post. */
export const postEvidence = (posts: CaseFile["posts"]): EvidenceItem[] =>
  posts.map((p) => ({
    id: p.id,
    kind: "post",
    text: `${p.promoter}${p.handle ? ` (${p.handle})` : ""} on ${p.platform}${p.followers ? `, ${p.followers.toLocaleString("en-US")} followers` : ""}, ${p.postedAt}: ${p.text ? `"${p.text}"` : "(no exact quote documented)"}. Said it was paid: ${p.disclosedPayment === null ? "unknown" : p.disclosedPayment ? "yes" : "no"}.${p.paid ? ` Documented payment: $${p.paid.amountUsd.toLocaleString("en-US")} from ${p.paid.by}.` : ""}`,
    data: { promoter: p.promoter, postedAt: p.postedAt, disclosedPayment: p.disclosedPayment, paid: p.paid ?? null, followers: p.followers ?? null },
  }));

/** The case file as citable evidence: posts, daily prices, peak, collapse, holders, buyers, legal actions. */
export function caseEvidence(cf: CaseFile): EvidenceItem[] {
  const items: EvidenceItem[] = postEvidence(cf.posts);
  for (const pp of sorted(cf.prices))
    items.push({
      id: priceId(pp),
      kind: "price",
      text: `${pp.t.slice(0, 10)}: price ${pp.priceUsd === null ? "unknown" : fmtUsd(pp.priceUsd)}, liquidity ${pp.liquidityUsd === null ? "unknown" : `$${Math.round(pp.liquidityUsd).toLocaleString("en-US")}`}.`,
      data: { priceUsd: pp.priceUsd, liquidityUsd: pp.liquidityUsd },
    });
  items.push({ id: "peak", kind: "peak", text: `Case file: peak price ${fmtUsd(cf.peak.priceUsd)} on ${cf.peak.t.slice(0, 10)}.`, data: cf.peak });
  items.push({ id: "collapse", kind: "collapse", text: `Case file: collapsed to ${fmtUsd(cf.collapse.priceUsd)} on ${cf.collapse.t.slice(0, 10)}, down ${cf.collapse.dropPct}% from the peak.`, data: cf.collapse });
  if (cf.holders) items.push({ id: "holders", kind: "holders", text: `The 10 largest wallets held ${cf.holders.top10Pct}% of the supply as of ${cf.holders.asOf} (${cf.holders.method}).`, data: cf.holders });
  if (cf.buyersInWindow) items.push({ id: "buyers", kind: "buyers", text: `${cf.buyersInWindow.count.toLocaleString("en-US")} wallets bought during the promotion window (${cf.buyersInWindow.method}).`, data: { count: cf.buyersInWindow.count } });
  for (const l of cf.legal) items.push({ id: l.id, kind: "legal", text: `${l.title} (${l.date}): ${l.summary}${l.statute ? ` Law: ${l.statute}.` : ""}${l.outcome ? ` Outcome: ${l.outcome}.` : ""}`, data: { kind: l.kind, date: l.date } });
  return items;
}

/** Judge factors from the hunter's rule outcomes and the collapse check. */
export function judgeFactors(h: HunterVerdict, collapse: CollapseResult | null, convergence: ConvergenceResult | null): JudgeFactor[] {
  const rule = (id: string) => h.rules.find((r) => r.id === id);
  const fromRule = (id: string, extra: string[] = []): JudgeFactor => {
    const r = rule(id)!;
    return { id, label: r.label, weight: JUDGE_WEIGHTS[id], present: r.outcome === "unknown" ? null : r.outcome === "red-flag", detail: r.explanation, evidenceIds: [`hunter:${h.symbol}`, ...extra] };
  };
  const ev = convergence?.events[0] ?? convergence?.bestCluster ?? null;
  return [
    fromRule("undisclosed-paid", ev?.disclosure.paidButUndisclosed ?? []),
    collapse
      ? { id: "collapse", label: `Price collapse of ${collapse.thresholdPct}% or more`, weight: JUDGE_WEIGHTS.collapse, present: collapse.detected, detail: collapse.explanation, evidenceIds: ["collapse.detected", ...collapse.evidenceIds] }
      : { id: "collapse", label: "Price collapse", weight: JUDGE_WEIGHTS.collapse, present: null, detail: "No price history to check for a collapse.", evidenceIds: [`hunter:${h.symbol}`] },
    fromRule("promoter-convergence", ev ? ["convergence"] : []),
    fromRule("price-run-up"),
    fromRule("holder-concentration"),
    fromRule("liquidity-drop"),
  ];
}

const hunterItem = (v: HunterVerdict): EvidenceItem => ({ id: `hunter:${v.symbol}`, kind: "finding", text: `Token Hunter on ${v.symbol}: ${v.explanation} ${v.rules.map((r) => r.explanation).join(" ")}`, data: { score: v.score, rules: v.rules.map((r) => ({ id: r.id, value: r.value, outcome: r.outcome })) } });

// ---------- runCase ----------

export async function runCase(cf: CaseFile, opts: RunCaseOptions = {}): Promise<CaseRun> {
  const clock = opts.clock ?? systemClock;
  const { trail, step } = recorder(clock, opts.onStep);
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const llm = await resolveLlm(opts.llm);
  const gaps: Gap[] = [];
  const symbol = cf.token.symbol.toUpperCase();
  const base = caseEvidence(cf);

  // 1. collector
  if (!cf.holders) gaps.push({ source: "case.holders", what: "top-10 holder concentration", reason: "not in the case file", at: clock() });
  if (!cf.buyersInWindow) gaps.push({ source: "case.buyersInWindow", what: "buyers during the promotion", reason: "not in the case file", at: clock() });
  if (opts.claimedMarketCapUsd == null) gaps.push({ source: "case.marketCap", what: "claimed market cap", reason: "no documented claim; liquidity-vs-market-cap rule left unchecked", at: clock() });
  const caseHash = await sha256Hex(canonical(cf));
  await step("collector", "collector.loaded", `Loaded the ${cf.token.name} (${symbol}) case: ${cf.posts.length} promoter posts, ${cf.prices.length} daily prices, ${cf.legal.length} legal actions.`, base.map((i) => i.id), {
    slug: cf.slug,
    caseHash,
    counts: { posts: cf.posts.length, prices: cf.prices.length, legal: cf.legal.length, sources: cf.sources.length },
    gaps: [...gaps],
    llm: llm ? "configured" : "off (rules only)",
  });

  // 2. convergence
  const convergence = detectConvergence(cf.posts, { tokenOf: symbol, windowHours: 14 * 24, ...opts.convergence });
  const ev = convergence.events[0] ?? convergence.bestCluster;
  await step(
    "convergence",
    convergence.detected ? (ev!.coordinated ? "convergence.coordinated" : "convergence.detected") : "convergence.none",
    ev ? ev.reasoning[0] + (ev.coordinated ? " Their posts are linked by payer or wording, so they are not independent." : "") : "No promoter posts to compare.",
    ev?.postIds ?? [],
    convergence,
  );
  const convItem: EvidenceItem | null = ev ? { id: "convergence", kind: "finding", text: `Convergence check: ${ev.reasoning.join(" ")}`, data: { promoters: ev.promoters.length, independentVoices: ev.independentVoices, coordinated: ev.coordinated } } : null;

  // 3. news: every quoted promoter post is a claim checked against the market
  const news = checkClaims(cf.posts.map(claimFromPost), cf.prices, opts.news);
  const contradicted = news.filter((n) => n.verdict === "contradicted").length;
  await step("news", "news.checked", `Checked ${news.length} promoter claim${news.length === 1 ? "" : "s"} against the price: ${contradicted} contradicted by what happened next.`, [...new Set(news.flatMap((n) => n.evidenceIds))], news);

  // 4. hunter
  const candidate = candidateFromCase(cf, convergence, opts.claimedMarketCapUsd ?? null);
  const hunter = hunt([candidate, ...(opts.compareWith ?? [])], opts.hunter);
  const mine = [...hunter.selected, ...hunter.rejected].find((v) => v.symbol === candidate.symbol)!;
  await step("hunter", mine.selected ? "hunter.selected" : "hunter.rejected", mine.explanation, mine.evidenceIds, hunter);

  // 5. collapse
  const collapse = detectCollapse(cf.prices, opts.collapseThresholdPct ?? 80, cf);
  await step("collapse", collapse.detected ? "collapse.detected" : "collapse.none", collapse.explanation, collapse.evidenceIds, collapse);

  // 6–8. debate on one shared bundle, then the judge
  const findings: EvidenceItem[] = [
    ...(convItem ? [convItem] : []),
    ...news.map((n) => ({ id: `news:${n.claimId}`, kind: "finding" as const, text: `News check: ${n.explanation}`, data: n.effect })),
    hunterItem(mine),
    ...[...hunter.selected, ...hunter.rejected].filter((v) => v !== mine).map(hunterItem),
    { id: "collapse.detected", kind: "finding", text: `Collapse check: ${collapse.explanation}`, data: collapse.collapse },
  ];
  const bundle = await buildBundle([...base, ...findings]);
  const factors = judgeFactors(mine, collapse, convergence);
  const debate = await runDebate(bundle, factors, { llm, clock });
  gaps.push(...debate.gaps);
  await step("bull", `bull.${debate.bull.mode}`, `Bull: ${debate.bull.stance} (${debate.bull.claims.length} claims that cite real evidence).`, [...new Set(debate.bull.claims.flatMap((c) => c.evidenceIds))], { bundleHash: bundle.hash, ...debate.bull, rejected: debate.rejected.filter((r) => r.side === "bull") });
  await step("bear", `bear.${debate.bear.mode}`, `Bear: ${debate.bear.stance} (${debate.bear.claims.length} claims that cite real evidence).`, [...new Set(debate.bear.claims.flatMap((c) => c.evidenceIds))], { bundleHash: bundle.hash, ...debate.bear, rejected: debate.rejected.filter((r) => r.side === "bear") });
  await step("judge", `judge.${debate.judge.verdict}`, debate.judge.reasoning.split(/(?<=\.)\s/)[0], [...new Set(factors.flatMap((f) => f.evidenceIds))], { bundleHash: bundle.hash, ...debate.judge, rejected: debate.rejected.filter((r) => r.side === "judge") });

  // 9. risk: a "buy the dip" practice trade, checked against the user's limits
  const trade = caseTrade(cf, limits, opts.dip);
  await step("risk", `risk.${trade.decision}`, trade.decision === "refused" ? `Practice trade refused: ${trade.reasons[0]}` : "Practice trade accepted by every limit (paper only).", trade.plan.evidenceIds, trade);

  // 10. claims: what a victim's complaint can cite
  const summary = {
    verdict: debate.judge.verdict,
    score: debate.judge.score,
    paidButUndisclosed: ev?.disclosure.paidButUndisclosed ?? [],
    legal: cf.legal.map((l) => l.id),
    bundleHash: bundle.hash,
    gaps: gaps.map((g) => `${g.what}: ${g.reason}`),
  };
  await step("claims", "case.summary", `Verdict: ${debate.judge.verdict}. ${summary.paidButUndisclosed.length} paid post${summary.paidButUndisclosed.length === 1 ? "" : "s"} without disclosure; ${cf.legal.length} related legal action${cf.legal.length === 1 ? "" : "s"}.`, [...summary.paidButUndisclosed, ...summary.legal], summary);

  const check = await verifyTrail(trail.entries);
  return { slug: cf.slug, symbol, bundle, convergence, news, hunter, debate, trade, collapse, gaps, trail: trail.entries, trailOk: check.ok, headHash: trail.head };
}

function caseTrade(cf: CaseFile, limits: RiskLimits, dip?: DipOptions): TradeDecision {
  const plan: TradePlan =
    planDip(cf.token.symbol, cf.prices, limits, dip) ??
    (() => {
      const last = sorted(cf.prices).filter((p) => p.priceUsd).pop()!;
      const e = last.priceUsd!;
      return { symbol: cf.token.symbol, side: "buy", at: last.t, entryPriceUsd: e, sizeUsd: limits.maxPositionUsd, stopPriceUsd: e * 0.8, exitPriceUsd: e * 1.4, rationale: "No dip found; plan at the last known price.", evidenceIds: [priceId(last)] };
    })();
  const atPlan = sorted(cf.prices).filter((p) => ms(p.t) <= ms(plan.at)).pop();
  const knownBefore = cf.posts.filter((p) => p.paid && p.disclosedPayment === false && ms(p.postedAt.slice(0, 10)) <= ms(plan.at.slice(0, 10)));
  const d = evaluatePlan(plan, { liquidityUsd: atPlan?.liquidityUsd ?? null, top10HolderPct: cf.holders?.top10Pct ?? null, undisclosedPaidPromotion: knownBefore.length > 0 }, limits);
  return { ...d, hindsight: hindsight(plan, cf.prices) };
}

// ---------- runLive ----------

export type LiveRun = {
  symbols: string[];
  ryo: { configured: boolean; calls: { tool: RyoTool; symbol?: string; ok: boolean; degraded?: string | null }[] };
  facts: MarketFacts[];
  hunter: ReturnType<typeof hunt>;
  perSymbol: { symbol: string; debate: DebateResult; trade: TradeDecision }[];
  convergence: ConvergenceResult | null;
  gaps: Gap[];
  trail: StepEvent["entry"][];
  trailOk: boolean;
  headHash: string;
};

export type RunLiveOptions = RunOptions & {
  ryo?: RyoClient;
  deep?: boolean; // also call deep_analysis per symbol
  posts?: CaseFile["posts"]; // promoter posts you have collected, for convergence (tokens read from $CASHTAGS)
};

/** Current tokens through RYO. When RYO is unavailable every missing fact is a recorded gap, never a number. */
export async function runLive(symbols: string[], opts: RunLiveOptions = {}): Promise<LiveRun> {
  const clock = opts.clock ?? systemClock;
  const { trail, step } = recorder(clock, opts.onStep);
  const ryo = opts.ryo ?? new RyoClient({ clock });
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const llm = await resolveLlm(opts.llm);
  const syms = [...new Set(symbols.map((s) => s.toUpperCase()))];
  const gaps: Gap[] = [];
  const calls: LiveRun["ryo"]["calls"] = [];
  const note = (r: RyoResult, symbol?: string) => {
    calls.push({ tool: r.tool, symbol, ok: r.ok, degraded: r.ok ? r.degraded : undefined });
    if (!r.ok) gaps.push(r.gap);
    else if (r.degraded) gaps.push({ source: `ryo:${r.tool}`, what: `RYO ${r.tool}${symbol ? ` for ${symbol}` : ""} is partial`, reason: r.degraded, at: clock() });
  };

  // 1. collector (sequential: the client spaces calls politely anyway)
  const overview = await ryo.callTool("market_overview", {});
  note(overview);
  const facts: MarketFacts[] = [];
  const items: EvidenceItem[] = [];
  for (const s of syms) {
    const payloads: Partial<Record<RyoTool, unknown>> = {};
    const a = await ryo.callTool("analyze_token", { symbol: s });
    note(a, s);
    if (a.ok) payloads.analyze_token = a.payload;
    if (opts.deep) {
      const d = await ryo.callTool("deep_analysis", { symbol: s });
      note(d, s);
      if (d.ok) payloads.deep_analysis = d.payload;
    }
    const f = extractMarketFacts(s, payloads);
    facts.push(f);
    if (Object.keys(payloads).length && f.missing.length) gaps.push({ source: "ryo:extract", what: `${s}: ${f.missing.join(", ")}`, reason: "not present in the RYO reply", at: clock() });
    items.push({
      id: `market:${s}`,
      kind: "market",
      text: `${s} now (RYO): price ${f.priceUsd === null ? "unknown" : fmtUsd(f.priceUsd)}, liquidity ${f.liquidityUsd === null ? "unknown" : `$${Math.round(f.liquidityUsd).toLocaleString("en-US")}`}, market cap ${f.marketCapUsd === null ? "unknown" : `$${Math.round(f.marketCapUsd).toLocaleString("en-US")}`}, top-10 holders ${f.top10HolderPct === null ? "unknown" : `${f.top10HolderPct}%`}.`,
      data: f,
    });
  }
  await step("collector", ryo.configured ? "collector.ryo" : "collector.ryo-unavailable", ryo.configured ? `Asked RYO about ${syms.join(", ")}: ${calls.filter((c) => c.ok).length} of ${calls.length} calls answered.` : `RYO is not configured, so no live market data was fetched for ${syms.join(", ")}; every market number is recorded as unknown.`, items.map((i) => i.id), { calls, facts, gaps: [...gaps] });

  // 2. convergence (only if posts were supplied)
  const convergence = opts.posts?.length ? detectConvergence(opts.posts, opts.convergence) : null;
  if (convergence) await step("convergence", convergence.detected ? "convergence.detected" : "convergence.none", convergence.detected ? convergence.events[0].reasoning[0] : "No token was pushed by enough promoters at once.", convergence.events.flatMap((e) => e.postIds), convergence);

  // 3. hunter
  const evFor = (s: string) => convergence?.events.find((e) => e.token === s) ?? null;
  const candidates: HunterCandidate[] = facts.map((f) => {
    const ev = evFor(f.symbol);
    return {
      symbol: f.symbol,
      claimedMarketCapUsd: f.marketCapUsd,
      liquidityUsd: f.liquidityUsd,
      peakLiquidityUsd: null,
      top10HolderPct: f.top10HolderPct,
      priceRunUpPct: null,
      convergingPromoters: convergence ? (ev?.promoters.length ?? 0) : null,
      independentVoices: ev?.independentVoices ?? null,
      undisclosedPaidPosts: convergence ? (ev?.disclosure.paidButUndisclosed.length ?? 0) : null,
      evidenceIds: [`market:${f.symbol}`, ...(ev ? ev.postIds : [])],
    };
  });
  const hunter = hunt(candidates, opts.hunter);
  await step("hunter", "hunter.ranked", `Selected ${hunter.selected.length} of ${candidates.length} for review; rejected ${hunter.rejected.length}.`, candidates.map((c) => `market:${c.symbol}`), hunter);

  // 4. per symbol: debate + judge + practice trade
  const perSymbol: LiveRun["perSymbol"] = [];
  const posts = convergence ? (opts.posts ?? []) : [];
  const postItems = postEvidence(posts);
  for (const v of [...hunter.selected, ...hunter.rejected]) {
    const f = facts.find((x) => x.symbol === v.symbol)!;
    const bundle = await buildBundle([...items, ...postItems, hunterItem(v)]);
    const factors = judgeFactors(v, null, convergence);
    const debate = await runDebate(bundle, factors, { llm, clock });
    gaps.push(...debate.gaps);
    await step("judge", `judge.${debate.judge.verdict}`, `${v.symbol}: ${debate.judge.reasoning.split(/(?<=\.)\s/)[0]}`, [...new Set(factors.flatMap((x) => x.evidenceIds))], { symbol: v.symbol, bundleHash: bundle.hash, bull: debate.bull, bear: debate.bear, judge: debate.judge, rejected: debate.rejected });

    const e = f.priceUsd;
    const plan: TradePlan = {
      symbol: v.symbol,
      side: "buy",
      at: clock(),
      entryPriceUsd: e ?? 0,
      sizeUsd: limits.maxPositionUsd,
      stopPriceUsd: e ? e * 0.8 : 0,
      exitPriceUsd: e ? e * 1.4 : 0,
      rationale: e ? `Buy at the current RYO price ${fmtUsd(e)}, stop 20% lower, take profit 40% higher.` : "No current price, so no entry can be set.",
      evidenceIds: [`market:${v.symbol}`],
    };
    const ev = evFor(v.symbol);
    const trade = evaluatePlan(plan, { liquidityUsd: f.liquidityUsd, top10HolderPct: f.top10HolderPct, undisclosedPaidPromotion: convergence ? (ev?.disclosure.paidButUndisclosed.length ?? 0) > 0 : null }, limits);
    // say the real reason first when there was no price to plan with
    if (!e && trade.decision === "refused") trade.reasons.unshift(`No current price for ${v.symbol}${ryo.configured ? " in RYO's reply" : " (RYO is not connected)"}, so there is nothing to plan. Refused rather than guessed.`);
    await step("risk", `risk.${trade.decision}`, `${v.symbol}: practice trade ${trade.decision}${trade.decision === "refused" ? ` — ${trade.reasons[0]}` : ""}`, plan.evidenceIds, trade);
    perSymbol.push({ symbol: v.symbol, debate, trade });
  }

  const check = await verifyTrail(trail.entries);
  return { symbols: syms, ryo: { configured: ryo.configured, calls }, facts, hunter, perSymbol, convergence, gaps, trail: trail.entries, trailOk: check.ok, headHash: trail.head };
}

// ---------- streaming ----------

/**
 * Server-sent events for a run: one `event: step` per trail entry, then `event: done` with the
 * full result (or `event: error`). Use as the body of a Response with content-type text/event-stream.
 */
export function sseStream<T>(run: (onStep: (e: StepEvent) => void) => Promise<T>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* client disconnected */
        }
      };
      try {
        const result = await run((e) => send("step", e));
        send("done", result);
      } catch (err) {
        send("error", { message: err instanceof Error ? err.message : "run failed" });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
}

export const caseRunStream = (cf: CaseFile, opts: RunCaseOptions = {}) => sseStream((onStep) => runCase(cf, { ...opts, onStep }));
export const liveRunStream = (symbols: string[], opts: RunLiveOptions = {}) => sseStream((onStep) => runLive(symbols, { ...opts, onStep }));

