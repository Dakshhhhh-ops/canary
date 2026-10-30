"use client";

// Checks a Canary file in the browser: an evidence file (SHA-256 of its canonical JSON) or an agents' notebook (hash chain).
// Nothing is uploaded; the only network call is an optional on-chain lookup of the fingerprint.
import { useState } from "react";
import { canonical, sha256Hex } from "@/lib/canonical";
import { verifyTrail } from "@/lib/engine/trail";
import type { TrailEntry } from "@/lib/types";
import { useGuide } from "./Guide";

type Result =
  | { kind: "evidence"; ok: boolean; claimed: string; actual: string; caseSlug: string | null; chain?: string }
  | { kind: "trail"; ok: boolean; count: number; head?: string; detail: string; chain?: string }
  | { kind: "unknown"; detail: string };

async function check(text: string): Promise<{ result: Result; parsed: unknown }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { result: { kind: "unknown", detail: "That isn't valid JSON. Canary files are .json files." }, parsed: null };
  }
  const o = parsed as Record<string, unknown>;
  if (o && o.kind === "canary.evidence" && typeof o.sha256 === "string") {
    const actual = await sha256Hex(canonical(o.evidence));
    const ev = o.evidence as Record<string, unknown> | undefined;
    const slug = (ev?.caseSlug as string) ?? ((ev?.case as Record<string, unknown> | undefined)?.slug as string) ?? null;
    return { result: { kind: "evidence", ok: actual === o.sha256.toLowerCase(), claimed: o.sha256, actual, caseSlug: slug }, parsed };
  }
  if (o && Array.isArray(o.trail)) {
    const r = await verifyTrail(o.trail as TrailEntry[]);
    return {
      result: r.ok
        ? { kind: "trail", ok: true, count: r.count, head: r.head, detail: `All ${r.count} steps check out.` }
        : { kind: "trail", ok: false, count: (o.trail as unknown[]).length, detail: `Broken at step ${r.seq}: ${r.reason}` },
      parsed,
    };
  }
  return { result: { kind: "unknown", detail: "This doesn't look like a Canary evidence file or agents' notebook." }, parsed };
}

export function Verifier() {
  const guide = useGuide();
  const [text, setText] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (t: string) => {
    setBusy(true);
    const { result: r } = await check(t);
    if (r.kind === "evidence" && r.ok) {
      const q = await fetch(`/api/registry/claim?case=${encodeURIComponent(r.caseSlug ?? "emax")}&hash=${r.actual}`).then((x) => x.json()).catch(() => null);
      r.chain = !q || !q.configured ? "The on-chain registry isn't deployed in this copy, so only the fingerprint was checked." : q.anchored ? `Anchored on-chain at ${new Date(q.at * 1000).toUTCString()}.` : q.anchored === false ? "Not anchored on-chain yet." : q.error;
    }
    if (r.kind === "trail" && r.ok && r.head) {
      const q = await fetch(`/api/registry/status?case=emax`).then((x) => x.json()).catch(() => null);
      if (q?.chain?.configured && q.chain.level) r.chain = q.chain.trailHash.replace(/^0x/, "") === r.head ? "This notebook's final fingerprint matches the one Chainlink wrote on-chain." : "The on-chain record holds a different notebook fingerprint.";
    }
    setResult(r);
    setBusy(false);
    guide?.say(
      r.kind === "unknown" ? r.detail : r.ok ? "It checks out. Not a single character has changed." : "Something was changed! The fingerprints don't match.",
      r.kind === "unknown" ? "think" : r.ok ? "happy" : "alarm",
    );
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 5_000_000) return setResult({ kind: "unknown", detail: "That file is too large to be a Canary file." });
    const t = await f.text();
    setName(f.name);
    setText(t);
    run(t);
  };

  const tamper = () => {
    // flip one digit or letter somewhere in the middle of the file
    const i = Math.floor(text.length / 2);
    let j = i;
    while (j < text.length && !/[0-9a-z]/i.test(text[j])) j++;
    if (j >= text.length) return;
    const c = text[j];
    const swapped = /[0-9]/.test(c) ? String((Number(c) + 1) % 10) : c === "a" ? "b" : "a";
    const t = text.slice(0, j) + swapped + text.slice(j + 1);
    setText(t);
    setName((n) => (n ? `${n} (edited)` : "edited"));
    run(t);
  };

  const sample = () => {
    setBusy(true);
    const es = new EventSource("/api/case/emax/run?ai=0");
    es.addEventListener("done", (e) => {
      es.close();
      const r = JSON.parse((e as MessageEvent).data);
      const t = JSON.stringify({ slug: r.slug, headHash: r.headHash, trail: r.trail }, null, 2);
      setName("canary-emax-trail.json (sample)");
      setText(t);
      run(t);
    });
    es.addEventListener("error", () => {
      es.close();
      setBusy(false);
    });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
      <div className="card p-5">
        <label
          className="grid min-h-[11rem] cursor-pointer place-items-center rounded-2xl border-[2.5px] border-dashed border-[var(--line-2)] bg-[var(--paper)] p-6 text-center hover:border-[var(--ink)]"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onFile(e.dataTransfer.files[0]);
          }}
        >
          <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          <span>
            <span className="block text-4xl">📄</span>
            <span className="mt-2 block font-display text-lg font-bold">Drop a Canary file here, or tap to choose</span>
            <span className="block text-sm text-[var(--ink-3)]">An evidence file from the hotline, or an agents&apos; notebook. It never leaves your device.</span>
          </span>
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn btn-ghost !min-h-[42px] text-sm" onClick={sample} disabled={busy}>
            Use a sample notebook
          </button>
          {text && (
            <button className="btn btn-ghost !min-h-[42px] text-sm" onClick={tamper} disabled={busy}>
              🧪 Change one character
            </button>
          )}
        </div>
        {name && <p className="mt-3 truncate font-mono text-xs text-[var(--ink-3)]">{name}</p>}
      </div>
      <div className="card p-5" aria-live="polite">
        {!result ? (
          <p className="text-[var(--ink-3)]">{busy ? "Checking…" : "The result appears here."}</p>
        ) : result.kind === "unknown" ? (
          <p className="text-[var(--ink-2)]">{result.detail}</p>
        ) : (
          <div>
            <p className={`font-display text-3xl font-extrabold ${result.ok ? "text-[var(--ok)]" : "text-[var(--alarm)]"}`}>{result.ok ? "✓ Untouched" : "✗ Changed"}</p>
            {result.kind === "evidence" ? (
              <div className="mt-2 space-y-2 text-sm">
                <p>Evidence file. Its fingerprint is recomputed from the content and compared with the one written inside it.</p>
                <p className="break-all font-mono text-xs">
                  written inside: {result.claimed}
                  <br />
                  recomputed: {result.actual}
                </p>
              </div>
            ) : (
              <div className="mt-2 space-y-2 text-sm">
                <p>Agents&apos; notebook. {result.detail}</p>
                {result.head && <p className="break-all font-mono text-xs">final fingerprint {result.head}</p>}
              </div>
            )}
            {result.chain && <p className="mt-3 rounded-xl bg-[var(--paper)] p-2 text-sm">⛓️ {result.chain}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
