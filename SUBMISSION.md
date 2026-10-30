# Canary — BLI Legal Tech Hackathon 2

**Catch the pump before it dumps.**

Tracks and bounties: main legal-tech prize · RYO-CHAN "Autonomous Agents" · Chainlink "Best workflow with CRE".

## The problem

Paid promotion of crypto without disclosing the payment is illegal in the US: Securities Act §17(b) requires the promoter to disclose the payment, who paid and how much. It keeps happening because:

- the posts disappear (stories expire, tweets get deleted),
- nobody connects who posted, when, and what the price did,
- victims don't know where to complain, and the evidence is too technical to gather alone.

The SEC's own EMAX cases show the pattern. Kim Kardashian was paid $250,000 for one Instagram post; she wrote "#AD", the SEC said that wasn't disclosure, and she paid $1.26M. Paul Pierce paid about $1.4M. An investor class action is still running.

## What Canary does

1. **Watch.** Agents read what promoters post and what the coin is doing: on-chain prices, the trading pool, and RYO's live market tools.
2. **Weigh.** A multi-influencer watcher, a news checker and a token hunter feed a Bull/Bear debate over one identical, hashed evidence bundle. A Judge applies a published rule. A practice "buy the dip" trade is planned and Canary's own risk limits refuse it, with reasons.
3. **Record.** A Chainlink CRE workflow fetches Canary's verdict with node consensus, checks the token's real pool on Ethereum with the Chainlink ETH/USD feed, and writes an alert and a collapse record to a registry contract that nobody can backdate.
4. **Help.** A victim talks to Doki, a canary. Doki finds their purchase on-chain from a wallet address, lines it up with the promoters' posts, and drafts their SEC tip, FTC report, state-regulator note and class-action information. They approve every document. Their evidence file gets a SHA-256 fingerprint that can be anchored on-chain.

Every agent step is sealed into a hash-chained notebook. Same input, same notebook. Anyone can verify it, or try to tamper with it, in the browser.

## The real case: EthereumMax (EMAX), 2021

- 11 promoter posts by Paul Pierce, Kim Kardashian and Floyd Mayweather Jr., quoted only from SEC orders and court records, each with its source.
- 129 daily prices and liquidity readings rebuilt from 339,213 Uniswap swaps on Ethereum (re-runnable script).
- About 6-fold rise in five days during Pierce's paid tweets, then −91% from the peak by June 27, 2021.
- 8,671 wallets bought in the 72 hours after the token burn Kardashian's post announced.
- The agents' verdict: **pump-and-dump** (0.9 of 1). Practice trade: **refused**.

## Try it (5 minutes)

1. `/` — Doki explains everything from zero. Press "Show me around".
2. `/case/emax` — press **Run the agents**. Tap *Why?* on any step. Then *Verify* and *Try to tamper*.
3. `/call?demo=1` — a complete victim call, from "I lost money" to a drafted SEC tip.
4. `/verify` — drop the evidence file or notebook; change one character.
5. `/radar` — the same agents on today's coins through RYO.
6. `/judges` — every bounty requirement mapped to the page and the code.

## Bounty fit

**RYO-CHAN Autonomous Agents:** Multi-KOL Narrative Agent (spotlight) with echo detection · News Checker · Token Hunter (selected and rejected, rule by rule) · Bull/Bear debate on identical evidence with a fact guard · Buy the Dip as one decision · practice trades with user risk limits and a circuit breaker · SHA-256 hash-chained replayable trail · RYO MCP client where every failure is a recorded gap.

**Chainlink CRE:** cron trigger · HTTP capability with consensus aggregation · EVM reads on Ethereum mainnet (Uniswap V2 pool, Chainlink ETH/USD Data Feed) and Sepolia · writeReport to a CRE receiver contract · 11 workflow tests and 14 contract tests, including the workflow's exact report bytes end to end.

## Limits, stated plainly

- Live influencer posts need paid X/Telegram access; the replay uses documented posts.
- RYO needs a hackathon key; without it the radar records gaps and refuses trades.
- Canary is not a law firm. Documents are drafts the victim reviews and sends.
