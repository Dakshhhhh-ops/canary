# Saitama Inu (SAITAMA): where each fact comes from

Rebuild the on-chain numbers with `npx tsx scripts/build-case.mts saitama` (add `--fresh` to skip the local cache).
Text facts (posts, legal actions) are typed into `scripts/cases/saitama.mts` from the documents below. Nothing is generated.
The same generic builder (`scripts/lib/pool-series.mts`) reproduces the published EMAX price series exactly:
`npx tsx scripts/build-case.mts emax --compare`.

## Why this case

It is the second real case because it differs from EMAX where it matters and matches it where the method needs it:

- **Different promoters and a different legal theory.** EMAX: outside celebrities paid to post without proper disclosure (Securities Act §17(b)). Saitama: the coin's own four officers promoting it while, per the SEC, staging purchases, paying for wash trading, gaming a ranking site and saying they held or bought while selling: market manipulation and fraud (Exchange Act §§9(a)(2), 10(b), Rule 10b-5; Securities Act §17(a); plus §5). A parallel criminal case is pending in Boston.
- **Same kind of on-chain evidence.** An ERC-20 token on Ethereum whose first and main market was a Uniswap V2 pool, so prices, liquidity and buyers rebuild from public logs with the same code.
- **Primary source quotes the posts.** The SEC complaint quotes the defendants' public X posts and YouTube statements with dates, and gives the sales figures.

## Regulators and courts (primary sources)

| Fact | Source |
|---|---|
| Caption, court, filing date: *SEC v. Russell Armand a/k/a "Saitamaguru1", Maxwell Hernandez a/k/a "MaxEquation", Manpreet Singh Kohli a/k/a "Mkay Saitama"/"mannythehitman", and Nam Tran a/k/a "Ntran1234"*, D. Mass. No. 1:24-cv-12586, filed **Oct 9, 2024**. Their roles: CEO, CTO, CFO and Chief Business Officer of Saitama LLC (Lawrence, Massachusetts, Aug 2021 – June 2022). | SEC complaint, header and ¶¶13–17, https://www.sec.gov/files/litigation/complaints/2024/comp-pr2024-166-saitama.pdf |
| Claims: Securities Act §§5(a), 5(c), 17(a); Exchange Act §§9(a)(2), 10(b) and Rule 10b-5(a)–(c). | Complaint ¶9 |
| Saitama is an ERC-20 token on Ethereum; it "initially traded on Uniswap, and later on" Bybit, OKX, Gate, LBank, Bitmart, MEXC and XT. Total initial supply about 100 quadrillion. 2% of each on-chain transaction redistributed, 2% burned. A "v2" contract replaced it in mid-2022. | Complaint ¶¶42, 56, 67, 78, fn. 5 |
| Sales June 2021 – May 2022: Armand ≈321.43 trillion (≈$2.13M), Hernandez ≈1.17 quadrillion (≈$10.97M), Kohli ≈1.91 quadrillion (≈$22.09M), Tran ≈3.30 quadrillion (≈$14.56M). | Complaint ¶70 (table, page 17 — an image page, read from the rendered page) |
| **July 3–4, 2021** coordinated buying in a private Telegram chat ("We will create an illusion of massive buys and new holders", "[b]asically creating our own pump through illusion", "Round 2 start [sic] now!"); ≈60% price rise during the "approximately two-day buying spree"; purchase amounts per person. | Complaint ¶¶71–89 |
| Market makers: ZM Quant ($1,500/month tier; at least $27,000 paid 2021–2023) and Gotbit wash trading on XT, LBank and others. | Complaint ¶¶90–111 |
| False "anti-whale" claim; DEXTools ranking manipulation; "reviewed by regulators" claim. | Complaint ¶¶112–127 |
| **Posts quoted** (all from the complaint): Armand X 2021-07-16 (¶124a); Kohli X 2021-07-25 (¶124b); @WeAreSaitama X 2021-08-01 (¶124c); Tran X 2021-09-13 and 2021-09-15 (¶124d); Armand X 2021-10-31 "zero 👌 saitama sold just to be clear lol." (¶128); Hernandez YouTube 2021-09-15 (¶129); Tran X 2021-09-15 "I am buying more" (¶130); Tran X 2021-10-23 "I said HOLD!" (¶130, screenshot); Armand X 2021-09-16, YouTube 2021-11-09, X 2021-11-13 ("out of beta"); Kohli X 2021-11-08 and 2021-11-12 (¶¶133–134); Armand YouTube AMA, January 2022 (¶65). | Complaint, pages 18–21, 31–35 |
| Sales while promoting: Armand sold 490 billion on the day of "zero … sold"; Tran sold nearly 1.2 trillion (net) on the day of "I am buying more" and ≈1.53 trillion on the day of "I said HOLD!"; Oct 1 – Nov 12, 2021 sales of ≈$369,000 (Armand), ≈$6,593,000 (Hernandez), ≈$8,337,000 (Tran), ≈$6,520,000 (Kohli). | Complaint ¶¶128–131, 136 |
| ATH **$0.0000001394 on Nov 12, 2021**, "an increase of over 477,000 percent from July 2021"; after the launch delay the price fell 27% over two days and 72% over the following month. | Complaint ¶¶134, 137 |
| Armand and Hernandez consented to bifurcated settlements (injunctions, officer-and-director bars; money later), subject to court approval. Vy Pham charged separately (Saitama and Robo Inu) and also consented. | SEC press release 2024-166, https://www.sec.gov/newsroom/press-releases/2024-166 ; SEC Litigation Release 26155 (Oct 15, 2024; case no. 1:24-cv-12586-AK), https://www.sec.gov/enforcement-litigation/litigation-releases/lr-26155 |
| Pham took part in the spring 2021 launch and the July 2021 buying, then sold and left that summer. | SEC complaint v. Pham ¶¶2, 6, https://www.sec.gov/files/litigation/complaints/2024/comp-pr2024-166-pham.pdf |

## Press reports (secondary, used only for the criminal case)

| Fact | Source |
|---|---|
| Oct 9, 2024: criminal case against 18 people and companies unsealed in Boston ("Operation Token Mirrors"); Saitama executives allegedly sold secretly for tens of millions while the token reached a $7.5 billion market value; FBI-created NexFundAI token; five defendants had pleaded or agreed to plead guilty. | Fortune, https://fortune.com/crypto/2024/10/09/fbi-doj-crypto-market-manipulation-fraud-charges |
| Kohli (arrested in London, 2024) charged with wire fraud and market manipulation; ≈$20M personal gain alleged; Boston judge denied his motion to dismiss (Aug 2026, arguing Saitama is not a security); UK judge Samuel Goozee rejected his extradition challenge on Aug 19, 2026; decision passes to UK ministers; not convicted. | Crypto Briefing, Aug 26, 2026, https://cryptobriefing.com/crypto-ceo-extradition-uk-us-fraud/ |

## On-chain (Ethereum mainnet)

| Fact | How |
|---|---|
| Token **0x8B3192f5eEBD8579568A2Ed41E6FEB402f93f73F**: `name()` "Saitama Inu", `symbol()` "SAITAMA", `decimals()` 9, `totalSupply()` 10^26 raw = 100 quadrillion tokens. | `eth_call`, checked by the build on every run |
| Main pool **Uniswap V2 SAITAMA/WETH 0x9cbfb60a09A9a33a10312dA0f39977CbDb7fdE23**: `token0()` = SAITAMA, `token1()` = WETH, `factory()` = Uniswap V2 (0x5C69…aA6f), and `getPair(SAITAMA, WETH)` on that factory returns it. Created **2021-05-30 12:24:31 UTC, block 12535727** (PairCreated event, tx 0x8dbee7da15c5aa9874c8ca5a17e4790c9cfb604e2ec1f6ae1450339a1e4bfcf1). | `eth_call` + `eth_getLogs` on the factory |
| A SushiSwap SAITAMA/WETH pair also exists (0xf4bfe9b4ef01f27920e490cea87fe2642a8da18d, `getPair` on the SushiSwap factory); it is not counted, and is excluded from buyer counts. | `eth_call` |
| ETH/USD: Uniswap V2 USDC/WETH 0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc, end-of-day reserves (same as EMAX). | `eth_getLogs` |
| Daily price, liquidity, volume, peak, collapse, buyer counts, and the three checks against the complaint's figures. | See the case file's `dataNotes`; every number there is computed by the build from Swap/Sync/Transfer logs |

## Not verified, or left out

- **Allegations, not findings.** Everything from the SEC complaint is the SEC's allegation. Armand and Hernandez settled without (per the release) any finding being reported; Kohli and Tran had not settled at filing. Later docket events (final judgments, money) were **not** verified: CourtListener blocked automated access and no later SEC release was found.
- **The criminal case** is described from two press reports only. The US Attorney's release (justice.gov) returned a bot challenge to a read-only fetch and was not read; no indictment or court order was read. Which Saitama defendants are charged criminally, besides Kohli, is not stated in what was read; one search result said Armand and Hernandez pleaded guilty, but no primary or reliable source was found, so it is **not** used.
- **Partial quotes.** The complaint may quote only part of a post; texts are stored exactly as the complaint quotes them, with its brackets, [sic] and punctuation inside the quotation marks. Emoji were transcribed from the complaint's images (rendered at 400 dpi). Posts the complaint only paraphrases or quotes in fragments (Armand's Nov 2, 2021 YouTube interview, "revenue stream"/"personal gain"; his Nov 13, 2021 "out of beta" tweet) are stored without text.
- **Handles and followers.** Only Tran's handle (@Ntran1234) appears in a source (the screenshot of his Oct 23 post); it is also applied to his other X posts. The a/k/a names of the others are not stated to be X handles, so no handle is stored. No source gives follower counts.
- **Exact post times.** Tran's "I am buying more" was posted "at 8:17 a.m." and "I said HOLD!" shows "1:26 AM · Oct 23, 2021", but no time zone is given, so all posts are day-precision.
- **The SEC's ATH and percentages** (¶¶73, 134, 137) do not say what price source or exact times they use; the case file checks them against the pool and reports both, without forcing a match.
- **Trading off this pool** (other DEX pools, centralized exchanges, the wash-trading on XT and LBank the SEC describes) is not in the series or the buyer counts.
- **Holder concentration** is left out: the 2021 contract was replaced by a v2 token in 2022.
- **disclosedPayment** is null for every post: these are insiders, not paid third-party promoters, so payment disclosure is not the legal theory.

## Other candidates considered

| Candidate | Primary sources | Chain / pool | Decision |
|---|---|---|---|
| **SafeMoon** (SEC v. SafeMoon LLC, Karony, Nagy, Smith, E.D.N.Y., Nov 1, 2023; DOJ case: Karony convicted May 2025, sentenced Feb 2026 per press) | Strong for the founders' fraud (SEC complaint, SEC press release 2023-229). The celebrity promoters (Jake Paul, Soulja Boy, Lil Yachty, Nick Carter, Ben Phillips) appear only in a private class action (*Merewhuader v. SafeMoon LLC*, C.D. Cal., filed Feb 2022), i.e. allegations, with few verbatim posts. | BNB Chain; PancakeSwap V2 launched in late April 2021, days after the April 20 peak the SEC cites, so the rebuild would likely span the V1 and V2 pools (not verified); needs a BSC archive RPC that returns old logs. | **Best fallback.** Rejected for now because the promoter posts are not in a regulator's document and the BSC log rebuild is much heavier and riskier in the time available. |
| **SEC v. Ian Balina** (Sparkster SPRK, 2022) | SEC complaint (§5 for an ICO "pool"). | 2018 ICO; no Uniswap V2 (launched May 2020) in the promotion window. | Rejected: no V2 pool to rebuild. Later status of the case not checked. |
| **Justin Sun celebrity touting actions** (SEC, March 2023: Lindsay Lohan, Jake Paul, Soulja Boy and others, TRX/BTT) | SEC orders exist. | TRON; not EVM/Uniswap. | Rejected: chain. |
| **SEC v. Steven Seagal** (Bitcoiin2Gen, 2020) | SEC order. | 2018 ICO, no V2 pool. | Rejected: no pool. |
| **Centra Tech** (Mayweather, DJ Khaled, 2018) | SEC orders. | 2017 ICO, pre-Uniswap. | Rejected (already cited as background in the EMAX file). |
| **LIBRA / "Hawk Tuah" (HAWK)** | Mostly private suits and press. | Solana. | Rejected: not EVM. |
| **Forsage** (SEC, Aug 2022) | SEC complaint naming promoters. | Ethereum smart-contract pyramid paying ETH, no token pool. | Rejected: no price series to rebuild. |
| **Squid Game token** (SQUID, Nov 2021) | No enforcement action or court case found. | BNB Chain, PancakeSwap V2. | Rejected: no primary legal source. |
| **NexFundAI / Robo Inu** (same Oct 2024 sweep) | SEC complaints. | Ethereum. | Not chosen: NexFundAI was an FBI-created sting token, not a promotion of real investors' money; Robo Inu was not evaluated in depth. |
