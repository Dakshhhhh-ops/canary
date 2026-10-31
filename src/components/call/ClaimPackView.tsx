"use client";

// The claim pack: a checklist of drafted documents, each editable, copyable and downloadable,
// plus the evidence file, its fingerprint, and the optional on-chain anchor. All of it lives in this browser.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { EU_CHOICES, JURISDICTION_LABEL, buildClaimPack, jurisdictionOf, placeFor, withPlace, type Jurisdiction } from "@/lib/claims";
import { claimantRef, evidenceHashHex, newSalt } from "@/lib/claims/claimant";
import { buildClaimPdf, pdfSha256 } from "@/lib/claims/pdf";
import { checkEvidenceFile } from "@/lib/claims/evidence";
import type { ClaimDoc } from "@/lib/claims/types";
import type { DocKind } from "@/lib/hotline/agent";
import { Guide, type GuideStep } from "../Guide";
import { copyText, download, loadClaim, recallFromTab, saveClaim, type AnchorState, type StoredClaim, type VerifyState } from "./claimStore";

const INTRO: GuideStep = {
  id: "intro",
  mood: "happy",
  text: "Here's your claim pack. Work down the list: copy each draft into the official form, and tick it off. Nothing is sent until you send it.",
};

const STEPS: GuideStep[] = [
  { id: "pack-head", mood: "point", text: "Everything here is saved only in this browser. Download the PDF or print it, so you don't lose it." },
  { id: "rules", mood: "talk", text: "Live outside the US? Pick your country's rules here, and I'll redraft for the right regulator." },
  { id: "doc-sec", mood: "talk", text: "Start with the SEC tip. Open the SEC's form, then copy each section into the matching box. Change anything that isn't right." },
  { id: "doc-ftc", mood: "talk", text: "The FTC collects fraud reports for law enforcement. Paste the short answers first, then the details." },
  { id: "doc-state", mood: "talk", text: "Your state has its own securities regulator. NASAA's directory takes you to the right office." },
  { id: "doc-classAction", mood: "think", text: "This explains the class action and whether it may cover you. Only the court decides who's in the class, so check the docket or ask a lawyer." },
  { id: "evidence", mood: "point", text: "Your evidence file holds the facts, the transactions and the sources. Its fingerprint changes if anyone edits a single character." },
  { id: "anchor", mood: "happy", text: "Anchoring writes that fingerprint to a public blockchain, so later you can prove the file existed today, unchanged." },
];

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" });

export function ClaimPackView({ id }: { id: string }) {
  const [claim, setClaim] = useState<StoredClaim | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setClaim(loadClaim(id) ?? recallFromTab(id));
    setLoaded(true);
  }, [id]);

  const update = useCallback((fn: (c: StoredClaim) => StoredClaim) => {
    setClaim((c) => {
      if (!c) return c;
      const next = fn(c);
      saveClaim(next);
      return next;
    });
  }, []);

  if (!loaded) return <div className="mx-auto max-w-4xl px-4 py-24 text-center text-[var(--ink-3)]">Opening your claim pack…</div>;
  if (!claim)
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <p className="text-5xl" aria-hidden>
          🗂️
        </p>
        <h1 className="font-display mt-4 text-3xl font-extrabold">This claim pack isn&apos;t on this device</h1>
        <p className="mt-3 text-[var(--ink-2)]">
          Claim packs are kept only in the browser where they were made. Canary&apos;s servers never had a copy. If you cleared your browser data, or opened
          this link somewhere else, start a new call; it only takes a few minutes.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/call" className="btn btn-primary">
            📞 Start a call
          </Link>
          <Link href="/call?demo=1" className="btn btn-ghost">
            ▶ Watch a demo call
          </Link>
        </div>
      </div>
    );

  const { pack } = claim;
  const docs = pack.docs;
  const filingDocs = docs.filter((d) => d.kind !== "classAction");
  const classDoc = docs.find((d) => d.kind === "classAction");
  const textOf = (d: ClaimDoc) => claim.edits[d.kind] ?? d.body;
  const allText = docs.map((d) => textOf(d)).join("\n\n\n");
  let n = 0;

  return (
    <Guide quiet intro={INTRO} steps={STEPS.filter((s) => !s.id.startsWith("doc-") || docs.some((d) => `doc-${d.kind}` === s.id))}>
      <style>{`@media print { header, footer, aside, .no-print { display: none !important; } .print-only { display: block !important; } body { background: #fff; } }`}</style>
      <main id="main" className="no-print mx-auto max-w-4xl px-4 pb-10 pt-8">
        <section data-guide="pack-head" className="card p-5 sm:p-7">
          <p className="chip !bg-[var(--canary-soft)]">🗂️ Claim pack · {pack.id}</p>
          <h1 className="font-display mt-3 text-3xl font-extrabold sm:text-4xl">Your claim pack</h1>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
            <Fact label="Coin" value={pack.headline.coin} />
            <Fact label="Your loss" value={pack.headline.amount ?? "not given"} />
            <Fact label="Where you live" value={pack.headline.where ?? "not given"} />
            <Fact label="Purchases on-chain" value={String(pack.headline.purchases)} />
          </dl>
          <p className="mt-4 text-sm text-[var(--ink-2)]">Made {fmt(pack.createdAt)}.</p>
          <div className="mt-4 rounded-2xl bg-[var(--paper-2)] p-4 text-sm text-[var(--ink-2)]">
            <p className="font-bold text-[var(--ink)]">🔒 Stored only in this browser</p>
            <p className="mt-1">
              Your name and email were never sent to Canary. This pack lives in this browser&apos;s storage: clearing your browsing data deletes it, so download
              or print what you need. Canary is an information tool, not a law firm, and none of this is legal advice.
            </p>
          </div>
          <RulesPicker claim={claim} onRebuilt={(next) => update(() => next)} />
          <PackDownloads claim={claim} allText={allText} />
        </section>

        <ol className="mt-8 space-y-5" aria-label="Your checklist">
          {filingDocs.map((d) => (
            <DocCard
              key={d.kind}
              n={++n}
              doc={d}
              text={textOf(d)}
              edited={claim.edits[d.kind] != null && claim.edits[d.kind] !== d.body}
              done={Boolean(claim.done[d.kind])}
              onEdit={(t) => update((c) => ({ ...c, edits: { ...c.edits, [d.kind]: t } }))}
              onReset={() => update((c) => ({ ...c, edits: { ...c.edits, [d.kind]: undefined } }))}
              onDone={(v) => update((c) => ({ ...c, done: { ...c.done, [d.kind]: v } }))}
            />
          ))}
          {classDoc && (
            <DocCard
              n={++n}
              doc={classDoc}
              text={textOf(classDoc)}
              edited={claim.edits.classAction != null && claim.edits.classAction !== classDoc.body}
              done={Boolean(claim.done.classAction)}
              onEdit={(t) => update((c) => ({ ...c, edits: { ...c.edits, classAction: t } }))}
              onReset={() => update((c) => ({ ...c, edits: { ...c.edits, classAction: undefined } }))}
              onDone={(v) => update((c) => ({ ...c, done: { ...c.done, classAction: v } }))}
              info
            />
          )}
          <EvidenceCard n={++n} claim={claim} onDone={(v) => update((c) => ({ ...c, done: { ...c.done, evidence: v } }))} />
          <AnchorCard n={++n} claim={claim} onUpdate={update} />
          <VerifyCard claim={claim} onUpdate={update} />
        </ol>

        <section className="card mt-8 border-[var(--alarm)] bg-[var(--alarm-soft)] p-5">
          <h2 className="font-display text-xl font-extrabold">⚠️ Watch out for “recovery” scams</h2>
          <p className="mt-2 text-[var(--ink-2)]">
            After a loss, people often get messages promising to recover their crypto for a fee. Regulators never charge you, and nobody honest will ask for your
            seed phrase, private key or passwords. Don&apos;t pay, and don&apos;t share them.
          </p>
        </section>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/call" className="btn btn-ghost">
            📞 Start another call
          </Link>
          <Link href="/verify" className="btn btn-ghost">
            🔎 Verify a fingerprint
          </Link>
        </div>
      </main>

      {/* print view: every document, as plain text */}
      <div className="print-only hidden px-8 py-6">
        {docs.map((d) => (
          <pre key={d.kind} className="mb-10 whitespace-pre-wrap break-words font-mono text-[11px] leading-snug [page-break-after:always]">
            {textOf(d)}
          </pre>
        ))}
        <pre className="whitespace-pre-wrap break-words font-mono text-[11px]">{`EVIDENCE FILE ${pack.evidence.filename}\nSHA-256 fingerprint: ${pack.evidence.sha256}`}</pre>
      </div>
    </Guide>
  );
}

const CHOICES: Jurisdiction[] = ["US", "UK", "EU", "IN", "other"];

/** Whose rules the drafts follow. Changing it rebuilds the pack in this browser, from the same answers. */
function RulesPicker({ claim, onRebuilt }: { claim: StoredClaim; onRebuilt: (c: StoredClaim) => void }) {
  const [busy, setBusy] = useState(false);
  const input = claim.input;
  const place = input?.facts.place;
  const current = jurisdictionOf(place);
  const locked = Boolean(claim.anchor && claim.anchor.status !== "error" && claim.anchor.status !== "not-configured") || claim.verify?.status === "verified" || claim.verify?.status === "submitted";
  if (!input) return null; // packs made before this feature: nothing to rebuild from
  const rebuild = async (j: Jurisdiction, eu?: string) => {
    const hasEdits = Object.values(claim.edits).some((t) => t != null);
    if (hasEdits && !window.confirm("Redrafting for other rules replaces your edits to the drafts. Continue?")) return;
    setBusy(true);
    try {
      const next = withPlace(input, placeFor(j, place, eu));
      const pack = await buildClaimPack(next);
      onRebuilt({ ...claim, pack, input: next, edits: {}, done: {}, anchor: undefined, verify: undefined });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-guide="rules" className="mt-4 flex flex-wrap items-end gap-3 rounded-2xl border-[1.5px] border-[var(--line)] p-4 text-sm">
      <label className="flex flex-col gap-1 font-semibold">
        Draft for the rules of
        <select
          className="min-h-[44px] rounded-xl border-2 border-[var(--line-2)] bg-[var(--paper)] px-3 font-normal"
          value={current ?? ""}
          disabled={busy || locked}
          onChange={(e) => rebuild(e.target.value as Jurisdiction)}
        >
          {!current && <option value="">Not given (general complaint)</option>}
          {CHOICES.map((j) => (
            <option key={j} value={j}>
              {JURISDICTION_LABEL[j]}
            </option>
          ))}
        </select>
      </label>
      {current === "EU" && (
        <label className="flex flex-col gap-1 font-semibold">
          Country
          <select
            className="min-h-[44px] rounded-xl border-2 border-[var(--line-2)] bg-[var(--paper)] px-3 font-normal"
            value={place?.euState ?? ""}
            disabled={busy || locked}
            onChange={(e) => rebuild("EU", e.target.value)}
          >
            {!place?.euState && <option value="">Choose your country</option>}
            {EU_CHOICES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="min-w-[12rem] flex-1 text-[var(--ink-2)]">
        {locked
          ? "The fingerprint is already on-chain, so this pack stays as it is. Start a new call to draft for other rules."
          : "US, UK (FCA), EU (MiCA, your national regulator) or India (ASCI, cybercrime.gov.in). Changing this redrafts the documents and gives the evidence file a new fingerprint."}
      </p>
    </div>
  );
}

/** Print, the plain-text bundle, and the PDF (built here, in the browser; same pack -> same PDF bytes). */
function PackDownloads({ claim, allText }: { claim: StoredClaim; allText: string }) {
  const { pack } = claim;
  const [pdf, setPdf] = useState<{ pages: number; sha: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const makePdf = async () => {
    setErr(null);
    try {
      const a = claim.anchor;
      const anchor =
        a?.status === "anchored" || a?.status === "submitted" ? { txHash: a.txHash, explorerUrl: a.explorerUrl, network: "Sepolia" } : a?.status === "already-anchored" ? { explorerUrl: a.registryUrl, network: "Sepolia" } : null;
      const { bytes, pages } = buildClaimPdf({ pack, texts: claim.edits, anchor, origin: window.location.origin });
      download(`canary-claim-pack-${pack.id}.pdf`, bytes, "application/pdf");
      setPdf({ pages, sha: await pdfSha256(bytes) });
    } catch {
      setErr("Couldn't build the PDF in this browser. Use Print or the .txt download instead.");
    }
  };
  return (
    <>
      <div className="mt-5 flex flex-wrap gap-2">
        <button className="btn btn-primary" onClick={makePdf}>
          📄 Download PDF
        </button>
        <button className="btn btn-dark" onClick={() => window.print()}>
          🖨️ Print everything
        </button>
        <button className="btn btn-ghost" onClick={() => download(`canary-claim-pack-${pack.id}.txt`, allText)}>
          ⬇ Download all (.txt)
        </button>
      </div>
      <div role="status" aria-live="polite">
        {pdf && (
          <p className="mt-3 rounded-2xl bg-[var(--ok-soft)] p-3 text-sm">
            ✓ PDF saved: {pdf.pages} pages, every one footed with your evidence fingerprint. The PDF&apos;s own SHA-256 is{" "}
            <span className="break-all font-mono text-xs">{pdf.sha}</span>. The same pack always gives the same PDF.
          </p>
        )}
        {err && <p className="mt-3 rounded-2xl bg-[var(--alarm-soft)] p-3 text-sm">{err}</p>}
      </div>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border-[1.5px] border-[var(--line)] bg-[var(--paper)] px-3 py-2">
      <dt className="text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--ink-3)]">{label}</dt>
      <dd className="font-bold break-words">{value}</dd>
    </div>
  );
}

function useFlash() {
  const [msg, setMsg] = useState<string | null>(null);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = (m: string) => {
    setMsg(m);
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => setMsg(null), 2200);
  };
  return [msg, flash] as const;
}

function DocCard(props: {
  n: number;
  doc: ClaimDoc;
  text: string;
  edited: boolean;
  done: boolean;
  info?: boolean;
  onEdit: (t: string) => void;
  onReset: () => void;
  onDone: (v: boolean) => void;
}) {
  const { n, doc, text, edited, done, info } = props;
  const [msg, flash] = useFlash();
  const [open, setOpen] = useState(n === 1);
  const areaId = `doc-${doc.kind}-text`;
  return (
    <li data-guide={`doc-${doc.kind as DocKind}`} className={`card p-5 sm:p-6 ${done ? "!border-[var(--ok)]" : ""}`}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
        <span className="step-num shrink-0" aria-hidden>
          {done ? "✓" : n}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-extrabold sm:text-2xl">
            <span className="sr-only">Step {n}: </span>
            {info ? "Read: " : "Send: "}
            {doc.title}
          </h2>
          <p className="mt-1 text-[var(--ink-2)]">{doc.short}</p>
        </div>
        <label className="chip col-start-2 cursor-pointer select-none justify-self-start sm:col-start-auto">
          <input type="checkbox" className="h-4 w-4 accent-[var(--ok)]" checked={done} onChange={(e) => props.onDone(e.target.checked)} /> {info ? "Read" : "Sent"}
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {doc.destination && (
          <a className="btn btn-primary !min-h-[44px] text-sm" href={doc.destination.url} target="_blank" rel="noreferrer">
            {doc.destination.label} ↗
          </a>
        )}
        <button className="btn btn-ghost !min-h-[44px] text-sm" onClick={async () => flash((await copyText(text)) ? "Copied ✓" : "Couldn't copy: select the text and copy it")}>
          📋 Copy
        </button>
        <button className="btn btn-ghost !min-h-[44px] text-sm" onClick={() => download(doc.filename, text)}>
          ⬇ Download .txt
        </button>
        <button className="btn btn-ghost !min-h-[44px] text-sm" aria-expanded={open} aria-controls={areaId} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide text" : "✏️ Read & edit"}
        </button>
        <span className="self-center text-sm font-semibold text-[var(--ok)]" role="status">
          {msg}
        </span>
      </div>
      {open && (
        <div className="mt-4">
          <label htmlFor={areaId} className="text-sm font-semibold text-[var(--ink-2)]">
            Your draft. Edit anything; changes are saved in this browser.{edited && " (edited)"}
          </label>
          <textarea
            id={areaId}
            value={text}
            onChange={(e) => props.onEdit(e.target.value)}
            rows={16}
            spellCheck
            className="mt-2 w-full resize-y rounded-2xl border-2 border-[var(--line-2)] bg-[var(--paper)] p-3 font-mono text-[0.8rem] leading-relaxed outline-none focus:border-[var(--ink)]"
          />
          {edited && (
            <button className="link mt-1 text-sm" onClick={props.onReset}>
              Undo my edits
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function EvidenceCard({ n, claim, onDone }: { n: number; claim: StoredClaim; onDone: (v: boolean) => void }) {
  const ev = claim.pack.evidence;
  const [check, setCheck] = useState<null | boolean>(null);
  const [msg, flash] = useFlash();
  const done = Boolean(claim.done.evidence);
  return (
    <li data-guide="evidence" className={`card p-5 sm:p-6 ${done ? "!border-[var(--ok)]" : ""}`}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
        <span className="step-num shrink-0" aria-hidden>
          {done ? "✓" : n}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-extrabold sm:text-2xl">Save: your evidence file</h2>
          <p className="mt-1 text-[var(--ink-2)]">
            The facts your documents rely on (case sources, promoter posts, your transactions) in one file. Its SHA-256 fingerprint is quoted in every document.
            Your name and email are not in it.
          </p>
        </div>
        <label className="chip col-start-2 cursor-pointer select-none justify-self-start sm:col-start-auto">
          <input type="checkbox" className="h-4 w-4 accent-[var(--ok)]" checked={done} onChange={(e) => onDone(e.target.checked)} /> Saved
        </label>
      </div>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">Fingerprint (SHA-256)</p>
      <p className="mt-1 break-all rounded-2xl bg-[var(--ink)] px-3 py-2 font-mono text-sm text-[var(--canary)]">{ev.sha256}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn btn-primary !min-h-[44px] text-sm" onClick={() => download(ev.filename, ev.json, "application/json")}>
          ⬇ Download evidence (.json)
        </button>
        <button
          className="btn btn-ghost !min-h-[44px] text-sm"
          onClick={async () => {
            const r = await checkEvidenceFile(ev.json);
            setCheck(r.ok && r.recomputed === ev.sha256);
          }}
        >
          🔁 Re-check the fingerprint
        </button>
        <button className="btn btn-ghost !min-h-[44px] text-sm" onClick={async () => flash((await copyText(ev.sha256)) ? "Copied ✓" : "Couldn't copy")}>
          📋 Copy fingerprint
        </button>
        <Link className="btn btn-ghost !min-h-[44px] text-sm" href="/verify">
          🔎 Verify at /verify
        </Link>
        <span className="self-center text-sm font-semibold text-[var(--ok)]" role="status">
          {msg}
        </span>
      </div>
      {check != null && (
        <p role="status" className={`mt-3 rounded-2xl p-3 text-sm ${check ? "bg-[var(--ok-soft)]" : "bg-[var(--alarm-soft)]"}`}>
          {check ? "✓ Recomputed from the file: the fingerprint matches. The file is unchanged." : "✗ The fingerprint doesn't match. The stored file was changed."}
        </p>
      )}
    </li>
  );
}

function AnchorCard({ n, claim, onUpdate }: { n: number; claim: StoredClaim; onUpdate: (fn: (c: StoredClaim) => StoredClaim) => void }) {
  const [busy, setBusy] = useState(false);
  const a = claim.anchor;
  const done = a?.status === "anchored" || a?.status === "submitted" || a?.status === "already-anchored";
  const run = async () => {
    setBusy(true);
    try {
      const salt = (claim.salt as `0x${string}` | undefined) ?? newSalt();
      const body = { caseSlug: claim.pack.isCase ? claim.pack.caseSlug : "other", evidenceHash: evidenceHashHex(claim.pack.evidence.sha256), claimantRef: claimantRef(salt, claim.pack.evidence.sha256) };
      const res = await fetch("/api/claims/anchor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await res.json()) as AnchorState;
      onUpdate((c) => ({ ...c, salt, anchor: j }));
    } catch {
      onUpdate((c) => ({ ...c, anchor: { status: "error", message: "Couldn't reach the server." } }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li data-guide="anchor" className={`card p-5 sm:p-6 ${done ? "!border-[var(--ok)]" : ""}`}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
        <span className="step-num shrink-0" aria-hidden>
          {done ? "✓" : n}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-extrabold sm:text-2xl">Optional: anchor the fingerprint on the blockchain</h2>
          <p className="mt-1 text-[var(--ink-2)]">
            Canary&apos;s registry contract records your evidence file&apos;s fingerprint with a timestamp, so you can later prove the file existed today, unchanged.
            Only the fingerprint and a salted reference go on-chain; the salt stays in this browser, so nobody can link the record to you.
          </p>
        </div>
      </div>
      <button className="btn btn-dark mt-4 !min-h-[48px]" onClick={run} disabled={busy || done}>
        {busy ? "Anchoring…" : done ? "Anchored ✓" : "⛓️ Anchor my fingerprint"}
      </button>
      <div role="status" aria-live="polite">
        {a?.status === "not-configured" && (
          <div className="mt-4 rounded-2xl bg-[var(--sky-soft)] p-4 text-sm">
            <p className="font-bold">Ready to anchor, but the registry isn&apos;t deployed in this demo.</p>
            <p className="mt-1 text-[var(--ink-2)]">
              Nothing was written. Your request is valid and would call <code className="font-mono">anchorClaim(caseId, evidenceHash, claimantRef)</code> on the
              CanaryRegistry contract on Sepolia once it&apos;s deployed.
            </p>
            <p className="mt-2 break-all font-mono text-xs">caseId {a.caseId}</p>
            <p className="break-all font-mono text-xs">evidenceHash {a.evidenceHash}</p>
          </div>
        )}
        {(a?.status === "anchored" || a?.status === "submitted") && (
          <p className="mt-4 rounded-2xl bg-[var(--ok-soft)] p-4 text-sm">
            {a.status === "anchored" ? "✓ Anchored on Sepolia." : "Sent to Sepolia; confirming."}{" "}
            <a className="link font-mono" href={a.explorerUrl} target="_blank" rel="noreferrer">
              View the transaction ↗
            </a>
          </p>
        )}
        {a?.status === "already-anchored" && (
          <p className="mt-4 rounded-2xl bg-[var(--ok-soft)] p-4 text-sm">
            ✓ This fingerprint was already anchored on {new Date(a.anchoredAt * 1000).toUTCString()}.{" "}
            <a className="link" href={a.registryUrl} target="_blank" rel="noreferrer">
              See the registry ↗
            </a>
          </p>
        )}
        {a?.status === "error" && <p className="mt-4 rounded-2xl bg-[var(--alarm-soft)] p-4 text-sm">The anchor didn&apos;t go through: {a.message}</p>}
      </div>
    </li>
  );
}

type EvPurchases = { address: string; purchases: { blockNumber: number; inClassPeriod: boolean }[] } | null;

/** The Chainlink network confirms the victim's purchases on Ethereum, then records the claim (cre/canary-claims). */
function VerifyCard({ claim, onUpdate }: { claim: StoredClaim; onUpdate: (fn: (c: StoredClaim) => StoredClaim) => void }) {
  const [busy, setBusy] = useState(false);
  let ev: EvPurchases = null;
  try {
    ev = (JSON.parse(claim.pack.evidence.json) as { evidence?: { purchases?: EvPurchases } }).evidence?.purchases ?? null;
  } catch {
    ev = null;
  }
  const blocks = (ev?.purchases ?? []).filter((p) => p.inClassPeriod).map((p) => p.blockNumber);
  const v = claim.verify;
  const sha = claim.pack.evidence.sha256;
  const evidenceHash = evidenceHashHex(sha);

  const send = useCallback(async () => {
    if (!ev) return;
    setBusy(true);
    try {
      const salt = (claim.salt as `0x${string}` | undefined) ?? newSalt();
      const walletSalt = (claim.walletSalt as `0x${string}` | undefined) ?? newSalt();
      const body = { caseSlug: claim.pack.caseSlug, wallet: ev.address, evidenceHash, claimantRef: claimantRef(salt, sha), walletSalt, purchaseBlocks: blocks };
      const res = await fetch("/api/claims/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await res.json()) as VerifyState & Record<string, unknown>;
      onUpdate((c) => ({ ...c, salt, walletSalt, verify: j }));
    } catch {
      onUpdate((c) => ({ ...c, verify: { status: "error", message: "Couldn't reach the server." } }));
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claim.salt, claim.walletSalt, claim.pack.caseSlug, sha]);

  // a deployed workflow answers asynchronously: poll until the record appears
  useEffect(() => {
    if (v?.status !== "submitted") return;
    const id = window.setInterval(async () => {
      const r = await fetch(`/api/claims/verify?caseSlug=${encodeURIComponent(claim.pack.caseSlug)}&evidenceHash=${evidenceHash}`).then((x) => x.json()).catch(() => null);
      if (r?.status === "verified") onUpdate((c) => ({ ...c, verify: r }));
    }, 15000);
    return () => window.clearInterval(id);
  }, [v?.status, claim.pack.caseSlug, evidenceHash, onUpdate]);

  if (!ev || !blocks.length || !claim.pack.isCase) return null;
  const verified = v?.status === "verified";
  return (
    <li data-guide="verify" className={`card p-5 sm:p-6 ${verified ? "!border-[var(--ok)]" : "!border-[var(--sky)]"}`}>
      <h2 className="font-display text-xl font-extrabold sm:text-2xl">Optional: have Chainlink confirm your purchases</h2>
      <p className="mt-1 text-[var(--ink-2)]">
        A Chainlink workflow runs on independent nodes. Each one reads Ethereum itself to confirm that this wallet bought from the {claim.pack.caseSlug.toUpperCase()} pool during
        the class period ({blocks.length} purchase{blocks.length === 1 ? "" : "s"} to check). When they agree, they record your claim as verified. Your wallet address is
        never written on-chain, only a salted fingerprint of it.
      </p>
      <button className="btn btn-primary mt-4 !min-h-[48px]" onClick={send} disabled={busy || verified || v?.status === "submitted"}>
        {busy ? "Asking Chainlink…" : verified ? "Verified ✓" : v?.status === "submitted" ? "Checking…" : "🔗 Verify with Chainlink"}
      </button>
      <div role="status" aria-live="polite">
        {v?.status === "verified" && (
          <p className="mt-4 rounded-2xl bg-[var(--ok-soft)] p-4 text-sm">
            ✓ Verified by Chainlink: {v.purchases} purchase{v.purchases === 1 ? "" : "s"} from the pool during the class period, the first at Ethereum block{" "}
            {v.firstBuyBlock.toLocaleString()}. Recorded {new Date(v.verifiedAt * 1000).toUTCString()}.{" "}
            <a className="link" href={v.registryUrl} target="_blank" rel="noreferrer">
              See the registry ↗
            </a>
          </p>
        )}
        {v?.status === "submitted" && <p className="mt-4 rounded-2xl bg-[var(--sky-soft)] p-4 text-sm">The Chainlink network is checking. This page updates by itself when the record appears.</p>}
        {v?.status === "not-configured" && (
          <div className="mt-4 rounded-2xl bg-[var(--sky-soft)] p-4 text-sm">
            <p className="font-bold">Ready for Chainlink verification. The workflow isn&apos;t deployed to the live Chainlink network in this demo.</p>
            <p className="mt-1 text-[var(--ink-2)]">It runs in Chainlink&apos;s simulator with this exact request:</p>
            <pre tabIndex={0} className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-[var(--ink)] p-3 font-mono text-[0.7rem] text-[var(--canary-soft)]">{v.simulateCommand}</pre>
          </div>
        )}
        {v?.status === "no-purchases" && <p className="mt-4 rounded-2xl bg-[var(--alarm-soft)] p-4 text-sm">{v.message}</p>}
        {v?.status === "error" && <p className="mt-4 rounded-2xl bg-[var(--alarm-soft)] p-4 text-sm">The request didn&apos;t go through: {v.message}</p>}
      </div>
    </li>
  );
}
