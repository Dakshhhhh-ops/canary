import { humanTokens, type PurchaseReport } from "@/lib/hotline/purchases";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const usd = (n: number | null) => (n == null ? "—" : `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;

/** What the blockchain says this wallet bought, with a link for every transaction. */
export function PurchasesCard({ report, live }: { report: PurchaseReport; live: boolean }) {
  const t = report.totals;
  return (
    <section className="card overflow-hidden" aria-labelledby="purchases-title">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b-[1.5px] border-[var(--line)] bg-[var(--canary-soft)] px-4 py-3">
        <h3 id="purchases-title" className="font-display text-lg font-extrabold">
          ⛓️ Found on the blockchain
        </h3>
        <span className={`chip !text-xs ${live ? "!bg-[var(--ok-soft)] !border-[var(--ok)]" : ""}`}>{live ? "Live from Ethereum" : "Saved copy of a live lookup"}</span>
      </div>
      <div className="p-4">
        <p className="text-sm text-[var(--ink-2)]">
          Wallet{" "}
          <a className="link font-mono break-all" href={report.addressUrl} target="_blank" rel="noreferrer">
            {report.address}
          </a>
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
          <Stat label="Purchases" value={String(t.purchases)} />
          <Stat label="≈ Bought, in USD" value={usd(t.boughtUsd)} />
          <Stat label="Right after a post" value={`${t.afterAPost} of ${t.purchases}`} />
          <Stat label="Sold back" value={t.sales ? String(t.sales) : "never"} />
        </dl>
        {report.purchases.length > 0 && (
          <ol className="mt-4 space-y-2">
            {report.purchases.slice(0, 12).map((p, i) => (
              <li key={p.txHash} className="rounded-2xl border-[1.5px] border-[var(--line)] bg-[var(--paper)] p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="font-bold">
                    {i + 1}. {day(p.at)}
                  </span>
                  <span className="text-[var(--ink-2)]">
                    {humanTokens(p.amount)} {report.token.symbol} · <strong className="text-[var(--ink)]">≈ {usd(p.usdEstimate)}</strong>
                  </span>
                </div>
                {p.postsBefore.length > 0 && (
                  <p className="mt-1.5 flex flex-wrap gap-1">
                    {[...new Map(p.postsBefore.map((b) => [b.promoter + b.postedAt, b])).values()].map((b) => (
                      <span key={b.postId} className="chip !border-[var(--beak)] !bg-[var(--beak-soft)] !text-[0.72rem]">
                        📣 {b.promoter}, {b.daysBefore === 0 ? "same day" : `${b.daysBefore}d before`}
                      </span>
                    ))}
                  </p>
                )}
                <a className="link mt-1.5 inline-block font-mono text-xs" href={p.txUrl} target="_blank" rel="noreferrer" aria-label={`Transaction ${p.txHash} on Etherscan`}>
                  tx {short(p.txHash)} ↗
                </a>
              </li>
            ))}
          </ol>
        )}
        {report.purchases.length > 12 && <p className="mt-2 text-xs text-[var(--ink-3)]">…and {report.purchases.length - 12} more in your evidence file.</p>}
        <details className="mt-3 text-xs text-[var(--ink-2)]">
          <summary className="cursor-pointer font-semibold">How this was checked, and its limits</summary>
          <p className="mt-2">{report.method}</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {report.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[var(--paper-2)] px-2 py-2">
      <dt className="text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--ink-3)]">{label}</dt>
      <dd className="font-display text-xl font-extrabold">{value}</dd>
    </div>
  );
}
