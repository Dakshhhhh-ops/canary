"use client";

// The paper ledger across runs: practice positions opened by accepted trades, marked to market by each
// later run, closed at their stop, take-profit or after 7 days. Its whole history is a hash chain, and
// the numbers shown are re-derived from that chain when you press Verify.
import { useState } from "react";
import { verifyLedger, type LedgerFile } from "@/lib/engine/ledger";
import { fmtDate, fmtUsd } from "@/lib/format";

const money = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtUsd(Math.abs(n))}`;
const tone = (n: number) => (n > 0 ? "text-[var(--ok)]" : n < 0 ? "text-[var(--alarm)]" : "");
const REASON: Record<string, string> = { stop: "hit its stop", "take-profit": "hit take-profit", expiry: "7 days up" };

export function LedgerPanel({ ledger }: { ledger: LedgerFile | null }) {
  const [check, setCheck] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);

  if (!ledger || !ledger.state.runs.length)
    return (
      <div className="card p-5 text-[var(--ink-2)]">
        <p className="font-bold text-[var(--ink)]">The paper ledger is empty.</p>
        <p className="mt-1 text-sm">
          It fills from saved real runs only. Each accepted practice trade opens a paper position here; later runs mark it to RYO&apos;s price and close it at
          its stop, its take-profit, or after 7 days. Nothing is shown until there is something real to show.
        </p>
      </div>
    );

  const s = ledger.state;
  const first = s.runs[0];
  const scheduled = s.runs.filter((r) => r.trigger === "schedule").length;
  const totals: [string, React.ReactNode][] = [
    ["Realised", <span key="r" className={tone(s.totals.realisedUsd)}>{money(s.totals.realisedUsd)}</span>],
    ["On paper now", <span key="u" className={tone(s.totals.unrealisedUsd)}>{money(s.totals.unrealisedUsd)}</span>],
    ["Trades opened", s.totals.opened],
    ["Won / lost", `${s.totals.wins} / ${s.totals.losses}`],
  ];

  return (
    <div className="space-y-4">
      <p className="text-lg">
        Running since <strong>{fmtDate(first.at)}</strong>: <strong>{s.runs.length}</strong> run{s.runs.length === 1 ? "" : "s"}
        {scheduled ? ` (${scheduled} unattended)` : ""}, <strong>{s.totals.opened}</strong> practice trade{s.totals.opened === 1 ? "" : "s"}.
      </p>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {totals.map(([k, v]) => (
          <div key={k} className="card p-4">
            <dt className="text-xs text-[var(--ink-3)]">{k}</dt>
            <dd className="font-display text-2xl font-extrabold">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="card p-5">
        <h3 className="font-display text-xl font-bold">Open positions ({s.positions.length})</h3>
        {s.positions.length ? (
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {s.positions.map((p) => (
              <li key={p.id} className="rounded-xl bg-[var(--paper)] p-3 text-sm">
                <p className="flex flex-wrap justify-between gap-2">
                  <strong className="text-base">{p.symbol}</strong>
                  <span className={`font-bold ${tone(p.unrealisedUsd)}`}>{money(p.unrealisedUsd)}</span>
                </p>
                <p className="mt-1 text-[var(--ink-2)]">
                  {fmtUsd(p.sizeUsd)} bought at {fmtUsd(p.entryPriceUsd)} on {fmtDate(p.openedAt)} · now {fmtUsd(p.lastPriceUsd)}
                </p>
                <p className="text-[var(--ink-3)]">
                  Stop {fmtUsd(p.stopPriceUsd)} · take-profit {fmtUsd(p.takeProfitPriceUsd)} · ends {fmtDate(p.expiresAt)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-[var(--ink-3)]">None open right now.</p>
        )}
      </div>

      <div className="card p-5">
        <h3 className="font-display text-xl font-bold">Closed trades ({s.closed.length})</h3>
        {s.closed.length ? (
          <ul className="mt-3 space-y-2">
            {[...s.closed].reverse().map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl bg-[var(--paper)] p-3 text-sm">
                <strong>{c.symbol}</strong>
                <span className="text-[var(--ink-2)]">
                  {fmtUsd(c.entryPriceUsd)} → {fmtUsd(c.exitPriceUsd)}, {REASON[c.reason]} on {fmtDate(c.closedAt)}
                </span>
                <span className={`ml-auto font-bold ${tone(c.pnlUsd)}`}>{money(c.pnlUsd)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-[var(--ink-3)]">None closed yet.</p>
        )}
      </div>

      <div className="card flex flex-wrap items-center gap-3 p-4 text-sm">
        <span className="min-w-0 break-all">
          Ledger notebook: {ledger.trail.length} entries · <span className="font-mono">{(ledger.trail.at(-1)?.hash ?? "").slice(0, 16)}…</span>
        </span>
        <button
          className="btn btn-ghost !min-h-[38px] !py-1 text-sm"
          onClick={async () => {
            const r = await verifyLedger(ledger);
            setOk(r.ok);
            setCheck(r.ok ? `✓ ${r.entries} entries chain together, and replaying them gives exactly the positions and totals above` : `✗ ${r.reason}`);
          }}
        >
          Verify the ledger
        </button>
        {check && <span className={`font-semibold ${ok ? "" : "text-[var(--alarm)]"}`}>{check}</span>}
      </div>
    </div>
  );
}
