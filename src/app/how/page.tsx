import { Footer, Header } from "@/components/Chrome";
import { Guide, type GuideStep } from "@/components/Guide";

export const metadata = { title: "How it's built · Canary" };

const STEPS: GuideStep[] = [
  { id: "map", mood: "point", text: "Here's the whole machine on one page. Evidence flows down; records flow to the blockchain; victims come in through me." },
  { id: "trust", mood: "think", text: "And here's why you can trust each part, or check it yourself." },
];

function Box({ title, items, tone = "card" }: { title: string; items: string[]; tone?: string }) {
  return (
    <div className={`${tone} p-4`}>
      <p className="font-display text-lg font-bold">{title}</p>
      <ul className="mt-1 space-y-0.5 text-sm text-[var(--ink-2)]">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

const Arrow = ({ label }: { label?: string }) => (
  <div className="flex flex-col items-center py-1 text-[var(--ink-3)]" aria-hidden>
    <span className="text-2xl leading-none">↓</span>
    {label && <span className="text-xs font-semibold">{label}</span>}
  </div>
);

export default function HowPage() {
  return (
    <Guide intro={{ id: "intro", mood: "wave", text: "Curious how Canary is built? I'll show you." }} steps={STEPS}>
      <Header />
      <main id="main" className="mx-auto max-w-6xl px-4 pt-10">
        <h1 className="font-display text-4xl font-extrabold sm:text-6xl">How it&apos;s built</h1>
        <section data-guide="map" className="pt-8">
          <div className="grid gap-3 md:grid-cols-3">
            <Box title="📜 Records" items={["SEC orders (Kardashian, Pierce)", "Court orders (class action)", "Quoted posts, with sources"]} />
            <Box title="⛓️ Ethereum" items={["Uniswap pool events → daily price", "Pool reserves → liquidity", "Buyers' transfers"]} />
            <Box title="📊 RYO tools (live)" items={["analyze_token, deep_analysis", "scan_market, market_overview", "sentiment shifts"]} />
          </div>
          <Arrow label="evidence" />
          <div className="card bg-[var(--canary-soft)] p-4">
            <p className="font-display text-lg font-bold">🤖 Ten agents (Next.js server, TypeScript)</p>
            <p className="mt-1 text-sm text-[var(--ink-2)]">
              Collector → Multi-influencer watcher → News checker → Token hunter → Collapse watcher → Bull ⇄ Bear → Judge → Risk desk → Case summary
            </p>
            <p className="mt-1 text-sm text-[var(--ink-2)]">Every step is appended to a SHA-256 hash-chained notebook. Optional AI writes arguments; a fact guard checks them.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Arrow label="verdict snapshot" />
              <Box
                tone="card border-[var(--sky)]"
                title="🔗 Chainlink CRE workflow"
                items={["Cron every 10 min on a Chainlink network", "HTTP: fetch snapshot, nodes reach consensus", "EVM read: the real pool + ETH/USD feed", "EVM write: alert / collapse report"]}
              />
              <Arrow label="writeReport" />
              <Box tone="card border-[var(--ink)]" title="📒 CanaryRegistry (Sepolia)" items={["AlertRecorded", "CollapseRecorded", "ClaimAnchored (fingerprints only, no personal data)"]} />
            </div>
            <div>
              <Arrow label="victims" />
              <Box
                tone="card border-[var(--beak)]"
                title="🐤 Doki hotline"
                items={["Voice in the browser (or text)", "Finds the purchase on-chain from a wallet", "Matches it to the promoters' posts", "Drafts SEC, FTC, state, FCA documents"]}
              />
              <Arrow label="you approve" />
              <Box tone="card border-[var(--ink)]" title="🧾 Claim pack" items={["Editable documents", "Evidence file + SHA-256", "Anchor the fingerprint on-chain"]} />
            </div>
          </div>
        </section>
        <section data-guide="trust" className="pt-16">
          <h2 className="font-display text-3xl font-extrabold">Why you can check every part</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {[
              ["Data you can rebuild", "scripts/build-emax.mts re-reads the Ethereum logs and recomputes every price and buyer count."],
              ["Same input, same notebook", "The agents use a fixed clock for replays, so anyone gets the same fingerprints."],
              ["No invented facts", "Arguments that cite missing evidence or numbers not in it are thrown out, and the verdict comes from a published rule."],
              ["Gaps, not guesses", "When a source is missing (RYO, holders, posts), it's written down as a gap and the risk desk refuses to trade."],
            ].map(([t, d]) => (
              <div key={t} className="card p-5">
                <h3 className="font-display text-lg font-bold">{t}</h3>
                <p className="mt-1 text-sm text-[var(--ink-2)]">{d}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </Guide>
  );
}
