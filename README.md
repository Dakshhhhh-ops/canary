# Canary

**Catch the pump before it dumps.**

Influencers get paid to hype a crypto coin. Fans pile in. Insiders cash out and the price collapses. Canary's agents spot paid promoters converging on the same coin, write the proof onto the blockchain through a Chainlink workflow, and help the people who lost money file complaints by talking to Doki, a canary.

Built for the **BLI Legal Tech Hackathon 2** (Blockchain Legal Institute, DoraHacks). Entered for the main legal-tech prize, the **RYO-CHAN Autonomous Agents** bounty and the **Chainlink "Best workflow with CRE"** bounty.

## Try it

**Live:** https://canary.3-26-157-118.sslip.io (no login; start with [`/call?demo=1`](https://canary.3-26-157-118.sslip.io/call?demo=1) and [`/judges`](https://canary.3-26-157-118.sslip.io/judges))

| Page | What you'll see |
|---|---|
| `/` | Doki explains pump-and-dumps from zero, the law that makes hidden paid promotion illegal, and what Canary does |
| `/case/emax` | **The real EthereumMax case (2021).** Press *Run the agents*: ten agents work through SEC- and court-documented posts and on-chain prices, step by step. Tap *Why?* on any step. Verify the notebook, then try to tamper with it |
| `/case/saitama` | **A second real case, Saitama Inu (2021).** Different promoters (the coin's own officers), different law (market manipulation and fraud, not paid touting), same agents and same on-chain method. The agents count the four officers as one voice |
| `/cases` | Both cases side by side |
| `/call` | **The hotline.** Talk to Doki (or type). Doki finds your purchase on the blockchain and drafts your complaints for the US, UK, EU or India, depending on where you live. `/call?demo=1` plays a full demo call. The claim pack downloads as one PDF, and its rules can be switched to another country |
| `/verify` | Drop an evidence file or a notebook; every fingerprint is recomputed in your browser |
| `/radar` | The same agents on coins trading today, through RYO's market tools, with today's promoter posts from public Telegram channels and Bluesky; flagged coins with a known Ethereum pool are handed to Chainlink |
| `/judges` | Every bounty requirement mapped to where it runs and where the code is |
| `/how` | The architecture on one page |

## The law

- **Securities Act of 1933, §17(b)** (15 U.S.C. § 77q(b)), the anti-touting provision: anyone paid to promote a security must disclose the payment, who paid and how much.
- **SEC v. Kardashian** (Oct 3, 2022): $250,000 for an Instagram post about EMAX; "#AD" was not enough; $1.26M settlement. **SEC v. Pierce** (Feb 17, 2023): about $1.409M.
- **In re EthereumMax Investor Litigation**, C.D. Cal. No. 2:22-cv-00163: investor class action; state classes certified in 2025.
- **FTC Endorsement Guides**, 16 CFR Part 255.

### Outside the US

Doki works out where the caller lives, either from an answer or from something said in passing ("I'm in London", "from Mumbai", "Germany"). The drafts then cite that country's rules. Every provision is stored with its official source in `src/lib/claims/law.ts` (checked October 2026), and the fact guard rejects any article, instrument or phone number a draft cites that isn't in that table.

- **UK**
  - Law: FSMA 2000 **s.21**, the financial promotion restriction, and **s.25**, which makes breaching it an offence.
  - Crypto promotions: under SI 2023/612, cryptoassets have been inside the s.21 regime since **8 Oct 2023**. The FCA's risk warning is in **COBS 4.12A.11R** (PS23/6).
  - Influencers: FCA **FG24/1** (March 2024) covers finfluencers.
  - Where to report: the FCA's *Report a scam*, and **Report Fraud**, which replaced Action Fraud in December 2025. In Scotland, Police Scotland on 101.
- **EU**
  - Law: **MiCA**, Regulation (EU) 2023/1114, applying from 30 Dec 2024. Title VI covers market abuse:
    - Art. 86(1), scope;
    - Art. 88, disclosure of inside information;
    - Art. 89, insider dealing;
    - Art. 91(2)(c), spreading misleading information;
    - Art. 91(3)(c), voicing an opinion after taking a position, without disclosing the conflict.
  - Marketing communications: MiCA **Art. 7**.
  - Advertorials: **UCPD 2005/29/EC Annex I point 11**, undisclosed paid editorial content.
  - Where to report: the national authority. Canary maps BaFin, AMF, Central Bank of Ireland, AFM, CNMV and CONSOB; for other countries it points to ESMA's list.
- **India**
  - Advertising rules: **ASCI's VDA advertising guidelines** (Feb 2022, with a mandatory risk disclaimer) and the **ASCI influencer guidelines**, which require disclosure labels.
  - Crypto businesses: notification **S.O. 1072(E)** (7 Mar 2023) brings VDA service providers under the PMLA. FIU-IND's guidelines require them to register.
  - Where to report: ASCI, **cybercrime.gov.in** and the **1930** helpline.

Each draft says when a rule began to apply. For example, EMAX was bought in 2021, before the UK crypto promotion rules and before MiCA.

Canary is not a law firm and nothing in it is legal advice. Documents are drafts that the victim reviews and sends.

## How it works

```
SEC orders · court records ─┐                                       /api/watch/snapshot?list=1
Ethereum (Uniswap pool logs) ├─► ten agents ─► hash-chained notebook ─► (EMAX + flagged radar coins) ─► canary-watch (cron) ─► CanaryRegistry (Sepolia)
RYO market tools (live) ────┤                                                                                                  ▲   │ ClaimAnchored
Telegram · Bluesky (live) ──┘                                                                                                  │   │
                                victim ─► Doki hotline ─► purchase check ─► claim pack ─► anchorClaim / canary-claims (HTTP) ──┘   ▼
                                                                                          canary-anchor (EVM log) ─► custody record ┘
```

### Agents (`src/lib/engine/`)

| Agent | Question | Code |
|---|---|---|
| Collector | What was posted, what did the coin do? | `pipeline.ts` |
| Multi-influencer watcher (Multi-KOL) | Are 3+ promoters pushing it at once? Same payer or copy-paste counts as one voice | `convergence.ts` |
| Social-post collector | What are promoters posting **today**? Public Telegram channel previews and Bluesky search (no key), Reddit and Farcaster with optional API credentials. Reads each post for a payment disclosure (and whether it names payer and amount, as §17(b) requires), promotion words, tickers and contract addresses; every raw page is fingerprinted, every block is a gap | `src/lib/social/` |
| News checker | Did what they claimed happen? Cause → effect | `news.ts` |
| Token hunter | Six published rules, selected and rejected explained with raw numbers | `hunter.ts` |
| Collapse watcher | Did it fall 80%+ from the peak? | `collapse.ts` |
| Bull / Bear | Argue from the identical hashed evidence bundle; a fact guard drops claims citing missing evidence or numbers | `debate.ts` |
| Judge | Verdict from a published weighted rule; the model may only explain it | `debate.ts` |
| Risk desk | "Buy the dip" as one decision (entry, size, stop, exit), checked against user risk limits; paper only | `risk.ts` |
| Trail | SHA-256 hash chain over canonical JSON; same input → same notebook | `trail.ts` |
| RYO client | MCP over HTTP (initialize, tools/call, SSE); every failure becomes a recorded gap | `ryo.ts` |

The model (OpenRouter) is optional. Without it, every agent runs on its rule-based path and the run records that as a gap.

### Chainlink CRE (`cre/`): three workflows, three trigger types

- **`canary-watch` (cron trigger).** Every 10 minutes → **HTTP** fetch of Canary's **watch list** (`/api/watch/snapshot?list=1`: the EMAX case plus every radar coin whose latest saved, verified run is flagged and whose Uniswap V2 pool on Ethereum is known) with **consensus** across nodes, and a bearer token from the **CRE secret** `WATCH_TOKEN` → per case, **EVM read** of the token's pool and the Chainlink ETH/USD feed on Ethereum mainnet and of the registry on Sepolia → **writeReport** of an alert and/or a collapse. At most 3 cases per run (CRE's 15-read limit); longer lists rotate. The single-case `?case=emax` path still works (staging uses it offline).
- **`canary-claims` (HTTP trigger).** Confirms a victim's purchases on mainnet logs before recording `ClaimVerified`.
- **`canary-anchor` (EVM log trigger on `ClaimAnchored`).** For every anchored claim, writes a chain-of-custody record: the case's level, reasoning-trail head and collapse status at filing, whether the purchase was verified, and the token pool's liquidity on Ethereum mainnet at a named finalized block.

See [cre/README.md](cre/README.md).

### Contract (`contracts/CanaryRegistry.sol`)

A CRE receiver (forwarder allow-list, ERC-165) that stores alerts, collapses, claim fingerprints (`anchorClaim`, relayer-only, no personal data), verified claims (kind 3) and claim-custody records (kind 4). 22 tests on an in-process chain, including each workflow's exact report bytes. The registry deployed on Sepolia today predates kind 4, so `canary-anchor` runs observe-only against it until `npm run chain:setup` redeploys.

### The EMAX case file (`data/cases/emax.json`)

Posts and legal facts quoted from SEC orders and court records, each with a source. Prices and liquidity are rebuilt from the EMAX/WETH Uniswap V2 pool's logs, priced through the USDC/WETH pool, so every dollar figure comes from Ethereum. Rebuild it: `npx tsx scripts/build-emax.mts`. What couldn't be verified is listed in `data/cases/emax.sources.md`.

### The Saitama case file (`data/cases/saitama.json`)

The second case: SEC v. Armand, Hernandez, Kohli and Tran (D. Mass. No. 1:24-cv-12586, Oct 2024), with a parallel criminal case in Boston. Posts are quoted only from the SEC complaint; prices, liquidity and buyers are rebuilt from the Uniswap V2 SAITAMA/WETH pool. Rebuild it: `npx tsx scripts/build-case.mts saitama`. The generic builder (`scripts/lib/pool-series.mts`, one config per case in `scripts/cases/`) reproduces EMAX's published price series exactly: `npx tsx scripts/build-case.mts emax --compare`. Sources, gaps and the other candidates considered: `data/cases/saitama.sources.md`.

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

- Live posts come only from free sources: public Telegram channel previews (each channel's latest posts, from a configurable list) and Bluesky search. X needs paid API access and is not read; Reddit (robots.txt disallows scraping) and Farcaster (keyless endpoints disallow automated access) are read only with API credentials, otherwise they are recorded gaps. Cloud servers may be blocked by a source; that is a gap too.
- A live post is counted as pushing a coin from its words ("100x", "to the moon", "buy now"…), a published heuristic. Payment is never inferred: "no disclosure" is not proof of payment, so the paid-but-undisclosed rule stays unknown for live posts. The EMAX replay uses posts quoted in SEC orders and court records.
- RYO tools need a hackathon key. Without it, the radar records gaps and refuses every practice trade.
- EMAX holder concentration is left out: the token reports a total supply smaller than its three largest balances combined.
- Doki's hotline covers both cases: it recognises the coin from what the caller says, or from the purchases in their wallet. Saitama drafts cite that case's own law and lawsuit (Exchange Act §§9(a)(2), 10(b), Securities Act §17(a)), never §17(b). Only EMAX has an on-chain record from the Chainlink workflow so far.
- The Saitama facts are the SEC's allegations; the criminal case is described from press reports.
- Prices are end-of-day pool readings, not intraday highs.
- Outside the US, Canary names the national regulator for six EU countries. For the others it points to ESMA's list. Whether MiCA covers a token depends on whether it is admitted to trading (Art. 86), which the drafts leave to the regulator.
- The PDF uses the standard PDF fonts (Western European characters). Characters outside that set are replaced or dropped, including emoji in quoted posts.

## Mascot

Doki is a rigged 3D model (`public/mascot/doki.glb`) animated in code (`src/components/Mascot.tsx`): blinking, beak synced to speech, wings, head following the cursor.
