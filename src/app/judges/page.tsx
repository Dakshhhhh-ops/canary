import Link from "next/link";
import { Footer, Header } from "@/components/Chrome";
import { Guide, type GuideStep } from "@/components/Guide";
import { registryConfig } from "@/lib/registry";

export const metadata = { title: "For judges · Canary" };
export const dynamic = "force-dynamic";

const STEPS: GuideStep[] = [
  { id: "tour", mood: "happy", text: "Hello, judges! Here's the five-minute path through Canary." },
  { id: "ryo", mood: "point", text: "This maps every direction in the RYO-CHAN Autonomous Agents brief to where it runs, and to the code." },
  { id: "chainlink", mood: "think", text: "And this is the Chainlink CRE workflow: what it reads, what it agrees on, and what it writes." },
  { id: "honest", mood: "talk", text: "Finally, what isn't done or needs keys. I'd rather you hear it from me." },
];

type Row = [string, string, React.ReactNode, string];

export default function JudgesPage() {
  const deployed = Boolean(registryConfig());
  const ryoRows: Row[] = [
    ["Multi-KOL Narrative Agent (spotlight)", "Detects 3+ promoters converging on one token in a window; treats same-payer or copy-paste posts as one voice (echo detection); flags paid-but-undisclosed posts.", <Link key="a" className="link" href="/case/emax">Case replay, step 2</Link>, "src/lib/engine/convergence.ts"],
    ["News Checker", "Each promoter claim is checked against what the price did after it: cause → effect, supported or contradicted, with a 'timing is not causation' note.", <Link key="b" className="link" href="/case/emax">Case replay, step 3</Link>, "src/lib/engine/news.ts"],
    ["Meme / Token Hunter", "Six published numeric rules; every selected AND rejected candidate is explained rule by rule with raw numbers. Missing data = unknown, never guessed.", <Link key="c" className="link" href="/radar">Radar + replay step 4</Link>, "src/lib/engine/hunter.ts"],
    ["Bull / Bear Debate", "Both sides get the identical, hashed evidence bundle. A fact guard drops any claim citing missing evidence or numbers not in it. The Judge's verdict is a published rule; the model only explains it.", <Link key="d" className="link" href="/case/emax">Replay steps 6–8</Link>, "src/lib/engine/debate.ts"],
    ["Buy the Dip", "Entry, size, stop and exit form ONE decision object, evaluated as a whole.", <Link key="e" className="link" href="/case/emax">Replay step 9</Link>, "src/lib/engine/risk.ts (planDip)"],
    ["Practice trades with user risk limits", "Paper ledger with max position, min liquidity, max holder concentration, no undisclosed paid promotion, stop distance and a daily-loss circuit breaker. Refusals are explained; hindsight shows what would have happened.", <Link key="f" className="link" href="/case/emax">Replay step 9</Link>, "src/lib/engine/risk.ts"],
    ["Verifiable reasoning trail", "Every step appends a SHA-256 hash-chained entry over canonical JSON; same input → same trail. Verify or tamper-test it in the browser.", <Link key="g" className="link" href="/verify">/verify</Link>, "src/lib/engine/trail.ts"],
    ["RYO tools", "MCP client (initialize → tools/call, session header, SSE), six tools, request spacing; every failure becomes a recorded gap, never a fake number.", <Link key="h" className="link" href="/radar">/radar</Link>, "src/lib/engine/ryo.ts"],
  ];
  const clRows: Row[] = [
    ["Trigger", "Cron every 10 minutes.", "cre/canary-watch/workflow.yaml", "workflow.ts"],
    ["HTTP capability + consensus", "Fetches Canary's verdict snapshot; nodes must agree on case id, level and trail hash, and take the median of dollar figures.", <a key="s" className="link" href="/api/watch/snapshot" target="_blank" rel="noreferrer">/api/watch/snapshot</a>, "ConsensusAggregationByFields"],
    ["EVM read (Ethereum mainnet)", "Reads the token's Uniswap V2 pool (getReserves, token0, token1) and the Chainlink ETH/USD Data Feed, so the collapse check uses the chain, not Canary's word.", "EMAX pool 0xb6CA…257f", "workflow.ts"],
    ["EVM read (Sepolia)", "statusOf(caseId) on the registry, so old news isn't re-sent.", "CanaryRegistry", "workflow.ts"],
    ["EVM write", "runtime.report → writeReport → forwarder → CanaryRegistry.onReport: an alert (level ≥ 1) and a collapse (pool down ≥ 80%).", deployed ? "Deployed (see case page)" : "Contract ready, not deployed in this copy", "contracts/CanaryRegistry.sol"],
    ["Tests", "11 workflow unit tests (bun test, mocked HTTP/EVM); 14 contract tests on an in-process chain, including the workflow's exact report bytes end to end.", "—", "cre/canary-watch/workflow.test.ts, contracts/test"],
  ];
  return (
    <Guide intro={{ id: "intro", mood: "wave", text: "Hi judges! I'll show you where everything is." }} steps={STEPS}>
      <Header />
      <main id="main" className="mx-auto max-w-6xl px-4 pt-10">
        <h1 className="font-display text-4xl font-extrabold sm:text-6xl">For judges</h1>
        <p className="mt-3 max-w-3xl text-lg text-[var(--ink-2)]">
          Canary is legal tech for crypto&apos;s most common consumer harm: paid promoters pumping a coin without disclosing it. Agents detect it, Chainlink
          records it, and a voice hotline helps victims file. Everything below links to where it runs and where the code is.
        </p>

        <section data-guide="tour" className="pt-10">
          <h2 className="font-display text-3xl font-extrabold">Five minutes</h2>
          <ol className="mt-4 grid gap-3 md:grid-cols-5">
            {[
              ["/", "Home", "Doki explains pump-and-dumps from zero. Try the edit-a-record demo."],
              ["/case/emax", "Real case", "Press Run. Ten agents on SEC- and court-documented EMAX posts and on-chain prices. Tap Why?, then Try to tamper."],
              ["/call?demo=1", "Hotline demo", "A full victim call: Doki finds the purchase on-chain and drafts the SEC tip."],
              ["/verify", "Verify", "Drop the evidence file or notebook. Change one character."],
              ["/radar", "Live radar", "The same agents on today's coins through RYO."],
            ].map(([href, t, d], i) => (
              <li key={href} className="card p-4">
                <span className="step-num">{i + 1}</span>
                <Link href={href} className="font-display mt-2 block text-lg font-bold underline decoration-[var(--canary)] decoration-2 underline-offset-4">
                  {t}
                </Link>
                <p className="mt-1 text-sm text-[var(--ink-2)]">{d}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="pt-14">
          <h2 className="font-display text-3xl font-extrabold">Main track: legal tech</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {[
              ["The law it applies", "Securities Act §17(b) (anti-touting: disclose payment, payer and amount), FTC Endorsement Guides (16 CFR 255). The EMAX case is the SEC's own §17(b) enforcement against Kardashian and Pierce."],
              ["Evidence a court can use", "Facts quoted only from SEC orders and court records; prices rebuilt from Ethereum logs by a re-runnable script; hash-chained notebook; per-victim evidence file with a SHA-256 fingerprint and optional on-chain anchoring."],
              ["Access to justice", "A victim talks instead of filling forms. Doki finds their purchase on-chain, matches it to the promoters' posts, and drafts the SEC tip, FTC report, state regulator note and class-action information. They approve every document."],
            ].map(([t, d]) => (
              <div key={t} className="card p-5">
                <h3 className="font-display text-lg font-bold">{t}</h3>
                <p className="mt-1 text-sm text-[var(--ink-2)]">{d}</p>
              </div>
            ))}
          </div>
        </section>

        <section data-guide="ryo" className="pt-14">
          <h2 className="font-display text-3xl font-extrabold">RYO-CHAN bounty: Autonomous Agents</h2>
          <Table rows={ryoRows} />
        </section>

        <section data-guide="chainlink" className="pt-14">
          <h2 className="font-display text-3xl font-extrabold">Chainlink bounty: Best workflow with CRE</h2>
          <Table rows={clRows} />
          <p className="mt-3 text-sm text-[var(--ink-3)]">Run it: see cre/README.md (cre workflow build, then cre workflow simulate ./canary-watch -T staging-settings).</p>
        </section>

        <section data-guide="honest" className="pt-14">
          <h2 className="font-display text-3xl font-extrabold">Known limits</h2>
          <ul className="mt-4 list-disc space-y-2 pl-6 text-[var(--ink-2)]">
            <li>Live influencer posts need paid X/Telegram access. The replay uses posts quoted in SEC orders and court records; the radar says when posts are missing.</li>
            <li>RYO tools need a hackathon key; without it the radar records every fact as a gap and refuses every practice trade.</li>
            <li>{deployed ? "The registry is deployed on Sepolia." : "The registry contract and CRE workflow are tested and compile, but are not deployed in this copy."}</li>
            <li>EMAX holder concentration is left out: the token reports a total supply smaller than its three largest balances combined.</li>
            <li>Canary is not a law firm. Documents are drafts the victim reviews and sends themselves.</li>
          </ul>
        </section>
      </main>
      <Footer />
    </Guide>
  );
}

function Table({ rows }: { rows: Row[] }) {
  return (
    <div className="card mt-4 overflow-x-auto">
      <table className="w-full min-w-[44rem] text-left text-sm">
        <thead className="bg-[var(--paper-2)] text-xs uppercase tracking-wider text-[var(--ink-3)]">
          <tr>
            <th className="p-3">Requirement</th>
            <th className="p-3">What Canary does</th>
            <th className="p-3">See it</th>
            <th className="p-3">Code</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([req, what, see, code]) => (
            <tr key={req} className="border-t border-[var(--line)] align-top">
              <td className="p-3 font-bold">{req}</td>
              <td className="p-3 text-[var(--ink-2)]">{what}</td>
              <td className="p-3">{see}</td>
              <td className="p-3 font-mono text-xs">{code}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
