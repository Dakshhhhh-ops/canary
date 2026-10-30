import Link from "next/link";
import { Footer, Header } from "@/components/Chrome";
import { Guide, type GuideStep } from "@/components/Guide";
import { RadarRunner } from "@/components/RadarRunner";

export const metadata = { title: "Live radar · Canary" };

const STEPS: GuideStep[] = [
  { id: "what", mood: "talk", text: "The case replay looks back at 2021. The radar looks at coins trading today, using RYO's market tools." },
  { id: "run", mood: "point", text: "Pick a few coins and press Run. The same agents check them, and the risk desk decides whether it would even touch them with practice money." },
  { id: "tools", mood: "think", text: "These are the six RYO tools my agents can call. When one doesn't answer, I write down a gap instead of making up a number." },
];

const TOOLS = [
  ["market_overview", "The whole market at a glance", "Collector"],
  ["scan_market", "Coins that are moving unusually", "Token hunter"],
  ["analyze_token", "Price, volume, liquidity and holders for one coin", "Token hunter, Risk desk"],
  ["deep_analysis", "A deeper look at one coin", "Bull, Bear"],
  ["compare_tokens", "Side by side", "Judge"],
  ["monitor_market_sentiment_shift", "When the mood suddenly turns", "News checker"],
];

export default function RadarPage() {
  return (
    <Guide intro={{ id: "intro", mood: "wave", text: "This is the live radar. Want me to explain it?" }} steps={STEPS}>
      <Header />
      <main id="main" className="mx-auto max-w-6xl px-4 pt-10">
        <section data-guide="what">
          <p className="chip">
            <span className="live-dot" /> Live mode
          </p>
          <h1 className="font-display mt-3 text-4xl font-extrabold sm:text-6xl">The radar</h1>
          <p className="mt-3 max-w-3xl text-lg text-[var(--ink-2)]">
            The same agents as the <Link className="link" href="/case/emax">case replay</Link>, pointed at coins trading today. Market facts come from RYO&apos;s
            research tools. A practice trade is planned for each coin, and Canary&apos;s own risk rules decide whether to refuse it. Paper money only.
          </p>
        </section>
        <section data-guide="run" className="pt-8">
          <RadarRunner />
        </section>
        <section data-guide="tools" className="pt-16">
          <h2 className="font-display text-3xl font-extrabold">What the agents ask RYO</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TOOLS.map(([t, d, who]) => (
              <li key={t} className="card p-4">
                <p className="font-mono text-sm font-bold">{t}</p>
                <p className="mt-1">{d}</p>
                <p className="mt-1 text-sm text-[var(--ink-3)]">Used by: {who}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 max-w-3xl text-sm text-[var(--ink-3)]">
            Live posts from influencers need paid X or Telegram access, which this copy doesn&apos;t have. The radar says so instead of pretending. The
            multi-influencer check runs on posts you supply, and on documented posts in the case replay.
          </p>
        </section>
      </main>
      <Footer />
    </Guide>
  );
}
