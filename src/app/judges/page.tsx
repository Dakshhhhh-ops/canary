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
  { id: "chainlink", mood: "think", text: "And these are the Chainlink CRE workflows: what they read, what they agree on, and what they write." },
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
    ["Multi-KOL on today's posts", "Each radar run reads live promoter posts from free sources (public Telegram channel previews, Bluesky's public search; Reddit and Farcaster with optional API credentials). Per coin: accounts in the last 24 h / 72 h, who is pushing it in promotion words, who said they were paid and whether they named payer and amount (§17(b)), contract addresses, echo groups. Every raw page is SHA-256-fingerprinted in the notebook; a blocked source is a recorded gap.", <Link key="k" className="link" href="/radar">/radar · live posts</Link>, "src/lib/social/*"],
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
    ["Three trigger types", "Cron (canary-watch, every 10 minutes), HTTP (canary-claims) and EVM log (canary-anchor, on the registry's ClaimAnchored event).", "cre/*/workflow.yaml", "initWorkflow in each workflow.ts"],
    ["HTTP capability + consensus", "Fetches Canary's verdicts. One case: nodes must agree on case id, level and trail hash, and take the median of dollar figures. The watch list: each node reduces it to one canonical string that must be identical on every node.", <a key="s" className="link" href="/api/watch/snapshot?list=1" target="_blank" rel="noreferrer">/api/watch/snapshot?list=1</a>, "cre/canary-watch/workflow.ts (ConsensusAggregationByFields, consensusIdenticalAggregation)"],
    ["Live radar → Chainlink", "A radar coin joins the watch list when its latest saved run verifies, the judge flags it, and its Uniswap V2 pool on Ethereum was checked on-chain (FLOKI, MOG, PEPE, SHIB). Others are listed as skipped, with the reason. At most 3 cases per run (CRE's 15-read limit); longer lists rotate.", <Link key="r" className="link" href="/radar">/radar · Handed to Chainlink</Link>, "src/lib/watch.ts, src/lib/snapshot.ts"],
    ["CRE secrets", "The workflow reads WATCH_TOKEN with runtime.getSecret and sends it as a bearer token; the app checks it in constant time when its WATCH_TOKEN is set, and the list is public when it isn't.", "cre/secrets.yaml", "readAuthToken in cre/canary-watch/workflow.ts; watchTokenOk in src/lib/watch.ts"],
    ["EVM read (Ethereum mainnet)", "Reads each token's Uniswap V2 pool (getReserves, token0, token1) and the Chainlink ETH/USD Data Feed (read once per run, shared), so the collapse check uses the chain, not Canary's word.", "EMAX pool 0xb6CA…257f", "workflow.ts"],
    ["EVM read (Sepolia)", "statusOf(caseId) on the registry, so old news isn't re-sent.", "CanaryRegistry", "workflow.ts"],
    ["EVM write", "runtime.report → writeReport → forwarder → CanaryRegistry.onReport: an alert (level ≥ 1) and a collapse (pool down ≥ 80%).", evmWriteSee, "contracts/CanaryRegistry.sol"],
    ["Second workflow: victims' claims", "An HTTP trigger sends a claim; nodes read Ethereum mainnet logs (filterLogs) to confirm the wallet bought from the EMAX pool during the class period, agree, then write ClaimVerified. The wallet is stored only as a salted hash.", <Link key="k" className="link" href="/call?demo=1">Hotline → claim pack</Link>, "cre/canary-claims/"],
    ["Third workflow: chain of custody", "An EVM log trigger fires on every ClaimAnchored. Nodes read the case as it stood (level, reasoning-trail head, collapse, verified purchases) and the token's pool on Ethereum mainnet at a named finalized block, then write a custody record (report kind 4), so each claim keeps the analysis it was filed against even after later alerts. Runs observe-only on the registry deployed today, which predates kind 4.", <Link key="c" className="link" href="/case/emax">Case page · on-chain records</Link>, "cre/canary-anchor/, CanaryRegistry._recordClaimCustody"],
    ["Tests", "canary-watch: 22 workflow tests (single case, list, rotation, read budget, secret); canary-claims: 19 replaying a real buyer's mainnet logs; canary-anchor: 15 replaying a real ClaimAnchored log and real pool reads; 22 contract tests on an in-process chain, including each workflow's exact report bytes end to end.", "—", "cre/*/workflow.test.ts, contracts/test, tests/watch.list.test.ts"],
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
              ["/case/emax", "Real case", "Press Run. Ten agents on SEC- and court-documented EMAX posts and on-chain prices. Tap Why?, then Try to tamper. A second case (Saitama, insiders and market manipulation) is on /cases."],
              ["/call?demo=1", "Hotline demo", "A full victim call: Doki finds the purchase on-chain and drafts the SEC tip. Doki also knows Saitama buyers (say \"I bought Saitama Inu\")."],
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
              ["The law it applies", "Securities Act §17(b) (anti-touting: disclose payment, payer and amount), FTC Endorsement Guides (16 CFR 255). The EMAX case is the SEC's own §17(b) enforcement against Kardashian and Pierce. The second case, Saitama, is SEC market-manipulation and fraud charges (Exchange Act §§9(a)(2), 10(b)) against a coin's own officers, with a parallel criminal case."],
              ["Evidence a court can use", "Facts quoted only from SEC orders and court records; prices rebuilt from Ethereum logs by a re-runnable script; hash-chained notebook; per-victim evidence file with a SHA-256 fingerprint and optional on-chain anchoring."],
              ["Access to justice", "A victim talks instead of filling forms. Doki finds their purchase on-chain, matches it to the promoters' posts, and drafts the SEC tip, FTC report, state regulator note and class-action information. They approve every document. Doki knows both cases: it recognises the coin from what the caller says or from their wallet, and Saitama drafts cite that case's own law, never §17(b)."],
              ["Beyond the US", "Doki routes by where the victim lives (\"I'm in London\", \"from Mumbai\", \"Germany\"). UK: FSMA 2000 s.21/s.25, the cryptoasset promotion rules (SI 2023/612, COBS 4.12A risk warning), FCA FG24/1 on finfluencers; FCA and Report Fraud. EU: MiCA Art. 86, 88, 89, 91(2)(c), 91(3)(c) and 7, UCPD Annex I point 11; the national regulator (BaFin, AMF, Central Bank of Ireland, AFM, CNMV, CONSOB). India: ASCI's VDA and influencer guidelines, cybercrime.gov.in and 1930, the PMLA notification for VDA providers. Every provision carries its official source (src/lib/claims/law.ts), and the fact guard rejects any article, instrument or helpline a draft cites that isn't in that table."],
              ["A file to attach", "\"Download PDF\" builds the whole claim pack as one PDF in the browser, with no server and no PDF library: cover with the evidence fingerprint and Sepolia anchor, each draft, the transaction table, the sources, and a footer on every page (\"not legal advice\", page number, fingerprint). The same pack always produces the same bytes, so the PDF has its own stable SHA-256 (src/lib/claims/pdf.ts)."],
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
          <h3 className="font-display mt-8 text-xl font-bold">RYO-CHAN&apos;s judging criteria, one by one</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {[
              ["Combining sources · 20%", "RYO's market tools, today's public Telegram and Bluesky posts, the token's Uniswap pool and the Chainlink ETH/USD feed on Ethereum, and SEC and court records for the real cases. Each source stays separate and every raw reply is fingerprinted in the notebook."],
              ["Coping with failure · 20%", "A 401, 403, 429, network error, timeout or oversized reply becomes a recorded gap, never a crash and never a made-up number. No price from RYO means the practice trade is refused rather than guessed (tests/social.test.ts, tests/engine.ryo.test.ts)."],
              ["Real thinking · 25%", "Bull and Bear argue over one identical, hashed evidence bundle; a fact guard drops any claim that cites missing evidence. The Judge applies a published rule, and the token hunter explains every selected and rejected coin rule by rule."],
              ["Cause and effect · 20%", "The news checker tests each promoter claim against what the price did next, and says that timing is not causation. The risk desk names the rule that refused a trade, and hindsight shows what that trade would have done."],
              ["Repeatability · 10%", "Every step is a SHA-256 hash-chained notebook entry over canonical JSON: same input, same notebook. Saved runs keep every raw reply and replay in the browser with no key."],
              ["Advanced execution · 5%", "Entry, size, stop and exit are one decision object. Accepted trades open paper positions that later runs mark and close at the stop, the take-profit or after 7 days, under a daily-loss circuit breaker."],
              ["Not scored: made-up data shown as real", "Canary never invents market data. Without a RYO key, the radar shows a clearly labelled replay of RYO replies that the open-source hanko project published, and saves nothing from it."],
            ].map(([t, d]) => (
              <div key={t} className="card p-5">
                <h4 className="font-display text-lg font-bold">{t}</h4>
                <p className="mt-1 text-sm text-[var(--ink-2)]">{d}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-sm text-[var(--ink-3)]">Criteria and weights as listed on ryobuild.com/hackathon.</p>
        </section>

        <section data-guide="chainlink" className="pt-14">
          <h2 className="font-display text-3xl font-extrabold">Chainlink bounty: Best workflow with CRE</h2>
          <Table rows={clRows} />
          <p className="mt-3 text-sm text-[var(--ink-3)]">Run it: see cre/README.md (cre workflow build, then cre workflow simulate ./canary-watch -T staging-settings; canary-anchor takes --evm-tx-hash of a ClaimAnchored transaction).</p>

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
            <li>The radar reads live posts only from free sources: public Telegram channel previews (latest posts per channel, from a configurable list) and Bluesky search. X needs paid access and is not read; Reddit and Farcaster need (free or keyed) API credentials. Payment is never inferred: a post without a disclosure is not proof it was paid. The EMAX replay uses posts quoted in SEC orders and court records.</li>
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
