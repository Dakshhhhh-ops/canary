"use client";

// What Chainlink reads from Canary, and what the blockchain currently holds for this case.
import { useEffect, useState } from "react";
import { fmtUsd } from "@/lib/format";

type Status = {
  snapshot: { caseId: string; symbol: string; token: string; level: number; promoters: number; trailHash: string; liquidityBeforeUsd: number; liquidityNowUsd: number; pair?: string };
  chain:
    | { configured: false }
    | { configured: true; address: string; explorer: string; level: number; trailHash: string; collapsed: boolean; events: { name: string; txHash: string; at: number | null; detail: Record<string, string> }[]; error?: string };
};

const LEVEL = ["no signal", "suspicious", "pump-and-dump", "collapsed"];

export function OnChainPanel({ slug }: { slug: string }) {
  const [s, setS] = useState<Status | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    fetch(`/api/registry/status?case=${slug}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setS)
      .catch(() => setErr(true));
  }, [slug]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 [&>*]:min-w-0">
      {[
        { n: 1, t: "Canary publishes its verdict", d: "The agents' conclusion and the fingerprint of their notebook, at /api/watch/snapshot." },
        { n: 2, t: "Chainlink nodes check it independently", d: "Every 10 minutes, a Chainlink workflow fetches the verdict on many nodes, and reads the coin's trading pool on Ethereum itself, priced with Chainlink's ETH/USD feed." },
        { n: 3, t: "The record is written on-chain", d: "If the nodes agree, they write an alert, and a collapse when the pool lost 80%+, to the CanaryRegistry contract. Nobody can backdate it." },
      ].map((x) => (
        <div key={x.n} className="card p-5">
          <span className="step-num">{x.n}</span>
          <h3 className="font-display mt-2 text-lg font-bold">{x.t}</h3>
          <p className="mt-1 text-sm text-[var(--ink-2)]">{x.d}</p>
        </div>
      ))}
      <div className="card p-5 lg:col-span-2">
        <p className="text-sm font-bold">What Chainlink reads right now</p>
        {s ? (
          <>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-[var(--ink-3)]">Level</dt>
                <dd className="font-bold">
                  {s.snapshot.level} · {LEVEL[s.snapshot.level]}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--ink-3)]">Promoters</dt>
                <dd className="font-bold">{s.snapshot.promoters}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--ink-3)]">Pool at its peak</dt>
                <dd className="font-bold">{fmtUsd(s.snapshot.liquidityBeforeUsd)}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--ink-3)]">Pool, end of file</dt>
                <dd className="font-bold">{fmtUsd(s.snapshot.liquidityNowUsd)}</dd>
              </div>
            </dl>
            <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-[var(--ink)] p-3 text-[0.72rem] leading-relaxed text-[var(--canary-soft)]">{JSON.stringify(s.snapshot, null, 2)}</pre>
            <a className="link mt-2 inline-block text-sm" href={`/api/watch/snapshot?case=${slug}`} target="_blank" rel="noreferrer">
              Open the raw snapshot
            </a>
          </>
        ) : err ? (
          <p className="mt-2 text-sm text-[var(--alarm)]">Couldn&apos;t load the snapshot.</p>
        ) : (
          <p className="mt-2 text-sm text-[var(--ink-3)]">Loading…</p>
        )}
      </div>
      <div className="card p-5">
        <p className="text-sm font-bold">On the blockchain (Sepolia testnet)</p>
        {!s ? (
          <p className="mt-2 text-sm text-[var(--ink-3)]">Checking…</p>
        ) : !s.chain.configured ? (
          <div className="mt-2 text-sm text-[var(--ink-2)]">
            <p>
              The registry contract isn&apos;t deployed in this copy of Canary yet, so nothing has been written. The contract, the workflow and its tests are in the
              repository and ready to deploy.
            </p>
            <p className="mt-2">When it is deployed, this box shows each record with a link to the transaction.</p>
          </div>
        ) : (
          <div className="mt-2 text-sm">
            <p>
              Level on-chain: <strong>{LEVEL[s.chain.level] ?? s.chain.level}</strong>
              {s.chain.collapsed ? " · collapse recorded" : ""}
            </p>
            <p className="mt-1">
              Notebook fingerprint {s.chain.trailHash.toLowerCase() === s.snapshot.trailHash.toLowerCase() ? "✓ matches" : s.chain.level ? "differs from" : "not yet written for"} the agents&apos; run.
            </p>
            <ul className="mt-2 space-y-1">
              {s.chain.events.map((e) => (
                <li key={e.txHash + e.name}>
                  <a className="link" href={`https://sepolia.etherscan.io/tx/${e.txHash}`} target="_blank" rel="noreferrer">
                    {e.name}
                  </a>
                  {e.at ? ` · ${new Date(e.at * 1000).toUTCString().slice(5, 22)} UTC` : ""}
                </li>
              ))}
              {!s.chain.events.length && <li className="text-[var(--ink-3)]">No records for this case yet.</li>}
            </ul>
            <a className="link mt-2 inline-block" href={s.chain.explorer} target="_blank" rel="noreferrer">
              View the contract
            </a>
            {s.chain.error && <p className="mt-1 text-xs text-[var(--alarm)]">Read error: {s.chain.error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
