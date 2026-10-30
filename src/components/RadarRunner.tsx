"use client";

// Live mode: the same agents on coins trading today, fed by RYO's market tools.
// Missing data shows as a gap with its reason; it is never filled with a guess.
import { useEffect, useRef, useState } from "react";
import type { LiveRun } from "@/lib/engine/pipeline";
import type { StepEvent } from "@/lib/engine/types";
import { verifyTrail } from "@/lib/engine/trail";
import { fmtUsd } from "@/lib/format";
import { useGuide } from "./Guide";

const ICON: Record<string, string> = { collector: "📡", convergence: "🗣️", news: "📰", hunter: "🔎", collapse: "📉", bull: "🐂", bear: "🐻", judge: "⚖️", risk: "🧮", claims: "📋" };
const SUGGEST = ["PEPE", "WIF", "BONK", "DOGE", "SHIB"];

type Health = { reachable: boolean; configured: boolean; error: string | null };

export function RadarRunner() {
  const guide = useGuide();
  const [health, setHealth] = useState<Health | null>(null);
  const [symbols, setSymbols] = useState<string[]>(["PEPE", "WIF"]);
  const [input, setInput] = useState("");
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [run, setRun] = useState<LiveRun | null>(null);
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [verified, setVerified] = useState<string | null>(null);
  const es = useRef<EventSource | null>(null);

  useEffect(() => {
    fetch("/api/radar?health=1")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ reachable: false, configured: false, error: "unreachable" }));
    return () => es.current?.close();
  }, []);

  const add = (s: string) => {
    const v = s.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (v && !symbols.includes(v) && symbols.length < 5) setSymbols([...symbols, v]);
    setInput("");
  };

  const start = () => {
    es.current?.close();
    setSteps([]);
    setRun(null);
    setVerified(null);
    setState("running");
    guide?.say(`Asking RYO about ${symbols.join(", ")}. If a fact is missing, I'll say so instead of guessing.`, "think");
    const src = new EventSource(`/api/radar?symbols=${encodeURIComponent(symbols.join(","))}`);
    es.current = src;
    src.addEventListener("step", (e) => setSteps((s) => [...s, JSON.parse((e as MessageEvent).data)]));
    src.addEventListener("done", (e) => {
      const r = JSON.parse((e as MessageEvent).data) as LiveRun;
      setRun(r);
      setState("done");
      src.close();
      const refused = r.perSymbol.filter((p) => p.trade.decision === "refused").length;
      guide?.say(
        r.ryo.configured
          ? `Done. ${r.hunter.selected.length} selected for review, and ${refused} practice trade${refused === 1 ? "" : "s"} refused by the risk rules.`
          : "RYO isn't connected in this copy, so I recorded every missing fact as a gap and refused every practice trade. No guessing!",
        r.ryo.configured ? "happy" : "talk",
      );
    });
    src.addEventListener("error", () => {
      src.close();
      setState((s) => (s === "running" ? "error" : s));
    });
  };

  return (
    <div className="space-y-6">
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <span className="text-sm font-bold">RYO market tools:</span>
        {!health ? (
          <span className="chip">checking…</span>
        ) : (
          <>
            <span className={`chip ${health.reachable ? "!border-[var(--ok)] !text-[var(--ok)]" : "!border-[var(--alarm)] !text-[var(--alarm)]"}`}>
              {health.reachable ? "✓ server online" : "✗ server unreachable"}
            </span>
            <span className={`chip ${health.configured ? "!border-[var(--ok)] !text-[var(--ok)]" : ""}`}>{health.configured ? "✓ key configured" : "no key in this copy: facts will show as gaps"}</span>
          </>
        )}
      </div>

      <div className="card p-5">
        <label htmlFor="sym" className="font-display text-lg font-bold">
          Which coins should the agents look at?
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {symbols.map((s) => (
            <button key={s} className="chip !border-[var(--ink)] !bg-[var(--canary-soft)]" onClick={() => setSymbols(symbols.filter((x) => x !== s))} aria-label={`Remove ${s}`}>
              {s} ✕
            </button>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              add(input);
            }}
            className="flex gap-2"
          >
            <input id="sym" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Add a symbol" maxLength={12} className="w-36 rounded-full border-[1.5px] border-[var(--line-2)] bg-white px-3 py-1.5" />
          </form>
        </div>
        <p className="mt-2 text-sm text-[var(--ink-3)]">
          Try:{" "}
          {SUGGEST.filter((s) => !symbols.includes(s)).map((s) => (
            <button key={s} className="link mr-2" onClick={() => add(s)}>
              {s}
            </button>
          ))}
        </p>
        <button className="btn btn-primary mt-4" onClick={start} disabled={!symbols.length || state === "running"}>
          {state === "running" ? "Working…" : "▶ Run the agents live"}
        </button>
      </div>

      {steps.length > 0 && (
        <ol className="space-y-2" aria-live="polite">
          {steps.map((s) => (
            <li key={s.entry.seq} className="card flex items-start gap-3 p-3">
              <span className="text-xl" aria-hidden>
                {ICON[s.step] ?? "•"}
              </span>
              <span className="flex-1 text-[var(--ink-2)]">{s.entry.summary}</span>
              <span className="font-mono text-[0.7rem] text-[var(--ink-3)]">{s.entry.hash.slice(0, 8)}</span>
            </li>
          ))}
        </ol>
      )}
      {state === "error" && <p className="card border-[var(--alarm)] p-4 text-[var(--alarm)]">The live run stopped. Try again in a minute.</p>}

      {run && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {run.perSymbol.map((p) => {
              const f = run.facts.find((x) => x.symbol === p.symbol);
              const v = [...run.hunter.selected, ...run.hunter.rejected].find((x) => x.symbol === p.symbol);
              return (
                <article key={p.symbol} className="card p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-2xl font-extrabold">{p.symbol}</h3>
                    <span className={`chip ${p.debate.judge.verdict === "pump-and-dump" ? "!border-[var(--alarm)] !text-[var(--alarm)]" : ""}`}>{p.debate.judge.verdict}</span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    {(
                      [
                        ["Price", f?.priceUsd],
                        ["Pool money", f?.liquidityUsd],
                        ["24h volume", f?.volume24hUsd],
                        ["Market cap", f?.marketCapUsd],
                      ] as const
                    ).map(([k, val]) => (
                      <div key={k} className="rounded-xl bg-[var(--paper)] p-2">
                        <dt className="text-xs text-[var(--ink-3)]">{k}</dt>
                        <dd className="font-bold">{val == null ? <span className="text-[var(--ink-3)]">gap</span> : fmtUsd(val)}</dd>
                      </div>
                    ))}
                  </dl>
                  {v && (
                    <p className="mt-3 text-sm">
                      Token hunter: <strong>{v.score}</strong> of {v.maxScore} ({v.selected ? "selected" : "rejected"}){v.unknownCount ? `, ${v.unknownCount} rules unchecked for lack of data` : ""}.
                    </p>
                  )}
                  <p className="mt-2 text-sm">
                    Practice trade: <strong>{p.trade.decision}</strong>. {p.trade.reasons[0]}
                  </p>
                </article>
              );
            })}
          </div>
          {run.gaps.length > 0 && (
            <details className="card p-5 text-sm" open={!run.ryo.configured}>
              <summary className="cursor-pointer font-bold">Gaps recorded ({run.gaps.length})</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--ink-2)]">
                {run.gaps.slice(0, 20).map((g, i) => (
                  <li key={i}>
                    <strong>{g.what}</strong>: {g.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="card flex flex-wrap items-center gap-3 p-4 text-sm">
            <span>
              Notebook: {run.trail.length} steps · <span className="font-mono">{run.headHash.slice(0, 16)}…</span>
            </span>
            <button
              className="btn btn-ghost !min-h-[38px] !py-1 text-sm"
              onClick={async () => {
                const r = await verifyTrail(run.trail);
                setVerified(r.ok ? `✓ ${r.count} steps verified in your browser` : `✗ broken at step ${r.seq}`);
              }}
            >
              Verify
            </button>
            {verified && <span className="font-semibold">{verified}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
