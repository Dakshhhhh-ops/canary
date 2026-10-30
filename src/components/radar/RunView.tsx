"use client";

// One radar run, shown the same way whether it just streamed in or was replayed from a saved file:
// what each coin looked like, what the hunter and the judge made of it, and the practice-trade decision
// with every risk check spelled out. Missing numbers say "gap", never a guess.
import { useState } from "react";
import type { LiveRun } from "@/lib/engine/pipeline";
import type { StepEvent } from "@/lib/engine/types";
import { verifyTrail } from "@/lib/engine/trail";
import { fmtUsd } from "@/lib/format";

export type ApiRun = LiveRun & { notes?: string[]; saved?: { file: string; ledgerAdded: number } | { error: string } | null };

export const STEP_ICON: Record<string, string> = { collector: "📡", convergence: "🗣️", news: "📰", hunter: "🔎", collapse: "📉", bull: "🐂", bear: "🐻", judge: "⚖️", risk: "🧮", claims: "📋" };

const FIELD_LABEL: Record<string, string> = { priceUsd: "price", volume24hUsd: "24h volume", liquidityUsd: "pool money", marketCapUsd: "market cap", top10HolderPct: "top-10 holders", safetyScore: "safety score", change24hPct: "24h change" };

/** Compact money for the cards: $900K, $4.2M, $750, $1.25, tiny prices in full. */
const money = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e3) {
    const [u, suffix] = a >= 1e9 ? [1e9, "B"] : a >= 1e6 ? [1e6, "M"] : [1e3, "K"];
    const v = n / u;
    return `$${(Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)).replace(/\.0$/, "")}${suffix}`;
  }
  if (a >= 1) return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
  return fmtUsd(n);
};

const Gap = () => <span className="font-normal text-[var(--ink-3)]">gap</span>;

export function StepList({ steps }: { steps: StepEvent["entry"][] }) {
  return (
    <ol className="space-y-2" aria-live="polite">
      {steps.map((e) => (
        <li key={e.seq} className="card flex items-start gap-3 p-3">
          <span className="text-xl" aria-hidden>
            {STEP_ICON[e.agent] ?? "•"}
          </span>
          <span className="min-w-0 flex-1 break-words text-[var(--ink-2)]">{e.summary}</span>
          <span className="hidden font-mono text-[0.7rem] text-[var(--ink-3)] sm:inline">{e.hash.slice(0, 8)}</span>
        </li>
      ))}
    </ol>
  );
}

function SymbolCard({ run, p }: { run: LiveRun; p: LiveRun["perSymbol"][number] }) {
  const f = run.facts.find((x) => x.symbol === p.symbol);
  const v = [...run.hunter.selected, ...run.hunter.rejected].find((x) => x.symbol === p.symbol);
  const t = p.trade;
  const ok = t.decision === "accepted";
  const plan = t.plan;
  const facts: [string, React.ReactNode][] = [
    ["Price", f?.priceUsd == null ? <Gap /> : money(f.priceUsd)],
    ["Pool money", f?.liquidityUsd == null ? <Gap /> : money(f.liquidityUsd)],
    ["24h volume", f?.volume24hUsd == null ? <Gap /> : money(f.volume24hUsd)],
    ["Top-10 wallets own", f?.top10HolderPct == null ? <Gap /> : `${f.top10HolderPct}%`],
  ];
  if (f?.marketCapUsd != null) facts.push(["Market cap", money(f.marketCapUsd)]);
  if (f?.safetyScore != null) facts.push(["Safety score", `${Math.round(f.safetyScore * 100)} / 100`]);
  if (f?.change24hPct != null) facts.push(["24h change", `${f.change24hPct > 0 ? "+" : ""}${f.change24hPct}%`]);
  return (
    <article className="card min-w-0 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-2xl font-extrabold">{p.symbol}</h3>
        <div className="flex flex-wrap gap-2">
          <span className={`chip ${p.debate.judge.verdict === "pump-and-dump" ? "!border-[var(--alarm)] !text-[var(--alarm)]" : ""}`}>{p.debate.judge.verdict === "no-signal" ? "no fraud signal" : p.debate.judge.verdict}</span>
          <span className={`chip ${ok ? "!border-[var(--ok)] !bg-[var(--ok-soft)] !text-[var(--ok)]" : "!border-[var(--alarm)] !bg-[var(--alarm-soft)] !text-[var(--alarm)]"}`}>{ok ? "✓ practice trade taken" : "✗ trade refused"}</span>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        {facts.map(([k, val]) => (
          <div key={k} className="rounded-xl bg-[var(--paper)] p-2">
            <dt className="text-xs text-[var(--ink-3)]">{k}</dt>
            <dd className="font-bold">{val}</dd>
          </div>
        ))}
      </dl>
      {v && (
        <p className="mt-3 text-sm">
          Token hunter: <strong>{v.score}</strong> of {v.maxScore} red-flag points ({v.selected ? "picked for a closer look" : "not picked"}){v.unknownCount ? `; ${v.unknownCount} of ${v.rules.length} checks had no data` : ""}.
        </p>
      )}
      {plan.entryPriceUsd > 0 && (
        <div className={`mt-3 rounded-xl border-[1.5px] p-3 text-sm ${ok ? "border-[var(--ok)] bg-[var(--ok-soft)]" : "border-[var(--line)] bg-[var(--paper)]"}`}>
          <p className="font-bold">
            {ok ? "Bought (paper)" : "The plan it refused"}: {money(plan.sizeUsd)} at {money(plan.entryPriceUsd)}
          </p>
          <p className="mt-1 text-[var(--ink-2)]">
            Sell to cut the loss at {money(plan.stopPriceUsd)} · take profit at {money(plan.exitPriceUsd)} · worst case {money(t.worstCaseLossUsd)}
          </p>
        </div>
      )}
      <p className="mt-3 text-sm">
        <strong>{ok ? "Why it passed:" : "Why not:"}</strong> {t.reasons[0]}
      </p>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer font-semibold text-[var(--ink-2)]">All {t.checks.length} risk checks{f && Object.keys(f.found).length ? " and where each number came from" : ""}</summary>
        <ul className="mt-2 space-y-1">
          {t.checks.map((c) => (
            <li key={c.limit} className="flex gap-2">
              <span aria-hidden className={c.ok ? "text-[var(--ok)]" : "text-[var(--alarm)]"}>
                {c.ok ? "✓" : "✗"}
              </span>
              <span className="text-[var(--ink-2)]">{c.reason}</span>
            </li>
          ))}
        </ul>
        {f && Object.keys(f.found).length > 0 && (
          <ul className="mt-3 space-y-0.5 border-t border-[var(--line)] pt-2 font-mono text-[0.72rem] text-[var(--ink-3)]">
            {Object.entries(f.found).map(([k, from]) => (
              <li key={k} className="break-all">
                {FIELD_LABEL[k] ?? k} ← {from}
              </li>
            ))}
          </ul>
        )}
      </details>
    </article>
  );
}

export function RunView({ run }: { run: ApiRun }) {
  const [verified, setVerified] = useState<string | null>(null);
  const extraTools = [...run.catalog.safety, ...run.catalog.unknown];
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {run.perSymbol.map((p) => (
          <SymbolCard key={p.symbol} run={run} p={p} />
        ))}
      </div>

      <div className="card p-5 text-sm">
        <p className="font-bold">
          RYO&apos;s tool list{run.catalog.source === "assumed" ? " (not read: assumed the six known tools)" : `, as the server listed it on ${run.catalog.fetchedAt.slice(0, 16).replace("T", " ")} UTC`}
        </p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {run.catalog.tools.map((t) => (
            <li key={t.name} className={`chip font-mono !text-[0.72rem] ${t.known ? "" : "!border-[var(--beak)] !bg-[var(--beak-soft)]"}`} title={t.description ?? undefined}>
              {t.name}
              {!t.known && <span className="font-sans">· new ({t.role === "unknown" ? "kept raw" : t.role})</span>}
            </li>
          ))}
        </ul>
        {(run.catalog.renamed.length > 0 || run.catalog.missingKnown.length > 0 || extraTools.length > 0) && run.catalog.source === "tools/list" && (
          <p className="mt-2 text-[var(--ink-2)]">
            {run.catalog.renamed.map((r) => `${r.from} is now ${r.to}. `)}
            {run.catalog.missingKnown.length > 0 && `No longer listed: ${run.catalog.missingKnown.join(", ")}. `}
            {run.catalog.safety.length > 0 && `${run.catalog.safety.join(", ")} feeds the holder and safety checks. `}
            {run.catalog.unknown.length > 0 && `${run.catalog.unknown.join(", ")}: no job yet, replies kept raw in the notebook.`}
          </p>
        )}
      </div>

      {run.notes && run.notes.length > 0 && <p className="card p-4 text-sm text-[var(--ink-2)]">{run.notes.join(" ")}</p>}

      {run.gaps.length > 0 && (
        <details className="card p-5 text-sm" open={!run.ryo.configured}>
          <summary className="cursor-pointer font-bold">Gaps recorded ({run.gaps.length}): things we tried to learn and could not</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--ink-2)]">
            {run.gaps.slice(0, 30).map((g, i) => (
              <li key={i} className="break-words">
                <strong>{g.what}</strong>: {g.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="card flex flex-wrap items-center gap-3 p-4 text-sm">
        <span className="min-w-0 break-all">
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
  );
}
