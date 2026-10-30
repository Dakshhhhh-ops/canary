"use client";

// Saved real runs, replayable with no key: the steps, each coin's facts and decisions, and a check
// that runs in your browser — the notebook's hash chain, and every raw RYO reply against the hash the
// notebook recorded when it arrived.
import { useState } from "react";
import { fmtDate } from "@/lib/format";
import { verifySavedRun, type SavedRun, type SavedRunCheck, type SavedRunSummary } from "@/lib/radar/saved";
import { RunView, StepList } from "./RunView";

const when = (iso: string) => `${fmtDate(iso)}, ${iso.slice(11, 16)} UTC`;
const TRIGGER: Record<string, string> = { schedule: "on schedule", manual: "started by hand", ui: "from this page", local: "from a laptop" };

export function SavedRuns({ runs, total }: { runs: SavedRunSummary[]; total: number }) {
  const [open, setOpen] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [check, setCheck] = useState<SavedRunCheck | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async (file: string) => {
    if (open === file) {
      setOpen(null);
      return;
    }
    setOpen(file);
    setSaved(null);
    setCheck(null);
    setErr(null);
    setLoading(true);
    try {
      const r = await fetch(`/api/radar?run=${encodeURIComponent(file)}`);
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
      setSaved((await r.json()) as SavedRun);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "could not load the run");
    } finally {
      setLoading(false);
    }
  };

  if (!runs.length)
    return (
      <div className="card p-5 text-[var(--ink-2)]">
        <p className="font-bold text-[var(--ink)]">No saved runs yet.</p>
        <p className="mt-1 text-sm">
          A run is saved only when RYO really answered. Until this copy has a RYO key, there is nothing real to keep, so this list stays empty rather than
          filled with made-up data. Once the key is in, the scheduled runner adds one every four hours.
        </p>
      </div>
    );

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {runs.map((r) => (
          <li key={r.file} className="card p-4">
            <button className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 text-left" onClick={() => load(r.file)} aria-expanded={open === r.file}>
              <span className="font-display text-lg font-bold">{when(r.startedAt)}</span>
              <span className="text-sm text-[var(--ink-2)]">{r.symbols.join(", ")}</span>
              <span className="chip">{TRIGGER[r.trigger] ?? r.trigger}</span>
              <span className="chip">
                RYO {r.callsOk}/{r.calls} answered
              </span>
              <span className={`chip ${r.accepted.length ? "!border-[var(--ok)] !text-[var(--ok)]" : ""}`}>
                {r.accepted.length ? `took ${r.accepted.join(", ")}` : "no trade taken"} · {r.refused} refused
              </span>
              <span className="ml-auto text-sm font-bold">{open === r.file ? "Close ▲" : "Replay ▼"}</span>
            </button>
            {open === r.file && (
              <div className="mt-4 space-y-4 border-t border-[var(--line)] pt-4">
                {loading && <p className="text-sm">Loading the saved run…</p>}
                {err && <p className="text-sm text-[var(--alarm)]">{err}</p>}
                {saved && (
                  <>
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <button
                        className="btn btn-dark !min-h-[40px] !py-1 text-sm"
                        onClick={async () => setCheck(await verifySavedRun(saved))}
                      >
                        Verify this run in your browser
                      </button>
                      <a className="link" href={`/api/radar?run=${encodeURIComponent(r.file)}`} target="_blank" rel="noreferrer">
                        Raw file ({saved.rawRyo.length} RYO replies)
                      </a>
                      <span className="text-[var(--ink-3)]">{saved.appVersion}</span>
                    </div>
                    {check && (
                      <p className={`rounded-xl border-2 p-3 text-sm font-semibold ${check.ok ? "border-[var(--ok)] bg-[var(--ok-soft)]" : "border-[var(--alarm)] bg-[var(--alarm-soft)]"}`}>
                        {check.ok
                          ? `✓ All ${check.steps} notebook steps chain together, and all ${check.rawChecked} raw RYO replies match the fingerprints recorded when they arrived.`
                          : `✗ ${check.problems.join(" ")}`}
                      </p>
                    )}
                    <details className="text-sm">
                      <summary className="cursor-pointer font-bold">The notebook, step by step ({saved.run.trail.length})</summary>
                      <div className="mt-3">
                        <StepList steps={saved.run.trail} />
                      </div>
                    </details>
                    <RunView run={saved.run} />
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {total > runs.length && <p className="text-sm text-[var(--ink-3)]">Showing the newest {runs.length} of {total} saved runs. All of them are in data/radar/runs.</p>}
    </div>
  );
}
