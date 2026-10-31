"use client";

// Route-level error boundary: friendly, with a retry and the helplines (someone who lost money may land here mid-call).
import Link from "next/link";
import { useEffect } from "react";
import { Footer, Header } from "@/components/Chrome";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
      <Header />
      <main id="main" className="grain mx-auto grid max-w-3xl place-items-center px-4 py-20 text-center">
        <p className="text-6xl" aria-hidden>
          🐤💫
        </p>
        <h1 className="font-display mt-4 text-4xl font-extrabold">Oops, Doki tripped over something</h1>
        <p className="mt-3 max-w-xl text-lg text-[var(--ink-2)]">
          This part of the page didn&apos;t load. Nothing you typed was sent anywhere. Trying again usually fixes it.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={() => reset()} className="btn btn-primary">
            ↻ Try again
          </button>
          <Link href="/" className="btn btn-ghost">
            Home
          </Link>
          <Link href="/call" className="btn btn-ghost">
            📞 I lost money
          </Link>
        </div>
        <p className="mt-4 max-w-xl break-words font-mono text-xs text-[var(--ink-2)]">
          Detail: {String(error?.message || "unknown").slice(0, 160)}
          {error?.digest ? ` · ${error.digest}` : ""}
        </p>
        <div className="card mt-10 max-w-xl p-5 text-left text-sm">
          <p className="font-bold">Need help right now?</p>
          <p className="mt-1 text-[var(--ink-2)]">
            You can report a crypto scam directly: US{" "}
            <a className="link" href="https://www.ic3.gov" target="_blank" rel="noreferrer">
              FBI IC3
            </a>{" "}
            or{" "}
            <a className="link" href="https://www.sec.gov/tcr" target="_blank" rel="noreferrer">
              SEC tips
            </a>
            , UK{" "}
            <a className="link" href="https://www.reportfraud.police.uk" target="_blank" rel="noreferrer">
              Report Fraud
            </a>
            , India{" "}
            <a className="link" href="https://cybercrime.gov.in" target="_blank" rel="noreferrer">
              cybercrime.gov.in
            </a>{" "}
            or call 1930. More in the footer below.
          </p>
          {error.digest && <p className="mt-3 font-mono text-xs text-[var(--ink-3)]">Error reference: {error.digest}</p>}
        </div>
      </main>
      <Footer />
    </>
  );
}
