import Link from "next/link";
import type { CaseFile } from "@/lib/types";
import { PriceChart } from "./PriceChart";
import { caseRange, fmtDate, fmtUsd } from "@/lib/format";

export function CasePreview({ data }: { data: CaseFile | null }) {
  if (!data) {
    return (
      <div className="card p-6 text-[var(--ink-2)]">
        The case file is being rebuilt from public records. <Link className="link" href="/case/emax">Open the case page</Link>.
      </div>
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
      <div className="card p-4 sm:p-6">
        <p className="text-lg text-[var(--ink-2)]">{data.oneLiner}</p>
        <PriceChart className="mt-4" {...caseRange(data.window)} prices={data.prices} posts={data.posts} collapseAt={data.collapse.t} />
        <p className="mt-2 text-xs text-[var(--ink-3)]">Price from on-chain trading data. Hover to read the numbers.</p>
      </div>
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-3">
          <div className="card p-4">
            <dt className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-3)]">Peak</dt>
            <dd className="font-display text-2xl font-extrabold">{fmtUsd(data.peak.priceUsd, 4)}</dd>
            <dd className="text-xs text-[var(--ink-3)]">{fmtDate(data.peak.t)}</dd>
          </div>
          <div className="card border-[var(--alarm)] p-4">
            <dt className="text-xs font-semibold uppercase tracking-wider text-[var(--alarm)]">Fall from peak</dt>
            <dd className="font-display text-2xl font-extrabold text-[var(--alarm)]">−{Math.round(data.collapse.dropPct)}%</dd>
            <dd className="text-xs text-[var(--ink-3)]">by {fmtDate(data.collapse.t)}</dd>
          </div>
          <div className="card p-4">
            <dt className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-3)]">Promoters</dt>
            <dd className="font-display text-2xl font-extrabold">{data.posts.length}</dd>
            <dd className="text-xs text-[var(--ink-3)]">documented posts</dd>
          </div>
          <div className="card p-4">
            <dt className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-3)]">Buyers in the hype</dt>
            <dd className="font-display text-2xl font-extrabold">{data.buyersInWindow ? data.buyersInWindow.count.toLocaleString() : "—"}</dd>
            <dd className="text-xs text-[var(--ink-3)]">wallets, from the blockchain</dd>
          </div>
        </dl>
        <ol className="card divide-y divide-[var(--line)] p-2 text-sm">
          {data.legal.slice(0, 3).map((l) => (
            <li key={l.id} className="p-3">
              <p className="font-bold">{l.title}</p>
              <p className="text-[var(--ink-3)]">{fmtDate(l.date)}</p>
            </li>
          ))}
        </ol>
        <Link href="/case/emax" className="btn btn-primary">
          ▶ Replay it with the agents
        </Link>
      </div>
    </div>
  );
}
