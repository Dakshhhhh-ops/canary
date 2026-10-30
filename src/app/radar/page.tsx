import Link from "next/link";
import { Footer, Header } from "@/components/Chrome";
import { Guide, type GuideStep } from "@/components/Guide";
import { RadarRunner } from "@/components/RadarRunner";
import { LedgerPanel } from "@/components/radar/LedgerPanel";
import { SavedRuns } from "@/components/radar/SavedRuns";
import { listRuns, readLedger } from "@/lib/radar/store";

export const metadata = { title: "Live radar · Canary" };
// saved runs and the ledger change on disk between visits
export const dynamic = "force-dynamic";

const STEPS: GuideStep[] = [
  { id: "what", mood: "talk", text: "The case replay looks back at 2021. The radar looks at coins trading today, using RYO's market tools." },
  { id: "run", mood: "point", text: "Pick a few coins and press Run. The same agents check them, and the risk desk decides whether it would even touch them with practice money. You can tighten or loosen its limits." },
  { id: "saved", mood: "think", text: "Every real run is saved with RYO's exact replies. Open one and press Verify: your browser re-checks the whole notebook, no key needed." },
  { id: "ledger", mood: "talk", text: "Practice trades the desk accepts go into this paper ledger. Later runs mark them to the market and close them at the stop, the take-profit, or after a week." },
  { id: "tools", mood: "think", text: "These are the RYO tools my agents call. When one doesn't answer, I write down a gap instead of making up a number." },
];

const TOOLS = [
  ["market_overview", "The whole market at a glance", "Collector"],
  ["scan_market", "Coins that are moving unusually", "Token hunter"],
  ["analyze_token", "Price and volume for one coin", "Token hunter, Risk desk"],
  ["deep_analysis", "A deeper look at one coin, including its trading pools", "Risk desk, Bull, Bear"],
  ["compare_tokens", "Side by side", "Judge"],
  ["monitor_market_sentiment_shift", "When the mood suddenly turns", "News checker"],
];

export default async function RadarPage() {
  const [{ runs, total }, ledger] = await Promise.all([listRuns(), readLedger()]);
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
            research tools. A practice trade is planned for each coin, and your risk limits decide whether to take it or refuse it. Paper money only.
          </p>
        </section>
        <section data-guide="run" className="pt-8">
          <RadarRunner />
        </section>
        <section data-guide="saved" className="pt-16">
          <h2 className="font-display text-3xl font-extrabold">Saved runs</h2>
          <p className="mt-2 max-w-3xl text-[var(--ink-2)]">
            Real runs, kept with every reply RYO sent. Replay any of them and check it yourself, even if no key is configured here.
          </p>
          <div className="mt-4">
            <SavedRuns runs={runs} total={total} />
          </div>
        </section>
        <section data-guide="ledger" className="pt-16">
          <h2 className="font-display text-3xl font-extrabold">The paper ledger</h2>
          <p className="mt-2 max-w-3xl text-[var(--ink-2)]">Practice money only. Every change below is a step in its own tamper-evident notebook.</p>
          <div className="mt-4">
            <LedgerPanel ledger={ledger} />
          </div>
        </section>
        <section data-guide="tools" className="pt-16">
          <h2 className="font-display text-3xl font-extrabold">What the agents ask RYO</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TOOLS.map(([t, d, who]) => (
              <li key={t} className="card p-4">
                <p className="font-mono text-sm font-bold break-all">{t}</p>
                <p className="mt-1">{d}</p>
                <p className="mt-1 text-sm text-[var(--ink-3)]">Used by: {who}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 max-w-3xl text-sm text-[var(--ink-3)]">
            Each run first asks RYO for its current tool list. A renamed tool is matched to its job, a new holder or safety tool feeds the holder check, and
            any other new tool&apos;s replies are kept raw in the notebook. Live posts from influencers need paid X or Telegram access, which this copy
            doesn&apos;t have; the multi-influencer check runs on posts you supply, and on documented posts in the case replay.
          </p>
        </section>
      </main>
      <Footer />
    </Guide>
  );
}
