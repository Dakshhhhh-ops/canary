import Link from "next/link";
import { Footer, Header } from "@/components/Chrome";
import { Guide, type GuideStep } from "@/components/Guide";
import { RadarRunner } from "@/components/RadarRunner";
import { LedgerPanel } from "@/components/radar/LedgerPanel";
import type { WatchInfo } from "@/components/radar/RunView";
import { SavedRuns } from "@/components/radar/SavedRuns";
import { listRuns, readLedger } from "@/lib/radar/store";
import { registryConfig } from "@/lib/registry";
import { RADAR_TOKENS, radarCaseId, radarWatch } from "@/lib/watch";

/** Per coin: is it on the Chainlink workflow's watch list (the same rule as /api/watch/snapshot?list=1)? */
async function watchInfo(): Promise<WatchInfo> {
  const { cases, skipped } = await radarWatch().catch(() => ({ cases: [], skipped: [] }));
  const coins: WatchInfo["coins"] = {};
  for (const c of cases) coins[c.symbol] = { watched: true, caseId: c.caseId, run: c.run ?? null, reason: null };
  for (const s of skipped) coins[s.symbol] = { watched: false, caseId: radarCaseId(s.symbol), run: s.run, reason: s.reason };
  return { coins, registry: registryConfig()?.address ?? null };
}

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
  const [{ runs, total }, ledger, watch] = await Promise.all([listRuns(), readLedger(), watchInfo()]);
  const watched = Object.entries(watch.coins).filter(([, b]) => b.watched).map(([s]) => s);
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
            <SavedRuns runs={runs} total={total} watch={watch} />
          </div>
          <div className="card mt-4 p-5 text-sm">
            <h3 className="font-display text-lg font-bold">⛓ Handed to Chainlink</h3>
            <p className="mt-1 text-[var(--ink-2)]">
              When a coin&apos;s latest saved run is flagged (suspicious or worse) and the coin trades in a known Uniswap pool on Ethereum, it joins the{" "}
              <a className="link" href="/api/watch/snapshot?list=1" target="_blank" rel="noreferrer">
                watch list
              </a>{" "}
              next to the EMAX case. Every 10 minutes the Chainlink workflow canary-watch reads that list on several independent computers, checks
              each coin&apos;s pool on Ethereum itself, and writes the alert into the public registry. Coins it can check today:{" "}
              {Object.keys(RADAR_TOKENS).join(", ")}.
            </p>
            <p className="mt-2 font-semibold">
              {watched.length ? `Watched on-chain right now: ${watched.join(", ")}.` : "No radar coin is on the list right now: there is no saved real run that flags one of them."}
            </p>
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
            any other new tool&apos;s replies are kept raw in the notebook. Alongside RYO, each run reads today&apos;s promoter posts from free public
            sources (public Telegram channels and Bluesky search; Reddit and Farcaster when API credentials are set) and the multi-influencer watcher
            counts who is pushing each coin. A source that doesn&apos;t answer is a recorded gap. X (Twitter) needs paid access, so it isn&apos;t read.
          </p>
        </section>
      </main>
      <Footer />
    </Guide>
  );
}
