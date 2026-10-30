import Link from "next/link";
import { Footer, Header } from "@/components/Chrome";
import { Guide, type GuideStep } from "@/components/Guide";
import { registryConfig } from "@/lib/registry";
import { ETHERSCAN, loadOnchain, loadSimulationLog, onchainTxs, type Onchain } from "@/lib/onchain";

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
  // data/onchain.json and cre/SIMULATION.md are written by `npm run chain:setup` / `npm run chain:simulate`
  const onchain = loadOnchain();
  const simLog = loadSimulationLog();
  const txs = onchain ? onchainTxs(onchain) : [];
  const deployed = Boolean(onchain || registryConfig());
  const registryLink = onchain ? (
    <a key="reg" className="link font-mono text-xs" href={`${ETHERSCAN}/address/${onchain.registry}`} target="_blank" rel="noreferrer">
      {short(onchain.registry)}
    </a>
  ) : null;
  const evmWriteSee: React.ReactNode = txs.length ? (
    <ul key="w" className="space-y-1">
      {txs.map((t) => (
        <li key={t.hash}>
          <a className="link" href={t.url} target="_blank" rel="noreferrer">
            {t.kind} tx {short(t.hash)}
          </a>
        </li>
      ))}
      <li className="text-xs text-[var(--ink-3)]">Registry {registryLink}</li>
    </ul>
  ) : onchain ? (
    <span key="w">Registry deployed ({registryLink}); no broadcast run yet</span>
  ) : deployed ? (
    "Deployed (see case page)"
  ) : (
    "Contract ready, not deployed in this copy"
  );
  const writeLimit = txs.length
    ? "The registry is deployed on Sepolia and the workflow's reports reached it with cre workflow simulate --broadcast, through Chainlink's simulation MockKeystoneForwarder (which checks no DON signatures). The workflow is not deployed to a live Chainlink DON: that needs deploy access from Chainlink, and then a switch to the KeystoneForwarder."
    : onchain
      ? "The registry is deployed on Sepolia, but no broadcast simulation has written to it yet."
      : deployed
        ? "The registry is deployed on Sepolia."
        : "The registry contract and CRE workflow are tested and compile, but are not deployed in this copy.";
  const ryoRows: Row[] = [
    ["Multi-KOL Narrative Agent (spotlight)", "Detects 3+ promoters converging on one token in a window; treats same-payer or copy-paste posts as one voice (echo detection); flags paid-but-undisclosed posts.", <Link key="a" className="link" href="/case/emax">Case replay, step 2</Link>, "src/lib/engine/convergence.ts"],
    ["News Checker", "Each promoter claim is checked against what the price did after it: cause → effect, supported or contradicted, with a 'timing is not causation' note.", <Link key="b" className="link" href="/case/emax">Case replay, step 3</Link>, "src/lib/engine/news.ts"],
    ["Meme / Token Hunter", "Six published numeric rules; every selected AND rejected candidate is explained rule by rule with raw numbers. Missing data = unknown, never guessed.", <Link key="c" className="link" href="/radar">Radar + replay step 4</Link>, "src/lib/engine/hunter.ts"],
    ["Bull / Bear Debate", "Both sides get the identical, hashed evidence bundle. A fact guard drops any claim citing missing evidence or numbers not in it. The Judge's verdict is a published rule; the model only explains it.", <Link key="d" className="link" href="/case/emax">Replay steps 6–8</Link>, "src/lib/engine/debate.ts"],
    ["Buy the Dip", "Entry, size, stop and exit form ONE decision object, evaluated as a whole.", <Link key="e" className="link" href="/case/emax">Replay step 9</Link>, "src/lib/engine/risk.ts (planDip)"],
    ["Practice trades with user risk limits", "Paper ledger with max position, min liquidity, max holder concentration, no undisclosed paid promotion, stop distance and a daily-loss circuit breaker. Refusals are explained; hindsight shows what would have happened.", <Link key="f" className="link" href="/case/emax">Replay step 9</Link>, "src/lib/engine/risk.ts"],
    ["Verifiable reasoning trail", "Every step appends a SHA-256 hash-chained entry over canonical JSON; same input → same trail. Verify or tamper-test it in the browser.", <Link key="g" className="link" href="/verify">/verify</Link>, "src/lib/engine/trail.ts"],
    ["RYO tools", "MCP client (initialize → tools/list → tools/call, session header, SSE). Reads RYO's live tool catalog each run: renamed tools keep their job, a new holder or safety tool feeds the holder check, anything else is kept raw in the notebook. Every failure is a recorded gap, never a fake number.", <Link key="h" className="link" href="/radar">/radar</Link>, "src/lib/engine/ryo.ts"],
    ["Replayable real runs", "Each live run is saved with every raw RYO reply and its SHA-256; anyone can replay and verify a run in the browser, with no key, even after the key expires.", <Link key="i" className="link" href="/radar">/radar · Saved runs</Link>, "src/lib/radar/store.ts, saved.ts"],
    ["Paper ledger, running unattended", "Accepted practice trades open positions that later runs mark to RYO's price and close at stop, take-profit or 7 days. Every ledger change is hash-chained. A scheduled job runs the radar every 4 hours.", <Link key="j" className="link" href="/radar">/radar · Ledger</Link>, "src/lib/engine/ledger.ts, .github/workflows/radar.yml"],
  ];
  const clRows: Row[] = [
    ["Trigger", "Cron every 10 minutes.", "cre/canary-watch/workflow.yaml", "workflow.ts"],
    ["HTTP capability + consensus", "Fetches Canary's verdict snapshot; nodes must agree on case id, level and trail hash, and take the median of dollar figures.", <a key="s" className="link" href="/api/watch/snapshot" target="_blank" rel="noreferrer">/api/watch/snapshot</a>, "ConsensusAggregationByFields"],
    ["EVM read (Ethereum mainnet)", "Reads the token's Uniswap V2 pool (getReserves, token0, token1) and the Chainlink ETH/USD Data Feed, so the collapse check uses the chain, not Canary's word.", "EMAX pool 0xb6CA…257f", "workflow.ts"],
    ["EVM read (Sepolia)", "statusOf(caseId) on the registry, so old news isn't re-sent.", "CanaryRegistry", "workflow.ts"],
    ["EVM write", "runtime.report → writeReport → forwarder → CanaryRegistry.onReport: an alert (level ≥ 1) and a collapse (pool down ≥ 80%).", evmWriteSee, "contracts/CanaryRegistry.sol"],
    ["Second workflow: victims' claims", "An HTTP trigger sends a claim; nodes read Ethereum mainnet logs (filterLogs) to confirm the wallet bought from the EMAX pool during the class period, agree, then write ClaimVerified. The wallet is stored only as a salted hash.", <Link key="k" className="link" href="/call?demo=1">Hotline → claim pack</Link>, "cre/canary-claims/"],
    ["Tests", "canary-watch: 11 workflow tests; canary-claims: 19 workflow tests replaying a real buyer's mainnet logs; 18 contract tests on an in-process chain, including each workflow's exact report bytes end to end.", "—", "cre/*/workflow.test.ts, contracts/test"],
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

          <div className="card mt-6 p-5">
            <h3 className="font-display text-xl font-bold">Proof it ran</h3>
            {onchain ? (
              <>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                  <div className="min-w-0">
                    <dt className="text-xs text-[var(--ink-3)]">CanaryRegistry on Sepolia</dt>
                    <dd className="break-all">
                      <a className="link font-mono text-xs" href={`${ETHERSCAN}/address/${onchain.registry}`} target="_blank" rel="noreferrer">
                        {onchain.registry}
                      </a>
                      {onchain.deployTx && (
                        <>
                          {" · "}
                          <a className="link text-xs" href={`${ETHERSCAN}/tx/${onchain.deployTx}`} target="_blank" rel="noreferrer">
                            deploy tx
                          </a>
                        </>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--ink-3)]">Simulator runs recorded</dt>
                    <dd className="font-bold">
                      {onchain.simulations.length} ({onchain.simulations.filter((r) => r.broadcast).length} with --broadcast)
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--ink-3)]">Last run</dt>
                    <dd>{lastRunText(onchain)}</dd>
                  </div>
                </dl>
                <p className="mt-4 text-sm font-bold">Transactions the workflow wrote</p>
                {txs.length ? (
                  <ul className="mt-1 space-y-1 text-sm">
                    {txs.map((t) => (
                      <li key={t.hash} className="break-all">
                        <span className="font-bold capitalize">{t.kind}</span>
                        {" · "}
                        <a className="link font-mono text-xs" href={t.url} target="_blank" rel="noreferrer">
                          {t.hash}
                        </a>
                        <span className="text-xs text-[var(--ink-3)]">
                          {" "}
                          · {t.at.slice(0, 16).replace("T", " ")} UTC{t.status === "reverted" ? " · reverted" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-[var(--ink-3)]">None yet: npm run chain:simulate -- --broadcast writes the alert and collapse reports.</p>
                )}
              </>
            ) : (
              <p className="mt-2 text-sm text-[var(--ink-2)]">
                Not run in this copy yet. <code>npm run chain:setup</code> deploys the registry to Sepolia, and{" "}
                <code>npm run chain:simulate -- --broadcast</code> runs the workflow in Chainlink&apos;s CRE simulator and sends its reports. This box then
                fills itself in with the contract, every transaction and the simulator&apos;s output.
              </p>
            )}
            {simLog && (
              <details className="mt-4 text-sm">
                <summary className="link cursor-pointer font-bold">Chainlink simulation log (cre/SIMULATION.md)</summary>
                <pre className="mt-2 max-h-[32rem] overflow-auto whitespace-pre-wrap break-all rounded-xl bg-[var(--ink)] p-3 text-[0.7rem] leading-relaxed text-[var(--canary-soft)]">{simLog}</pre>
                <a className="link mt-1 inline-block text-xs" href="/api/onchain?log=1" target="_blank" rel="noreferrer">
                  Open the raw log
                </a>
              </details>
            )}
          </div>
        </section>

        <section data-guide="honest" className="pt-14">
          <h2 className="font-display text-3xl font-extrabold">Known limits</h2>
          <ul className="mt-4 list-disc space-y-2 pl-6 text-[var(--ink-2)]">
            <li>Live influencer posts need paid X/Telegram access. The replay uses posts quoted in SEC orders and court records; the radar says when posts are missing.</li>
            <li>RYO tools need a hackathon key; without it the radar records every fact as a gap and refuses every practice trade.</li>
            <li>{writeLimit}</li>
            <li>EMAX holder concentration is left out: the token reports a total supply smaller than its three largest balances combined.</li>
            <li>Canary is not a law firm. Documents are drafts the victim reviews and sends themselves.</li>
          </ul>
        </section>
      </main>
      <Footer />
    </Guide>
  );
}

const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;

function lastRunText(o: Onchain): string {
  const r = o.simulations[o.simulations.length - 1];
  if (!r) return "not yet";
  return `${r.at.slice(0, 16).replace("T", " ")} UTC · ${r.target}${r.broadcast ? " · --broadcast" : ""}${r.cliVersion ? ` · CRE CLI ${r.cliVersion}` : ""}`;
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
