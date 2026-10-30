"use client";

// Teaches "tamper-evident" by doing: three linked records; edit one and watch every later link break.
import { useEffect, useState } from "react";

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

const ORIGINAL = [
  "Alert: three promoters pushed the same coin within 48 hours (example)",
  "Judge: pump-and-dump risk. Practice trade refused: paid promotion not disclosed",
  "Collapse: the coin's trading pool lost more than 80% of its money",
];

export function HashDemo() {
  const [rows, setRows] = useState(ORIGINAL);
  const [hashes, setHashes] = useState<string[]>([]);
  const [sealed, setSealed] = useState<string[]>([]);

  // each record's fingerprint covers its text AND the previous fingerprint
  useEffect(() => {
    let alive = true;
    (async () => {
      const out: string[] = [];
      let prev = "0".repeat(64);
      for (const r of rows) {
        prev = await sha256(prev + "|" + r);
        out.push(prev);
      }
      if (alive) {
        setHashes(out);
        setSealed((s) => (s.length ? s : out));
      }
    })();
    return () => {
      alive = false;
    };
  }, [rows]);

  const brokenFrom = hashes.findIndex((h, i) => sealed[i] && h !== sealed[i]);

  return (
    <div className="card p-4 sm:p-6">
      <p className="text-sm text-[var(--ink-2)]">
        Try it: change any word in a record. Its fingerprint changes, and so does every fingerprint after it, because each one includes the
        one before. In Canary, the original fingerprints get written to a blockchain, so an edit like yours can&apos;t hide.
      </p>
      <ol className="mt-4 space-y-3">
        {rows.map((r, i) => {
          const broken = brokenFrom !== -1 && i >= brokenFrom;
          return (
            <li key={i} className={`rounded-2xl border-2 p-3 transition ${broken ? "border-[var(--alarm)] bg-[var(--alarm-soft)]" : "border-[var(--line)] bg-[var(--paper)]"}`}>
              <label className="text-xs font-bold uppercase tracking-wider text-[var(--ink-3)]" htmlFor={`rec-${i}`}>
                Record {i + 1}
              </label>
              <input
                id={`rec-${i}`}
                value={r}
                onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? e.target.value : x)))}
                className="mt-1 w-full rounded-xl border-[1.5px] border-[var(--line-2)] bg-white px-3 py-2 font-medium"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-xs">
                <span className="text-[var(--ink-3)]">fingerprint</span>
                <span className={broken ? "text-[var(--alarm)] line-through" : ""}>{(hashes[i] ?? "").slice(0, 24)}…</span>
                {broken ? (
                  <span className="chip !border-[var(--alarm)] !bg-white !text-[var(--alarm)]">✗ doesn&apos;t match the sealed original</span>
                ) : (
                  <span className="chip !border-[var(--ok)] !bg-white !text-[var(--ok)]">✓ matches the sealed original</span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {brokenFrom !== -1 && (
        <button className="btn btn-ghost mt-4" onClick={() => setRows(ORIGINAL)}>
          ↺ Undo my edits
        </button>
      )}
    </div>
  );
}
