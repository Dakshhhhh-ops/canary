import Link from "next/link";
import { Footer, Header } from "@/components/Chrome";
import { CASE_INDEX, loadCase } from "@/lib/cases";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Real cases · Canary" };

export default async function CasesPage() {
  const cases = await Promise.all(CASE_INDEX.map(async (m) => ({ m, cf: await loadCase(m.slug) })));
  return (
    <>
      <Header />
      <main id="main" className="mx-auto max-w-6xl px-4 pb-16">
        <section className="pt-10">
          <Link href="/" className="text-sm font-semibold text-[var(--ink-3)] hover:text-[var(--ink)]">
            ← Canary
          </Link>
          <p className="chip mt-4">Real cases · replayed by Canary&apos;s agents</p>
          <h1 className="font-display mt-3 text-4xl font-extrabold leading-tight sm:text-6xl">Two real cases, two kinds of promoter</h1>
          <p className="mt-4 max-w-3xl text-lg text-[var(--ink-2)]">
            The same ten agents run on both. Posts come from SEC filings and court records, quoted word for word; prices and buyers are rebuilt from each coin&apos;s
            trading pool on Ethereum. Nothing is invented: what a source doesn&apos;t say is left out.
          </p>
        </section>
        <ul className="mt-8 grid gap-4 md:grid-cols-2">
          {cases.map(({ m, cf }) => (
            <li key={m.slug} className="card flex flex-col p-5 sm:p-6">
              <p className="text-sm font-semibold text-[var(--ink-3)]">{m.year}</p>
              <h2 className="font-display text-2xl font-extrabold">{m.name}</h2>
              <p className="mt-1 text-sm font-semibold">{m.theory}</p>
              <p className="mt-3 flex-1 text-[var(--ink-2)]">{m.blurb}</p>
              {cf && (
                <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-[var(--ink-3)]">Promoters</dt>
                    <dd className="font-bold">{new Set(cf.posts.map((p) => p.promoter)).size}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--ink-3)]">Peak close</dt>
                    <dd className="font-bold">{fmtDate(cf.peak.t)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--alarm)]">Fall from peak</dt>
                    <dd className="font-bold text-[var(--alarm)]">−{Math.round(cf.collapse.dropPct)}%</dd>
                  </div>
                </dl>
              )}
              <Link href={`/case/${m.slug}`} className="btn btn-primary mt-5 self-start">
                ▶ Replay {m.name.split(" (")[0]}
              </Link>
            </li>
          ))}
        </ul>
      </main>
      <Footer />
    </>
  );
}
