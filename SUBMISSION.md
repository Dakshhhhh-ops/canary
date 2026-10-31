# Canary — BLI Legal Tech Hackathon 2

**Catch the pump before it dumps.**

Tracks and bounties: main legal-tech prize · RYO-CHAN "Autonomous Agents" · Chainlink "Best workflow with CRE".

**Live:** https://canary.3-26-157-118.sslip.io (no login; start with [`/call?demo=1`](https://canary.3-26-157-118.sslip.io/call?demo=1) and [`/judges`](https://canary.3-26-157-118.sslip.io/judges))

## The problem

Paid promotion of crypto without disclosing the payment is illegal in the US: Securities Act §17(b) requires the promoter to disclose the payment, who paid and how much. It keeps happening because:

- the posts disappear (stories expire, tweets get deleted),
- nobody connects who posted, when, and what the price did,
- victims don't know where to complain, and the evidence is too technical to gather alone.

The SEC's own EMAX cases show the pattern. Kim Kardashian was paid $250,000 for one Instagram post; she wrote "#AD", the SEC said that wasn't disclosure, and she paid $1.26M. Paul Pierce paid about $1.4M. An investor class action is still running.

## What Canary does

1. **Watch.** Agents read what promoters post and what the coin is doing: on-chain prices, the trading pool, RYO's live market tools, and today's posts from public Telegram channels and Bluesky (free sources, no paid API).
2. **Weigh.** A multi-influencer watcher, a news checker and a token hunter feed a Bull/Bear debate over one identical, hashed evidence bundle. A Judge applies a published rule. A practice "buy the dip" trade is planned and Canary's own risk limits refuse it, with reasons.
3. **Record.** A Chainlink CRE workflow fetches Canary's verdicts (the EMAX case and every coin the live radar flagged) with node consensus, checks each token's real pool on Ethereum with the Chainlink ETH/USD feed, and writes alert and collapse records to a registry contract that nobody can backdate. When a victim's claim is anchored, a second workflow fires on that event and records the claim's chain of custody: which version of the analysis it relied on, and how much was left in the pool when it was filed.
4. **Help.** A victim talks to Doki, a canary. Doki knows both cases: it recognises the coin from what the caller says or from their wallet. It finds their purchase on-chain from a wallet address, lines it up with the promoters' posts, and drafts their SEC tip, FTC report, state-regulator note and class-action information. They approve every document. Their evidence file gets a SHA-256 fingerprint that can be anchored on-chain.
5. **Reach beyond the US.** If the victim lives elsewhere, the drafts follow that country's rules, each with its official source:
   - **UK:** the FCA under FSMA s.21 and the cryptoasset promotion rules, plus Report Fraud.
   - **EU:** the national regulator under MiCA's market-abuse articles, plus the Unfair Commercial Practices Directive.
   - **India:** ASCI's crypto and influencer advertising guidelines, plus cybercrime.gov.in and the 1930 helpline.

   Doki picks up where the victim lives from what they say ("I'm in London"). It can also be changed in the claim pack.
6. **A file to attach.** The whole pack downloads as one PDF, built in the browser with no PDF library. It has a cover with the fingerprint and the on-chain anchor, the drafts, the transaction table and the sources. Every page carries "not legal advice", a page number and the fingerprint. The same pack always gives the same PDF bytes.

Every agent step is sealed into a hash-chained notebook. Same input, same notebook. Anyone can verify it, or try to tamper with it, in the browser.

## The real case: EthereumMax (EMAX), 2021

- 11 promoter posts by Paul Pierce, Kim Kardashian and Floyd Mayweather Jr., quoted only from SEC orders and court records, each with its source.
- 129 daily prices and liquidity readings rebuilt from 339,213 Uniswap swaps on Ethereum (re-runnable script).
- About 6-fold rise in five days during Pierce's paid tweets, then −91% from the peak by June 27, 2021.
- 8,671 wallets bought in the 72 hours after the token burn Kardashian's post announced.
- The agents' verdict: **pump-and-dump** (0.9 of 1). Practice trade: **refused**.

## A second real case: Saitama Inu (SAITAMA), 2021

To show the method isn't a one-off, the same agents replay a case with different promoters and different law: *SEC v. Armand, Hernandez, Kohli and Tran* (D. Mass. No. 1:24-cv-12586, Oct 2024), market manipulation and fraud (Exchange Act §§9(a)(2), 10(b); Securities Act §17(a)) by the coin's own four officers, with a parallel criminal case in Boston.

- 16 posts and statements (X and YouTube), quoted only from the SEC complaint, including "zero 👌 saitama sold just to be clear lol." (the SEC says Armand sold 490 billion that day) and "I am buying more" (Tran sold nearly 1.2 trillion net that day).
- 367 daily prices rebuilt from 997,149 swaps in the Uniswap V2 SAITAMA/WETH pool, with the same generic builder that reproduces EMAX's series exactly.
- About 4,939-fold rise from the July 2, 2021 close to the November 13 peak (the SEC: "over 477,000 percent"), then −90.7% by March 5, 2022.
- 38,264 wallets bought from the pool during the SaitaMask launch countdown (Nov 8–13, 2021), while the SEC says the insiders were selling.
- The agents count the four officers as **one voice** (a documented shared team), and the verdict is **pump-and-dump** (0.6 of 1). The practice trade was **accepted**: Canary's risk limits look for undisclosed paid promotion and holder concentration, so insider selling slipped through; the notebook's hindsight shows it would have lost money. That gap is recorded, not hidden.

## Try it (5 minutes)

1. `/` — Doki explains everything from zero. Press "Show me around".
2. `/case/emax` — press **Run the agents**. Tap *Why?* on any step. Then *Verify* and *Try to tamper*. Then `/case/saitama` (or `/cases`) for the second case.
3. `/call?demo=1` — a complete victim call, from "I lost money" to a drafted SEC tip. In the claim pack, press **Download PDF**, then switch "Draft for the rules of" to the UK, the EU or India.
4. `/verify` — drop the evidence file or notebook; change one character.
5. `/radar` — the same agents on today's coins through RYO.
6. `/judges` — every bounty requirement mapped to the page and the code.

## What sets Canary apart

- **Real enforcement cases, not staged ones.** Both cases are SEC actions, replayed from 1.3 million real Uniswap swaps, with every post quoted from SEC orders and court records. No synthetic tokens, personas or invented prices.
- **Individual promoters, read today.** The multi-KOL watcher reads named accounts' posts from public Telegram channels and Bluesky, merges copy-paste and same-payer accounts into one voice, and checks each post for a §17(b) disclosure (payer and amount).
- **It ends with something a victim can file.** Detection is step one. Doki turns it into drafts for the SEC, FTC, state regulators and class counsel, or the UK, EU or Indian equivalents, plus a PDF with a fingerprint that can be anchored on-chain.
- **Honest about failure.** Every failed source is a recorded gap. Without a RYO key the radar shows a labelled replay and saves nothing. The Saitama practice trade that slipped past our risk limits is kept on the record.

## Bounty fit

**RYO-CHAN Autonomous Agents:** Multi-KOL Narrative Agent (spotlight) with echo detection, running on **today's** promoter posts in the radar (public Telegram channel previews and Bluesky search with no key; Reddit and Farcaster with optional credentials): per coin, accounts in the last 24 h and 72 h, who pushes it in promotion words, who said they were paid and whether they named payer and amount (§17(b)), contract addresses, echo groups, and every raw page SHA-256-sealed in the notebook · News Checker · Token Hunter (selected and rejected, rule by rule) · Bull/Bear debate on identical evidence with a fact guard · Buy the Dip as one decision · practice trades with user risk limits and a circuit breaker · SHA-256 hash-chained replayable trail · RYO MCP client where every failure is a recorded gap. `/judges` maps each of RYO-CHAN's judging criteria (combining sources, coping with failure, real thinking, cause and effect, repeatability, advanced execution) to where Canary meets it.

**Chainlink CRE:** three workflows, all three trigger types: **cron** (`canary-watch`), **HTTP** (`canary-claims`) and **EVM log** (`canary-anchor`, on the registry's `ClaimAnchored`) · HTTP capability with consensus aggregation, over one case (per-field identical/median) or the whole watch list (identical canonical list) · the live RYO radar feeds the chain: every coin whose latest saved, verified run is flagged and whose Uniswap V2 pool is verified joins the watch list next to EMAX · **CRE secrets** (`runtime.getSecret`): a bearer token for the watch list, public when unset · EVM reads on Ethereum mainnet (Uniswap V2 factory and pools, Chainlink ETH/USD Data Feed, finalized block headers) and Sepolia, inside CRE's 15-read budget · writeReport to a CRE receiver contract (alerts, collapses, verified claims, and chain-of-custody records that freeze which reasoning trail each claim was filed against) · 22 + 19 + 15 workflow tests and 22 contract tests, including every workflow's exact report bytes end to end · `canary-anchor` and `canary-watch`'s list mode run in the real CRE simulator (dry run).

## Limits, stated plainly

- Live posts come only from free sources (public Telegram channel previews, Bluesky search); X needs paid access and is not read, Reddit and Farcaster need API credentials. A live post without a disclosure is never treated as proof of payment. The EMAX replay uses documented posts.
- Doki's hotline covers buyers of both cases. The Saitama facts are the SEC's allegations, and its criminal case is described from press reports.
- RYO needs a hackathon key; without it the radar records gaps and refuses trades.
- Canary is not a law firm. Documents are drafts the victim reviews and sends.
