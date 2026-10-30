# Canary

**Catch the pump before it dumps.**

Influencers get paid to hype a crypto coin. Fans pile in. Insiders cash out and the price collapses. Canary's agents spot paid promoters converging on the same coin, write the proof onto the blockchain through a Chainlink workflow, and help the people who lost money file complaints by talking to Doki, a canary.

Built for the **BLI Legal Tech Hackathon 2** (Blockchain Legal Institute, DoraHacks). Entered for the main legal-tech prize, the **RYO-CHAN Autonomous Agents** bounty and the **Chainlink "Best workflow with CRE"** bounty.

## Try it

| Page | What you'll see |
|---|---|
| `/` | Doki explains pump-and-dumps from zero, the law that makes hidden paid promotion illegal, and what Canary does |
| `/case/emax` | **The real EthereumMax case (2021).** Press *Run the agents*: ten agents work through SEC- and court-documented posts and on-chain prices, step by step. Tap *Why?* on any step. Verify the notebook, then try to tamper with it |
| `/call` | **The hotline.** Talk to Doki (or type). Doki finds your purchase on the blockchain and drafts your complaints. `/call?demo=1` plays a full demo call |
| `/verify` | Drop an evidence file or a notebook; every fingerprint is recomputed in your browser |
| `/radar` | The same agents on coins trading today, through RYO's market tools |
| `/judges` | Every bounty requirement mapped to where it runs and where the code is |
| `/how` | The architecture on one page |

## The law

- **Securities Act of 1933, §17(b)** (15 U.S.C. § 77q(b)), the anti-touting provision: anyone paid to promote a security must disclose the payment, who paid and how much.
- **SEC v. Kardashian** (Oct 3, 2022): $250,000 for an Instagram post about EMAX; "#AD" was not enough; $1.26M settlement. **SEC v. Pierce** (Feb 17, 2023): about $1.409M.
- **In re EthereumMax Investor Litigation**, C.D. Cal. No. 2:22-cv-00163: investor class action; state classes certified in 2025.
- **FTC Endorsement Guides**, 16 CFR Part 255.

Canary is not a law firm and nothing in it is legal advice. Documents are drafts that the victim reviews and sends.

## How it works

```
SEC orders · court records ─┐
Ethereum (Uniswap pool logs) ├─► ten agents ─► hash-chained notebook ─► /api/watch/snapshot ─► Chainlink CRE ─► CanaryRegistry (Sepolia)
RYO market tools (live) ────┘                                                                                        ▲
                                         victim ─► Doki hotline ─► on-chain purchase check ─► claim pack ─► anchorClaim ┘
```

### Agents (`src/lib/engine/`)

| Agent | Question | Code |
|---|---|---|
| Collector | What was posted, what did the coin do? | `pipeline.ts` |
| Multi-influencer watcher (Multi-KOL) | Are 3+ promoters pushing it at once? Same payer or copy-paste counts as one voice | `convergence.ts` |
| News checker | Did what they claimed happen? Cause → effect | `news.ts` |
| Token hunter | Six published rules, selected and rejected explained with raw numbers | `hunter.ts` |
| Collapse watcher | Did it fall 80%+ from the peak? | `collapse.ts` |
| Bull / Bear | Argue from the identical hashed evidence bundle; a fact guard drops claims citing missing evidence or numbers | `debate.ts` |
| Judge | Verdict from a published weighted rule; the model may only explain it | `debate.ts` |
| Risk desk | "Buy the dip" as one decision (entry, size, stop, exit), checked against user risk limits; paper only | `risk.ts` |
| Trail | SHA-256 hash chain over canonical JSON; same input → same notebook | `trail.ts` |
| RYO client | MCP over HTTP (initialize, tools/call, SSE); every failure becomes a recorded gap | `ryo.ts` |

The model (OpenRouter) is optional. Without it, every agent runs on its rule-based path and the run records that as a gap.

### Chainlink CRE (`cre/canary-watch/`)

Cron every 10 minutes → **HTTP** fetch of Canary's verdict snapshot with **consensus** across nodes → **EVM read** of the token's Uniswap V2 pool and the Chainlink ETH/USD feed on Ethereum mainnet → **EVM read** of the registry on Sepolia → **writeReport** of an alert and/or a collapse to `CanaryRegistry.onReport`. See [cre/README.md](cre/README.md).

### Contract (`contracts/CanaryRegistry.sol`)

A CRE receiver (forwarder allow-list, ERC-165) that stores alerts, collapses and claim fingerprints (`anchorClaim`, relayer-only, no personal data). 14 tests on an in-process chain.

### The EMAX case file (`data/cases/emax.json`)

Posts and legal facts quoted from SEC orders and court records, each with a source. Prices and liquidity are rebuilt from the EMAX/WETH Uniswap V2 pool's logs, priced through the USDC/WETH pool, so every dollar figure comes from Ethereum. Rebuild it: `npx tsx scripts/build-emax.mts`. What couldn't be verified is listed in `data/cases/emax.sources.md`.

## Run it

```bash
npm install
cp .env.example .env.local     # every key is optional
npm run dev                    # http://localhost:3000
npm test                       # agent engine + hotline tests
```

Contracts: `cd contracts && npm install && npm test`. Workflow: see [cre/README.md](cre/README.md) (needs the `cre` CLI and Bun; simulation needs a Chainlink account).

## On-chain proof

Three commands produce the proof that the Chainlink CRE workflow ran and wrote to the chain. They need a fresh Sepolia **test** wallet (`CANARY_RELAYER_KEY=0x…` in `.env.local`, funded at [faucets.chain.link/sepolia](https://faucets.chain.link/sepolia)) and a Chainlink account (`cre login`, CLI in `.tools/`).

```bash
npm run chain:setup                       # compile + deploy CanaryRegistry to Sepolia; writes the address into the CRE configs, .env.local, cre/.env and data/onchain.json
npm run chain:simulate -- --broadcast     # cre workflow simulate (dry run, then --broadcast): real EMAX pool read on mainnet → alert + collapse reports on Sepolia
npm run chain:status                      # what the registry now holds for EMAX, with Etherscan links
```

`chain:simulate` saves the simulator's full, redacted output with a step-by-step explanation to [cre/SIMULATION.md](cre/SIMULATION.md) and the transaction hashes to `data/onchain.json`; the app shows both on `/judges` and on the EMAX case page. Optional: `-- --target local-settings` reads the snapshot from the running app over HTTP; `-- --target production-settings --url https://<deployed app>` from the public one.

<!-- onchain:start -->
- **CanaryRegistry (Sepolia):** [`0x9978E9F91cABfBB1e1b9A5Ae714328068B2DC116`](https://sepolia.etherscan.io/address/0x9978E9F91cABfBB1e1b9A5Ae714328068B2DC116) · deployed in block 12023671 ([deploy tx](https://sepolia.etherscan.io/tx/0x309c662cedc606f39c66afdfce1b8a2932bab1e178ccc9437ec4bdadcee6e72a))
- **Reports written by the CRE workflow** (`cre workflow simulate --broadcast` → MockKeystoneForwarder → `CanaryRegistry.onReport`):
  - alert · [`0xd6003f3d…d6e10c9a`](https://sepolia.etherscan.io/tx/0xd6003f3d3839816a223cc59c8ab05dcd63b5ca8f236341fa14f5c597d6e10c9a) · canary-watch `staging-settings` · 2026-10-30 02:43 UTC
  - collapse · [`0xc0fad796…e0952cc9`](https://sepolia.etherscan.io/tx/0xc0fad796d7417550fecb531c8f4124cdf67041e47fe7538c430b30f6e0952cc9) · canary-watch `staging-settings` · 2026-10-30 02:43 UTC
  - claim-verification · [`0x85473c98…8905ae6c`](https://sepolia.etherscan.io/tx/0x85473c9811d3e7a70d1e25187faa3298291aa61a9b12e3dc98d92a278905ae6c) · canary-claims `staging-settings` · 2026-10-30 02:44 UTC
- **Simulation runs recorded:** 4 (last: canary-claims `staging-settings` with --broadcast, CRE CLI v1.39.0, 2026-10-30 02:44 UTC)
- **Full simulator output:** [cre/SIMULATION.md](cre/SIMULATION.md) (also shown on `/judges` in the app)
<!-- onchain:end -->

## Honest limits

- Live influencer posts need paid X/Telegram API access. The replay uses posts quoted in SEC orders and court records.
- RYO tools need a hackathon key. Without it, the radar records gaps and refuses every practice trade.
- EMAX holder concentration is left out: the token reports a total supply smaller than its three largest balances combined.
- Prices are end-of-day pool readings, not intraday highs.

## Mascot

Doki is a rigged 3D model (`public/mascot/doki.glb`) animated in code (`src/components/Mascot.tsx`): blinking, beak synced to speech, wings, head following the cursor.
