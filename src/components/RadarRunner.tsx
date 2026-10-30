"use client";

// Live mode: the same agents on coins trading today, fed by RYO's market tools.
// Missing data shows as a gap with its reason; it is never filled with a guess.
// The one exception to "live" is the clearly-labelled replay of hanko's published fixtures, which is
// recorded sample data, never saved, and never touches the paper ledger.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { StepEvent } from "@/lib/engine/types";
import { DEFAULT_VALUES, limitsQuery, type LimitValues } from "@/lib/radar/limits";
import { useGuide } from "./Guide";
import { LimitsPanel } from "./radar/LimitsPanel";
import { RunView, StepList, type ApiRun } from "./radar/RunView";

const SUGGEST = ["BTC", "ETH", "SOL", "PEPE", "WIF", "BONK", "DOGE"];
const HANKO_URL = "https://github.com/IamHarrie-Labs/hanko/tree/master/fixtures";

type Health = { reachable: boolean; configured: boolean; error: string | null };

export function RadarRunner() {
  const guide = useGuide();
  const router = useRouter();
  const [health, setHealth] = useState<Health | null>(null);
  const [symbols, setSymbols] = useState<string[]>(["ETH", "PEPE"]);
  const [input, setInput] = useState("");
  const [limits, setLimits] = useState<LimitValues>({ ...DEFAULT_VALUES });
  const [save, setSave] = useState(false);
  const [strictHolders, setStrictHolders] = useState(false);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [run, setRun] = useState<ApiRun | null>(null);
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const es = useRef<EventSource | null>(null);

  useEffect(() => {
    fetch("/api/radar?health=1")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ reachable: false, configured: false, error: "unreachable" }));
    return () => es.current?.close();
  }, []);

  const add = (s: string) => {
    const v = s.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12);
    if (v && !symbols.includes(v) && symbols.length < 5) setSymbols([...symbols, v]);
    setInput("");
  };

  const start = (mode: "live" | "replay") => {
    es.current?.close();
    setSteps([]);
    setRun(null);
    setError(null);
    setState("running");
    const qs = mode === "replay" ? `replay=hanko${limitsQuery(limits)}${strictHolders ? "&unknownHolders=refuse" : ""}` : `symbols=${encodeURIComponent(symbols.join(","))}${limitsQuery(limits)}${strictHolders ? "&unknownHolders=refuse" : ""}${save && health?.configured ? "&save=1" : ""}`;
    guide?.say(mode === "replay" ? "Replaying replies that the hanko project recorded and published. This is sample data, not today's market." : `Asking RYO about ${symbols.join(", ")}. If a fact is missing, I'll say so instead of guessing.`, "think");
    const src = new EventSource(`/api/radar?${qs}`);
    es.current = src;
    src.addEventListener("step", (e) => setSteps((s) => [...s, JSON.parse((e as MessageEvent).data)]));
    src.addEventListener("done", (e) => {
      const r = JSON.parse((e as MessageEvent).data) as ApiRun;
      setRun(r);
      setState("done");
      src.close();
      const taken = r.perSymbol.filter((p) => p.trade.decision === "accepted").length;
      const refused = r.perSymbol.length - taken;
      if (r.saved && "file" in r.saved) router.refresh();
      guide?.say(
        r.mode === "recorded-fixture"
          ? `That was hanko's recorded sample, not live data. ${refused} of ${r.perSymbol.length} practice trades refused, each with its reason.`
          : r.ryo.configured
            ? `Done. ${taken} practice trade${taken === 1 ? "" : "s"} taken and ${refused} refused by your risk limits.${r.saved && "file" in r.saved ? " Saved to the record." : ""}`
            : "RYO isn't connected in this copy, so I recorded every missing fact as a gap and refused every practice trade. No guessing!",
        r.ryo.configured ? "happy" : "talk",
      );
    });
    src.addEventListener("error", (e) => {
      const msg = (e as MessageEvent).data ? (JSON.parse((e as MessageEvent).data) as { message?: string }).message : null;
      src.close();
      setError(msg ?? null);
      setState((s) => (s === "running" ? "error" : s));
    });
  };

  const running = state === "running";
  return (
    <div className="space-y-6">
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <span className="text-sm font-bold">RYO market tools:</span>
        {!health ? (
          <span className="chip">checking…</span>
        ) : (
          <>
            <span className={`chip ${health.reachable ? "!border-[var(--ok)] !text-[var(--ok)]" : "!border-[var(--alarm)] !text-[var(--alarm)]"}`}>{health.reachable ? "✓ server online" : "✗ server unreachable"}</span>
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
        {health?.configured && (
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 accent-[var(--beak)]" checked={save} onChange={(e) => setSave(e.target.checked)} />
            <span>Save this run to the record and the paper ledger (an accepted practice trade opens a paper position)</span>
          </label>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className="btn btn-primary" onClick={() => start("live")} disabled={!symbols.length || running}>
            {running ? "Working…" : "▶ Run the agents live"}
          </button>
        </div>
      </div>

      <LimitsPanel values={limits} onChange={setLimits} disabled={running} />
      <label className="card flex cursor-pointer items-start gap-3 p-4 text-sm">
        <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--ink)]" checked={strictHolders} onChange={(e) => setStrictHolders(e.target.checked)} disabled={running} />
        <span>
          <strong>Refuse when nobody knows who holds the coin.</strong> Off by default: then the desk may still trade, but at most half your maximum size,
          and says so. RYO&apos;s tools don&apos;t always report the biggest wallets&apos; share.
        </span>
      </label>

      <div className="card border-dashed p-5">
        <p className="font-display text-lg font-bold">No key yet? See it work on recorded data</p>
        <p className="mt-1 text-sm text-[var(--ink-2)]">
          Replays replies that the open-source{" "}
          <a className="link" href={HANKO_URL} target="_blank" rel="noreferrer">
            hanko project
          </a>{" "}
          recorded and published as test fixtures (MIT licence). The coins are hanko&apos;s placeholders TOKENA, TOKENB and TOKENC, not real ones. Nothing from
          this replay is saved or added to the ledger.
        </p>
        <button className="btn btn-ghost mt-3" onClick={() => start("replay")} disabled={running}>
          Replay a recorded RYO response (from hanko&apos;s public fixtures)
        </button>
      </div>

      {run?.mode === "recorded-fixture" && (
        <p role="note" className="rounded-2xl border-2 border-[var(--ink)] bg-[var(--canary)] p-4 font-bold">
          Recorded sample, not live: every number below comes from hanko&apos;s published fixture files, replayed through Canary&apos;s agents.
        </p>
      )}

      {steps.length > 0 && <StepList steps={steps.map((s) => s.entry)} />}
      {state === "error" && <p className="card border-[var(--alarm)] p-4 text-[var(--alarm)]">{error ?? "The run stopped. Try again in a minute."}</p>}

      {run && (
        <>
          {run.saved && (
            <p className={`card p-4 text-sm ${"file" in run.saved ? "" : "text-[var(--alarm)]"}`}>
              {"file" in run.saved ? (
                <>
                  Saved as <span className="font-mono break-all">{run.saved.file}</span>
                  {run.saved.ledgerAdded ? ` · ${run.saved.ledgerAdded} ledger entries added` : ""}. It now appears under Saved runs below.
                </>
              ) : (
                run.saved.error
              )}
            </p>
          )}
          <RunView run={run} />
        </>
      )}
    </div>
  );
}
