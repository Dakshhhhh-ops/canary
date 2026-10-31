import Link from "next/link";
import { notFound } from "next/navigation";
import { CaseRunner } from "@/components/CaseRunner";
import { Footer, Header } from "@/components/Chrome";
import { Guide, type GuideStep } from "@/components/Guide";
import { OnChainPanel } from "@/components/OnChainPanel";
import { CASES, caseMeta, loadCase } from "@/lib/cases";
import type { CaseMeta } from "@/lib/caseIndex";
import { fmtDate, fmtUsd } from "@/lib/format";
import type { PromoterPost } from "@/lib/types";

export const dynamicParams = false;
export function generateStaticParams() {
  return CASES.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const cf = await loadCase(slug);
  return { title: cf ? `${cf.token.name} (${cf.token.symbol}) · Canary case replay` : "Case · Canary" };
}

const PLATFORM: Record<PromoterPost["platform"], string> = { instagram: "Instagram", x: "X (Twitter)", telegram: "Telegram", youtube: "YouTube", tiktok: "TikTok", other: "In public" };

const SEC_TCR = "https://www.sec.gov/tcr";

const stepsFor = (m: CaseMeta | null): GuideStep[] => [
  { id: "summary", mood: "talk", text: `This is a real case from ${m?.year ?? "2021"}. Everything on this page comes from SEC filings, court records, or the blockchain itself.` },
  { id: "posts", mood: "point", text: "These are the promoters' posts, word for word where a regulator or court quoted them. Red means they were paid and didn't properly disclose it." },
  { id: "run", mood: "happy", text: "Now the fun part. Press Run, and my ten agent friends will work through this case one by one. Tap any step to see why." },
  { id: "onchain", mood: "think", text: "Here's how the verdict reaches the blockchain: Chainlink nodes check it independently, then write it where nobody can change it." },
  { id: "legal", mood: "talk", text: m?.legalLine ?? "And this is what happened in the real world afterwards." },
  {
    id: "victim",
    mood: "wave",
    text: m?.victimLine ?? "If you bought this coin back then, the SEC's tip portal is the place to start.",
    cta: m?.hotline ? { label: "Open the hotline", href: "/call" } : { label: "Open the SEC tip portal", href: SEC_TCR },
  },
];

export default async function CasePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const cf = await loadCase(slug);
  if (!cf) notFound();
  // the close before the first paid post is the baseline
  const startIdx = cf.prices.findIndex((p) => p.t === cf.window.pumpStart);
  const rise = cf.prices[Math.max(0, startIdx - 1)];
  const promoters = [...new Set(cf.posts.map((p) => p.promoter))];
  const meta = caseMeta(slug);

  return (
    <Guide intro={{ id: "intro", mood: "wave", text: `Welcome to the ${cf.token.name} case file! Want me to walk you through it?` }} steps={stepsFor(meta)}>
      <Header />
      <main id="main" className="mx-auto max-w-6xl px-4">
        <section data-guide="summary" className="pt-10">
          <Link href="/" className="text-sm font-semibold text-[var(--ink-3)] hover:text-[var(--ink)]">
            ← Canary
          </Link>
          <p className="chip mt-4">Real case · replayed by Canary&apos;s agents</p>
          <h1 className="font-display mt-3 text-4xl font-extrabold leading-tight sm:text-6xl">
            {cf.token.name} <span className="text-[var(--ink-3)]">({cf.token.symbol})</span>, {meta?.year ?? cf.window.pumpStart.slice(0, 4)}
          </h1>
          <p className="mt-4 max-w-3xl text-lg text-[var(--ink-2)] sm:text-xl">{cf.oneLiner}</p>
          <dl className="mt-6 grid gap-3 sm:grid-cols-4">
            <div className="card p-4">
              <dt className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-3)]">Promoters</dt>
              <dd className="font-display text-2xl font-extrabold">{promoters.length}</dd>
              <dd className="text-xs text-[var(--ink-3)]">{promoters.join(", ")}</dd>
            </div>
            <div className="card p-4">
              <dt className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-3)]">Rise to the peak</dt>
              <dd className="font-display text-2xl font-extrabold text-[var(--ok)]">
                {rise?.priceUsd ? `+${Math.round((cf.peak.priceUsd / rise.priceUsd - 1) * 100).toLocaleString("en-US")}%` : "—"}
              </dd>
              <dd className="text-xs text-[var(--ink-3)]">
                {fmtDate(rise?.t ?? cf.window.pumpStart)} close → {fmtDate(cf.peak.t)}
              </dd>
            </div>
            <div className="card border-[var(--alarm)] p-4">
              <dt className="text-xs font-semibold uppercase tracking-wider text-[var(--alarm)]">Fall from the peak</dt>
              <dd className="font-display text-2xl font-extrabold text-[var(--alarm)]">−{Math.round(cf.collapse.dropPct)}%</dd>
              <dd className="text-xs text-[var(--ink-3)]">by {fmtDate(cf.collapse.t)}</dd>
            </div>
            <div className="card p-4">
              <dt className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-3)]">Wallets that bought</dt>
              <dd className="font-display text-2xl font-extrabold">{cf.buyersInWindow ? cf.buyersInWindow.count.toLocaleString() : "—"}</dd>
              <dd className="text-xs text-[var(--ink-3)]">{meta?.buyersLabel ?? "during the promotion, from the blockchain"}</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-[var(--ink-3)]">
            Token{" "}
            <a className="link font-mono" href={`https://etherscan.io/token/${cf.token.address}`} target="_blank" rel="noreferrer">
              {cf.token.address.slice(0, 10)}…
            </a>{" "}
            · trading pool{" "}
            {cf.token.pair && (
              <a className="link font-mono" href={`https://etherscan.io/address/${cf.token.pair}`} target="_blank" rel="noreferrer">
                {cf.token.pair.slice(0, 10)}…
              </a>
            )}{" "}
            · prices are end-of-day readings of that pool, in US dollars via the USDC/ETH pool.
          </p>
        </section>

        <section data-guide="posts" className="pt-16">
          <h2 className="font-display text-3xl font-extrabold sm:text-4xl">What the promoters said</h2>
          <p className="mt-2 max-w-3xl text-[var(--ink-2)]">
            Quoted only where an SEC filing or court record quotes them. Where a source describes a post without quoting it, we say so.
          </p>
          <ul className="mt-6 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {cf.posts.map((p) => (
              <li key={p.id} className={`card flex flex-col p-4 ${p.disclosedPayment === false && p.paid ? "border-[var(--alarm)]" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-display text-lg font-bold">{p.promoter}</p>
                  <span className="chip !text-[0.7rem]">{PLATFORM[p.platform]}</span>
                </div>
                <p className="text-xs text-[var(--ink-3)]">
                  {p.datePrecision === "month" ? new Date(p.postedAt).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) : fmtDate(p.postedAt)}
                  {p.handle ? ` · ${p.handle}` : ""}
                  {p.followers ? ` · ${p.followers >= 1e6 ? `${Math.round(p.followers / 1e6)}M` : p.followers.toLocaleString()} followers` : ""}
                </p>
                {p.text ? (
                  <blockquote className="mt-2 flex-1 font-serif text-lg italic leading-snug">“{p.text.length > 220 ? p.text.slice(0, 220) + "…" : p.text}”</blockquote>
                ) : (
                  <p className="mt-2 flex-1 text-sm text-[var(--ink-3)]">No quote in the sources. See the source for what it describes.</p>
                )}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {p.paid ? (
                    <span className="chip !border-[var(--alarm)] !bg-[var(--alarm-soft)] !text-[0.7rem]">💵 paid {fmtUsd(p.paid.amountUsd, 0)} by {p.paid.by}</span>
                  ) : null}
                  <span className="chip !text-[0.7rem]">
                    {p.disclosedPayment === false ? "⚠️ payment not properly disclosed" : p.disclosedPayment ? "disclosed" : "disclosure unknown"}
                  </span>
                </div>
                <p className="mt-2 text-xs">
                  {p.sources.map((s, i) => (
                    <a key={s.url + i} className="link mr-2" href={s.url} target="_blank" rel="noreferrer">
                      {s.label}
                    </a>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section data-guide="run" className="pt-16">
          <h2 className="font-display text-3xl font-extrabold sm:text-4xl">Watch the agents work</h2>
          <p className="mt-2 max-w-3xl text-[var(--ink-2)]">
            Ten agents, one after another. Each writes its reasoning into a shared notebook, sealed with fingerprints. Tap “Why?” on any step.
          </p>
          <div className="mt-6">
            <CaseRunner data={cf} />
          </div>
        </section>

        <section data-guide="onchain" className="pt-16">
          <h2 className="font-display text-3xl font-extrabold sm:text-4xl">How the verdict gets on the blockchain</h2>
          <p className="mt-2 max-w-3xl text-[var(--ink-2)]">Canary doesn&apos;t just say it. Independent Chainlink nodes check it, then write it down for good.</p>
          <div className="mt-6">
            <OnChainPanel slug={cf.slug} />
          </div>
        </section>

        <section data-guide="legal" className="pt-16">
          <h2 className="font-display text-3xl font-extrabold sm:text-4xl">What happened next</h2>
          <ol className="relative mt-6 space-y-4 border-l-[3px] border-[var(--line-2)] pl-6">
            {[...cf.legal]
              .sort((a, b) => a.date.localeCompare(b.date))
              .map((l) => (
                <li key={l.id} className="relative">
                  <span className="absolute -left-[2.05rem] top-1.5 h-4 w-4 rounded-full border-[3px] border-[var(--ink)] bg-[var(--canary)]" />
                  <p className="text-sm font-semibold text-[var(--ink-3)]">{l.date.length === 7 ? new Date(l.date + "-01T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) : fmtDate(l.date)}</p>
                  <h3 className="font-display text-xl font-bold">{l.title}</h3>
                  <p className="mt-1 max-w-3xl text-[var(--ink-2)]">{l.summary}</p>
                  {l.outcome && <p className="mt-1 max-w-3xl text-sm"><strong>Outcome:</strong> {l.outcome}</p>}
                  {l.statute && <p className="mt-1 text-sm text-[var(--ink-3)]">{l.statute}</p>}
                  <p className="mt-1 text-xs">
                    {l.sources.map((s, i) => (
                      <a key={s.url + i} className="link mr-2" href={s.url} target="_blank" rel="noreferrer">
                        {s.label}
                      </a>
                    ))}
                  </p>
                </li>
              ))}
          </ol>
        </section>

        <section data-guide="victim" className="pt-16">
          <div className="card grid items-center gap-4 bg-[var(--canary)] p-6 sm:p-8 md:grid-cols-[1fr_auto]">
            <div>
              <h2 className="font-display text-3xl font-extrabold">Bought {cf.token.symbol} in {meta?.year ?? cf.window.pumpStart.slice(0, 4)}?</h2>
              {meta?.hotline ? (
                <p className="mt-2 max-w-2xl text-lg">
                  Doki can find your purchase on the blockchain from your wallet address, line it up with these posts, and draft your SEC tip and other complaints.
                  You approve everything before it goes anywhere.
                </p>
              ) : (
                <p className="mt-2 max-w-2xl text-lg">
                  Doki&apos;s hotline walks EMAX buyers through filing today; it doesn&apos;t cover {cf.token.symbol} yet. You can tell the SEC what happened to you through
                  its tip portal, and keep your wallet address and transaction links ready.
                </p>
              )}
            </div>
            {meta?.hotline ? (
              <Link href="/call" className="btn btn-dark text-lg">
                📞 Talk to Doki
              </Link>
            ) : (
              <a href={SEC_TCR} target="_blank" rel="noreferrer" className="btn btn-dark text-lg">
                SEC tip portal ↗
              </a>
            )}
          </div>
        </section>

        <section className="pt-16">
          <details className="card p-5">
            <summary className="cursor-pointer font-display text-xl font-bold">How these numbers were made ({cf.dataNotes.length} notes, {cf.sources.length} sources)</summary>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[var(--ink-2)]">
              {cf.dataNotes.map((n) => (
                <li key={n.slice(0, 40)}>{n}</li>
              ))}
            </ul>
            <p className="mt-4 font-bold">Sources</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
              {cf.sources.map((s) => (
                <li key={s.url}>
                  <a className="link" href={s.url} target="_blank" rel="noreferrer">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-[var(--ink-3)]">
              Rebuild the data yourself: <code className="font-mono">{meta?.rebuild ?? "npx tsx scripts/build-case.mts " + cf.slug}</code>
            </p>
          </details>
        </section>
      </main>
      <Footer />
    </Guide>
  );
}
