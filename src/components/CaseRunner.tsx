"use client";

// Runs the agents over a documented case (server-sent events) and reveals each step at a human pace,
// with Doki narrating. Every step shows its fingerprint; the whole trail can be verified, or tampered with, in the browser.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaseFile, TrailEntry } from "@/lib/types";
import type {
  CaseRun,
  CollapseResult,
  ConvergenceResult,
  DebateSide,
  GuardRejection,
  HunterResult,
  JudgeResult,
  NewsCheck,
  StepEvent,
  TradeDecision,
} from "@/lib/engine/types";
import { verifyTrail } from "@/lib/engine/trail";
import { caseRange, fmtDate, fmtUsd } from "@/lib/format";
import { useGuide } from "./Guide";
import type { Mood } from "./Mascot";
import { PriceChart } from "./PriceChart";

const AGENT: Record<TrailEntry["agent"], { icon: string; name: string; mood: Mood; lead: string }> = {
  collector: { icon: "📡", name: "Collector", mood: "talk", lead: "First I gather the evidence." },
  convergence: { icon: "🗣️", name: "Multi-influencer watcher", mood: "think", lead: "Were several promoters pushing it at once?" },
  news: { icon: "📰", name: "News checker", mood: "think", lead: "Did what they promised actually happen?" },
  hunter: { icon: "🔎", name: "Token hunter", mood: "point", lead: "Could you really sell this coin?" },
  collapse: { icon: "📉", name: "Collapse watcher", mood: "alarm", lead: "Uh oh." },
  bull: { icon: "🐂", name: "Bull", mood: "happy", lead: "The Bull makes the best case for the coin." },
  bear: { icon: "🐻", name: "Bear", mood: "alarm", lead: "The Bear argues it's a scam, from the same evidence." },
  judge: { icon: "⚖️", name: "Judge", mood: "think", lead: "The Judge weighs both sides." },
  risk: { icon: "🧮", name: "Risk desk", mood: "point", lead: "Would we buy it with practice money?" },
  claims: { icon: "📋", name: "Case summary", mood: "happy", lead: "Here's what a complaint can cite." },
};

const PACE_MS = 1700;
const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

type Status = "idle" | "running" | "done" | "error";

export function CaseRunner({ data }: { data: CaseFile }) {
  const guide = useGuide();
  const [status, setStatus] = useState<Status>("idle");
  const [queue, setQueue] = useState<StepEvent[]>([]);
  const [shown, setShown] = useState(0);
  const [run, setRun] = useState<CaseRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [fast, setFast] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const start = useCallback(() => {
    esRef.current?.close();
    setQueue([]);
    setShown(0);
    setRun(null);
    setError(null);
    setOpen(null);
    setFast(false);
    setStatus("running");
    guide?.say("Okay! I'm sending the case to my agent friends. Watch them work, one by one.", "happy");
    const es = new EventSource(`/api/case/${data.slug}/run`);
    esRef.current = es;
    es.addEventListener("step", (e) => setQueue((q) => [...q, JSON.parse((e as MessageEvent).data) as StepEvent]));
    es.addEventListener("done", (e) => {
      setRun(JSON.parse((e as MessageEvent).data) as CaseRun);
      es.close();
    });
    es.addEventListener("error", (e) => {
      const msg = (e as MessageEvent).data;
      if (msg) setError(String(msg));
      es.close();
    });
  }, [data.slug, guide]);

  useEffect(() => () => esRef.current?.close(), []);

  // reveal one step at a time
  useEffect(() => {
    if (status !== "running") return;
    if (shown < queue.length) {
      const id = window.setTimeout(
        () => {
          const ev = queue[shown];
          const a = AGENT[ev.step];
          if (!fast) guide?.say(`${a.lead} ${ev.entry.summary}`, a.mood);
          setShown((n) => n + 1);
        },
        fast || shown === 0 ? 120 : PACE_MS,
      );
      return () => window.clearTimeout(id);
    }
    if (run && shown >= queue.length) {
      setStatus("done");
      const v = run.debate.judge.verdict;
      guide?.say(
        v === "pump-and-dump"
          ? `Verdict: pump-and-dump. And all ${run.trail.length} steps are sealed in a notebook you can check yourself.`
          : `Verdict: ${v}. Every step is sealed in a notebook you can check yourself.`,
        v === "pump-and-dump" ? "alarm" : "happy",
      );
    }
    if (error) setStatus("error");
  }, [status, shown, queue, run, fast, guide, error]);

  const visible = queue.slice(0, shown);
  const reached = new Set(visible.map((v) => v.step));
  const upto = reached.has("collapse") ? undefined : reached.has("hunter") || reached.has("news") ? data.window.peak : reached.has("convergence") ? data.window.peak : status === "idle" ? undefined : data.window.pumpStart;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
      <div className="lg:sticky lg:top-24 lg:self-start">
        <div className="card p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold">What the agents can see so far</p>
            {status === "running" && (
              <span className="chip !text-xs">
                <span className="live-dot" /> running
              </span>
            )}
          </div>
          <PriceChart className="mt-2" {...caseRange(data.window)} prices={data.prices} posts={data.posts} upto={upto} collapseAt={reached.has("collapse") || status === "idle" ? data.collapse.t : undefined} />
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          {status === "idle" && (
            <button className="btn btn-primary text-lg" onClick={start}>
              ▶ Run the agents
            </button>
          )}
          {status === "running" && (
            <button className="btn btn-ghost" onClick={() => setFast(true)}>
              ⏩ Skip ahead
            </button>
          )}
          {(status === "done" || status === "error") && (
            <button className="btn btn-ghost" onClick={start}>
              ↺ Run again
            </button>
          )}
        </div>
        <p className="mt-3 text-sm text-[var(--ink-3)]">
          The agents only see the case file: documented posts, on-chain prices and court records. Same input, same notebook, every time.
        </p>
      </div>

      <div>
        {status === "idle" && (
          <div className="card grid min-h-[16rem] place-items-center p-8 text-center text-[var(--ink-2)]">
            <div>
              <p className="text-5xl">🐤</p>
              <p className="mt-3 text-lg">Press “Run the agents” to watch ten agents work through this case, live.</p>
            </div>
          </div>
        )}
        <ol className="space-y-3" aria-live="polite">
          {visible.map((ev, i) => {
            const a = AGENT[ev.step];
            const isOpen = open === i;
            return (
              <li key={ev.entry.seq} className="card overflow-hidden" style={{ animation: "rise .5s var(--ease) both" }}>
                <button className="flex w-full items-start gap-3 p-4 text-left" onClick={() => setOpen(isOpen ? null : i)} aria-expanded={isOpen}>
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border-2 border-[var(--ink)] bg-[var(--canary-soft)] text-xl">{a.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-lg font-bold">{a.name}</span>
                      <span className="font-mono text-[0.7rem] text-[var(--ink-3)]">#{ev.entry.seq} · {short(ev.entry.hash)}</span>
                    </span>
                    <span className="mt-0.5 block text-[var(--ink-2)]">{ev.entry.summary}</span>
                  </span>
                  <span className="mt-1 shrink-0 text-sm font-semibold text-[var(--ink-3)]">{isOpen ? "Hide" : "Why?"}</span>
                </button>
                {isOpen && (
                  <div className="border-t-[1.5px] border-[var(--line)] bg-[var(--paper)] p-4 text-sm">
                    <StepDetail ev={ev} data={data} />
                    <EvidenceChips ids={ev.entry.evidenceIds} data={data} />
                    <p className="mt-3 break-all font-mono text-[0.7rem] text-[var(--ink-3)]">
                      fingerprint {ev.entry.hash}
                      <br />
                      sealed onto {ev.entry.prevHash}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        <style>{`@keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}`}</style>
        {status === "error" && <p className="card mt-4 border-[var(--alarm)] p-4 text-[var(--alarm)]">The run stopped: {error ?? "connection lost"}. Try again.</p>}
        {status === "done" && run && <Outcome run={run} />}
      </div>
    </div>
  );
}

function EvidenceChips({ ids, data }: { ids: string[]; data: CaseFile }) {
  const label = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of data.posts) m.set(p.id, `${p.promoter}, ${fmtDate(p.postedAt)}`);
    for (const l of data.legal) m.set(l.id, l.title);
    return m;
  }, [data]);
  const [all, setAll] = useState(false);
  if (!ids.length) return null;
  const list = all ? ids : ids.slice(0, 8);
  return (
    <div className="mt-3">
      <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-3)]">Evidence cited ({ids.length})</p>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {list.map((id) => (
          <li key={id} className="chip !bg-white !text-[0.72rem]" title={id}>
            {label.get(id) ?? id.replace(/^price:/, "price on ")}
          </li>
        ))}
        {ids.length > 8 && !all && (
          <li>
            <button className="chip !text-[0.72rem]" onClick={() => setAll(true)}>
              +{ids.length - 8} more
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

function Pct({ v }: { v: number | null | undefined }) {
  if (v == null || !Number.isFinite(v)) return <span className="text-[var(--ink-3)]">—</span>;
  return <span className={v < 0 ? "font-bold text-[var(--alarm)]" : "font-bold text-[var(--ok)]"}>{v > 0 ? "+" : ""}{v.toFixed(0)}%</span>;
}

function StepDetail({ ev, data }: { ev: StepEvent; data: CaseFile }) {
  const r = ev.result as Record<string, unknown>;
  switch (ev.step) {
    case "collector": {
      const c = r.counts as Record<string, number>;
      return (
        <ul className="grid gap-1 sm:grid-cols-2">
          <li>📝 {c.posts} promoter posts, from SEC orders and court records</li>
          <li>📈 {c.prices} daily prices, read from the blockchain</li>
          <li>⚖️ {c.legal} legal actions</li>
          <li>🔗 {c.sources} sources</li>
          <li className="sm:col-span-2">
            AI writer: <strong>{String(r.llm)}</strong>. Case file fingerprint <span className="font-mono text-xs">{short(String(r.caseHash))}</span>
          </li>
        </ul>
      );
    }
    case "convergence": {
      const c = r as unknown as ConvergenceResult;
      const e = c.events[0] ?? c.bestCluster;
      if (!e) return <p>No cluster found.</p>;
      return (
        <div>
          <p>
            <strong>{e.promoters.length}</strong> promoters, <strong>{e.independentVoices}</strong> independent voices, between {fmtDate(e.windowStart)} and {fmtDate(e.windowEnd)}.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {e.reasoning.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      );
    }
    case "news": {
      const list = r as unknown as NewsCheck[];
      const posts = new Map(data.posts.map((p) => [p.id, p]));
      return (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-left text-[0.8rem]">
            <thead className="text-[var(--ink-3)]">
              <tr>
                <th className="py-1 pr-2">Claim</th>
                <th className="py-1 pr-2">3 days later</th>
                <th className="py-1 pr-2">30 days later</th>
                <th className="py-1">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {list.map((n) => {
                const p = posts.get(n.claimId);
                return (
                  <tr key={n.claimId} className="border-t border-[var(--line)] align-top">
                    <td className="py-1.5 pr-2">
                      <strong>{p?.promoter ?? n.claimId}</strong>
                      {p?.text && <span className="block text-[var(--ink-2)]">“{p.text.slice(0, 70)}{p.text.length > 70 ? "…" : ""}”</span>}
                    </td>
                    <td className="py-1.5 pr-2"><Pct v={n.effect.shortChangePct} /></td>
                    <td className="py-1.5 pr-2"><Pct v={n.effect.longChangePct} /></td>
                    <td className="py-1.5">{n.verdict === "contradicted" ? "❌ contradicted" : n.verdict === "supported" ? "✅ supported" : "— not enough data"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-[var(--ink-3)]">Timing is not proof of cause. The checker reports what followed each claim.</p>
        </div>
      );
    }
    case "hunter": {
      const h = r as unknown as HunterResult;
      const v = [...h.selected, ...h.rejected][0];
      return (
        <div>
          <p>
            Score <strong>{v.score}</strong> of {v.maxScore}. {v.selected ? "Selected for review" : "Not selected"} (needs {h.selectThreshold}).
          </p>
          <ul className="mt-2 space-y-1.5">
            {v.rules.map((rule) => (
              <li key={rule.id} className="flex gap-2">
                <span aria-hidden>{rule.outcome === "red-flag" ? "🚩" : rule.outcome === "clear" ? "✅" : "❔"}</span>
                <span>
                  <strong>{rule.label}</strong> ({rule.comparison}): {rule.explanation}
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case "collapse": {
      const c = r as unknown as CollapseResult;
      return (
        <dl className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-white p-2">
            <dt className="text-xs text-[var(--ink-3)]">Peak</dt>
            <dd className="font-bold">{c.peak ? fmtUsd(c.peak.priceUsd) : "—"}</dd>
            <dd className="text-xs">{c.peak ? fmtDate(c.peak.t) : ""}</dd>
          </div>
          <div className="rounded-xl bg-white p-2">
            <dt className="text-xs text-[var(--ink-3)]">Crossed −{c.thresholdPct}%</dt>
            <dd className="font-bold text-[var(--alarm)]">{c.collapse ? `−${c.collapse.dropPct}%` : "—"}</dd>
            <dd className="text-xs">{c.collapse ? fmtDate(c.collapse.t) : ""}</dd>
          </div>
          <div className="rounded-xl bg-white p-2">
            <dt className="text-xs text-[var(--ink-3)]">Pool money</dt>
            <dd className="font-bold">{c.liquidityDropPct != null ? `−${c.liquidityDropPct}%` : "—"}</dd>
            <dd className="text-xs">same days</dd>
          </div>
        </dl>
      );
    }
    case "bull":
    case "bear": {
      const s = r as unknown as DebateSide & { rejected: GuardRejection[]; bundleHash: string };
      return (
        <div>
          <p className="flex flex-wrap items-center gap-2">
            <strong>{s.stance}</strong>
            <span className="chip !text-[0.7rem]">{s.mode === "llm" ? "written by AI, fact-checked" : "rule-based"}</span>
          </p>
          {s.fallbackReason && <p className="mt-1 text-xs text-[var(--ink-3)]">AI unavailable ({s.fallbackReason}), so the rule-based agent argued instead.</p>}
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {s.claims.map((c) => (
              <li key={c.text}>
                {c.text} <span className="font-mono text-[0.7rem] text-[var(--ink-3)]">[{c.evidenceIds.slice(0, 3).join(", ")}{c.evidenceIds.length > 3 ? "…" : ""}]</span>
              </li>
            ))}
          </ul>
          {s.rejected.length > 0 && (
            <p className="mt-2 rounded-xl bg-[var(--alarm-soft)] p-2 text-xs">
              🛡️ Fact guard threw out {s.rejected.length} claim{s.rejected.length === 1 ? "" : "s"} that cited evidence that doesn&apos;t exist or numbers that don&apos;t match.
            </p>
          )}
          <p className="mt-2 text-xs text-[var(--ink-3)]">Both sides got the identical evidence bundle {short(s.bundleHash)}.</p>
        </div>
      );
    }
    case "judge": {
      const j = r as unknown as JudgeResult;
      return (
        <div>
          <p className="text-[var(--ink-2)]">{j.reasoning}</p>
          <div className="mt-2 h-3 overflow-hidden rounded-full bg-white">
            <div className="h-full bg-[var(--alarm)]" style={{ width: `${Math.round(j.score * 100)}%` }} />
          </div>
          <p className="mt-1 text-xs">Score {j.score.toFixed(2)} of 1 · pump-and-dump at 0.6+</p>
          <ul className="mt-2 space-y-1">
            {j.factors.map((f) => (
              <li key={f.id} className="flex gap-2">
                <span aria-hidden>{f.present === true ? "🚩" : f.present === false ? "✅" : "❔"}</span>
                <span>
                  <strong>{f.label}</strong> <span className="font-mono text-xs">(weight {f.weight})</span>: {f.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case "risk": {
      const t = r as unknown as TradeDecision;
      return (
        <div>
          <p>
            Plan on {fmtDate(t.plan.at)}: buy <strong>{fmtUsd(t.plan.sizeUsd)}</strong> at {fmtUsd(t.plan.entryPriceUsd)}, stop {fmtUsd(t.plan.stopPriceUsd)}, take profit {fmtUsd(t.plan.exitPriceUsd)}.
            <span className="block text-xs text-[var(--ink-3)]">{t.plan.rationale} Paper money only. No real order is ever placed.</span>
          </p>
          <ul className="mt-2 space-y-1">
            {t.checks.map((c) => (
              <li key={c.limit + c.reason} className="flex gap-2">
                <span aria-hidden>{c.ok ? "✅" : "⛔"}</span>
                <span>{c.reason}</span>
              </li>
            ))}
          </ul>
          {t.hindsight && <p className="mt-2 rounded-xl bg-white p-2">🔮 Hindsight: {t.hindsight.note}</p>}
        </div>
      );
    }
    case "claims": {
      const s = r as { verdict: string; paidButUndisclosed: string[]; gaps: string[] };
      return (
        <div>
          <p>
            Verdict <strong>{s.verdict}</strong>. Paid posts without disclosure: {s.paidButUndisclosed.length ? s.paidButUndisclosed.join(", ") : "none documented in this cluster"}.
          </p>
          {s.gaps.length > 0 && (
            <>
              <p className="mt-2 font-bold">What the agents could not check</p>
              <ul className="list-disc pl-5">
                {s.gaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      );
    }
  }
}

function Outcome({ run }: { run: CaseRun }) {
  const [check, setCheck] = useState<string | null>(null);
  const [tampered, setTampered] = useState<string | null>(null);
  const j = run.debate.judge;
  const bad = j.verdict === "pump-and-dump";

  const verify = async () => {
    const r = await verifyTrail(run.trail);
    setCheck(r.ok ? `✓ All ${r.count} steps check out. Final fingerprint ${short(r.head)}.` : `✗ Broken at step ${r.seq}: ${r.reason}`);
  };
  const tamper = async () => {
    const copy = run.trail.map((e) => ({ ...e }));
    const target = copy.find((e) => e.agent === "judge") ?? copy[copy.length - 1];
    target.summary = "Verdict: no signal. Nothing to see here.";
    const r = await verifyTrail(copy);
    setTampered(r.ok ? "Hmm, the edit went unnoticed." : `We changed the Judge's verdict to “no signal”. Verification fails at step ${r.seq}: ${r.reason}`);
  };
  const download = () => {
    const blob = new Blob([JSON.stringify({ slug: run.slug, headHash: run.headHash, trail: run.trail }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `canary-${run.slug}-trail.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="mt-5 space-y-4" style={{ animation: "rise .6s var(--ease) both" }}>
      <div className={`card p-5 ${bad ? "border-[var(--alarm)] bg-[var(--alarm-soft)]" : ""}`}>
        <p className="text-xs font-bold uppercase tracking-wider">Verdict</p>
        <p className="font-display text-4xl font-extrabold">{bad ? "🚨 Pump-and-dump" : j.verdict === "suspicious" ? "⚠️ Suspicious" : "No signal"}</p>
        <p className="mt-2 text-[var(--ink-2)]">{j.reasoning}</p>
        <p className="mt-3 text-sm">
          Practice trade: <strong>{run.trade.decision === "refused" ? "refused by Canary's own risk rules" : "accepted (paper only)"}</strong>
          {run.trade.hindsight ? `. ${run.trade.hindsight.note}` : "."}
        </p>
      </div>
      <div className="card p-5">
        <p className="font-display text-xl font-bold">🔏 The agents&apos; notebook</p>
        <p className="mt-1 text-sm text-[var(--ink-2)]">
          {run.trail.length} steps, each sealed with the fingerprint of the one before. Final fingerprint:
          <span className="mt-1 block break-all font-mono text-xs">{run.headHash}</span>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn btn-primary !min-h-[42px] text-sm" onClick={verify}>
            ✓ Verify it in my browser
          </button>
          <button className="btn btn-ghost !min-h-[42px] text-sm" onClick={tamper}>
            🧪 Try to tamper with it
          </button>
          <button className="btn btn-ghost !min-h-[42px] text-sm" onClick={download}>
            ⬇ Download notebook
          </button>
        </div>
        {check && <p className="mt-3 rounded-xl bg-[var(--ok-soft)] p-2 text-sm font-semibold">{check}</p>}
        {tampered && <p className="mt-2 rounded-xl bg-[var(--alarm-soft)] p-2 text-sm font-semibold">{tampered}</p>}
      </div>
      {run.gaps.length > 0 && (
        <details className="card p-5 text-sm">
          <summary className="cursor-pointer font-bold">What the agents couldn&apos;t check ({run.gaps.length})</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--ink-2)]">
            {run.gaps.map((g) => (
              <li key={g.source + g.what}>
                <strong>{g.what}</strong>: {g.reason}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--ink-3)]">Missing data is recorded as a gap and never filled with a guess.</p>
        </details>
      )}
    </div>
  );
}
