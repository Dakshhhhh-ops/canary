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

/** From /api/onchain (data/onchain.json): what `npm run chain:setup` / `chain:simulate` recorded. */
type Proof =
  | { deployed: false; hasLog: boolean }
  | {
      deployed: true;
      hasLog: boolean;
      registry: string;
      registryUrl: string;
      deployTxUrl: string | null;
      runs: number;
      lastRun: { at: string; workflow: string; target: string; broadcast: boolean; cliVersion: string | null } | null;
      txs: { kind: string; hash: string; at: string; workflow: string; target: string; url: string; status: string | null }[];
    };

const LEVEL = ["no signal", "suspicious", "pump-and-dump", "collapsed"];
const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;
const when = (iso: string) => (iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : "");

export function OnChainPanel({ slug }: { slug: string }) {
  const [s, setS] = useState<Status | null>(null);
  const [err, setErr] = useState(false);
  const [proof, setProof] = useState<Proof | null>(null);
  useEffect(() => {
    fetch(`/api/registry/status?case=${slug}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setS)
      .catch(() => setErr(true));
    fetch("/api/onchain")
      .then((r) => (r.ok ? r.json() : null))
      .then(setProof)
      .catch(() => setProof(null));
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
            <pre tabIndex={0} className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-[var(--ink)] p-3 text-[0.72rem] leading-relaxed text-[var(--canary-soft)]">{JSON.stringify(s.snapshot, null, 2)}</pre>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <a className="link" href={`/api/watch/snapshot?case=${slug}`} target="_blank" rel="noreferrer">
                Open the raw snapshot
              </a>
              <a className="link" href={`/api/notebook/${slug}?download=1`}>
                Download the notebook this fingerprint seals
              </a>
              <a className="link" href="/verify">
                Check it on /verify
              </a>
            </p>
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
        ) : !s.chain.configured && proof?.deployed ? (
          <p className="mt-2 text-sm">
            Registry:{" "}
            <a className="link break-all font-mono text-xs" href={proof.registryUrl} target="_blank" rel="noreferrer">
              {proof.registry}
            </a>
          </p>
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
        {proof?.deployed && (
          <div className="mt-4 border-t border-[var(--line)] pt-3 text-sm">
            <p className="font-bold">Written by the Chainlink workflow</p>
            {proof.txs.length ? (
              <ul className="mt-1 space-y-1">
                {proof.txs.map((t) => (
                  <li key={t.hash} className="min-w-0">
                    <span className="capitalize">{t.kind}</span>
                    {" · "}
                    <a className="link font-mono text-xs" href={t.url} target="_blank" rel="noreferrer">
                      {short(t.hash)}
                    </a>
                    {t.status === "reverted" ? <span className="text-[var(--alarm)]"> · reverted</span> : null}
                    <span className="block text-xs text-[var(--ink-3)]">{when(t.at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[var(--ink-3)]">The registry is deployed; no broadcast run has written to it yet.</p>
            )}
            {proof.lastRun && (
              <p className="mt-2 text-xs text-[var(--ink-3)]">
                {proof.runs} simulator run{proof.runs === 1 ? "" : "s"} recorded · last {when(proof.lastRun.at)}
                {proof.lastRun.cliVersion ? ` · CRE CLI ${proof.lastRun.cliVersion}` : ""}
              </p>
            )}
          </div>
        )}
        {proof?.hasLog && <SimulationLog />}
      </div>
    </div>
  );
}

/** The Chainlink CRE simulator's output (cre/SIMULATION.md), loaded when opened. */
function SimulationLog() {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  return (
    <details
      className="mt-3 text-sm"
      onToggle={(e) => {
        if (!(e.currentTarget as HTMLDetailsElement).open || text !== null) return;
        fetch("/api/onchain?log=1")
          .then((r) => (r.ok ? r.text() : Promise.reject()))
          .then(setText)
          .catch(() => setFailed(true));
      }}
    >
      <summary className="link cursor-pointer font-bold">Chainlink simulation log</summary>
      {failed ? (
        <p className="mt-2 text-[var(--alarm)]">Couldn&apos;t load the log.</p>
      ) : text === null ? (
        <p className="mt-2 text-[var(--ink-3)]">Loading…</p>
      ) : (
        <pre tabIndex={0} className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-[var(--ink)] p-3 text-[0.68rem] leading-relaxed text-[var(--canary-soft)]">{text}</pre>
      )}
      <a className="link mt-1 inline-block text-xs" href="/api/onchain?log=1" target="_blank" rel="noreferrer">
        Open the raw log
      </a>
    </details>
  );
}
