# EthereumMax (EMAX): where each fact comes from

Rebuild the on-chain numbers with `npx tsx scripts/build-emax.mts` (add `--fresh` to skip the local cache).
Check the output with `npx tsx scripts/check-emax.mts`.
Text facts (posts, legal actions) are typed into the build script from the documents below. Nothing is generated.

## Regulators and courts (primary sources)

| Fact | Source |
|---|---|
| Kardashian posted on Instagram on **June 13, 2021**, with an intro video saying she had a "big announcement". The post linked to the EthereumMax site and ended "#AD". Exact text is transcribed from the post image in ¶9 (line breaks joined with spaces). | SEC order 33-11116 ¶9, https://www.sec.gov/litigation/admin/2022/33-11116.pdf |
| She was paid **$250,000** "through an intermediary" and did not disclose the payment or the amount. She had about **225 million** Instagram followers. | Same order ¶3, ¶10 |
| Kardashian settled on **Oct 3, 2022**: $250,000 disgorgement + $10,415.35 interest + $1,000,000 penalty (≈ $1.26M). Section 17(b). 3-year ban on paid promotion of crypto asset securities. | Same order §IV; SEC press release 2022-183, https://www.sec.gov/newsroom/press-releases/2022-183 |
| EMAX was available for public trading from about **May 14, 2021**. | Both SEC orders (Kardashian ¶5, Pierce ¶6) |
| Pierce tweeted (@paulpierce34, "in excess of approximately 4 million" followers) on **May 26, 28, 29, 30 (two tweets) and June 5, 2021**. Quotes are taken exactly from the order's text and tweet images: 8 rocket emoji in the "Put me in coach" tweet; the May 30 "train" tweet is quoted as the SEC quotes it, with the ellipsis. | SEC order 33-11157 ¶¶4, 11–20, https://www.sec.gov/litigation/admin/2023/33-11157.pdf |
| Pierce was paid ≈1.62 trillion EMAX worth **$244,116** (May 24 – June 18, 2021). He sold while telling followers he was holding or buying. The $2,520,087 screenshot was someone else's holdings. | Same order ¶¶10, 12–14, 17, 20, 22 |
| Pierce settled on **Feb 17, 2023**: $244,116 + $15,449 + **$1,150,000** penalty (order §IV.C). Sections 17(a)(2) and 17(b). | Same order; SEC press release 2023-34, https://www.sec.gov/newsroom/press-releases/2023-34 |
| Mayweather's 2018 SEC touting settlement (Centra Tech and two other ICOs): $300k disgorgement, $300k penalty, $14,775 interest. | SEC press release 2018-268, https://www.sec.gov/newsroom/press-releases/2018-268 |
| Class action **Huegerich v. Gentile et al.**, C.D. Cal. No. 2:22-cv-00163, filed **Jan 7, 2022**. Plaintiff Ryan Huegerich (New York). Later consolidated as *In re EthereumMax Investor Litigation*. | Fortune, Jan 11, 2022, https://fortune.com/2022/01/11/kim-kardashian-floyd-mayweather-crypto-token-ethereummax-lawsuit ; NBC News, Jan 12, 2022, https://www.nbcnews.com/tech/tech-news/kim-kardashian-floyd-mayweather-sued-investors-alleged-crypto-scam-rcna11921 |
| **Dec 6, 2022** order (Judge Michael W. Fitzgerald, Dkt. 99). The omnibus motion was granted. Most claims were dismissed with leave to amend. The CLRA claim was dismissed without leave. RICO was dismissed for lack of standing, with leave to amend. The class period is May 14 – June 27, 2021. Also covers the complaint's allegations about Mayweather (ticket promotion on or around May 26, 2021; Miami Bitcoin conference T-shirt and quote; paid in ETH) and Kardashian's May 30, 2021 story (image transcribed). | https://www.johnreedstark.com/wp-content/uploads/sites/180/2022/12/Kardasnhian-Dismissil.pdf |
| **June 6, 2023**: motions to dismiss the amended complaint were denied in part, and claims against Kardashian, Mayweather and Pierce went forward. | Scott+Scott (plaintiffs' co-counsel, an interested source), https://scott-scott.com/court-refuses-to-dismiss-the-ethereummax-case/ ; Coinspeaker, https://www.coinspeaker.com/kim-kardashian-emax-case-proceeds/ |
| **Aug 2025**: classes certified for CA, FL, NY and NJ buyers (May–June 2021). Nationwide class denied. | Cointelegraph, Aug 8, 2025, https://cointelegraph.com/news/ethereummax-class-action-lawsuit-celebrities |
| The Mayweather–Logan Paul exhibition took place on June 6, 2021, at Hard Rock Stadium, Miami Gardens. NBC: EMAX was accepted as payment for tickets, and Mayweather "endorsed the token in his boxing match". | Wikipedia, https://en.wikipedia.org/wiki/Floyd_Mayweather_Jr._vs._Logan_Paul ; NBC News (above) |

## On-chain (Ethereum mainnet)

| Fact | How |
|---|---|
| EMAX token **0x15874d65e649880c2614e7a480cb7c9A55787FF6** (18 decimals). Created 2021-05-25 01:31 UTC. Upgradeable proxy. | Blockscout `/api/v2/tokens/…` and `/addresses/…` (creation tx 0x16f7d9fc…3af4) |
| Old contract **0xA3E059c0b01F07F211c85bF7b4f1d907AfB011df**, "EthereumMax (Deprecated)", created 2021-05-12. | Blockscout |
| Main pool: **Uniswap V2 EMAX/WETH 0xb6CA52c7916ad7960C12Dc489FD93E5Af7cA257f**. token0 = EMAX, token1 = WETH, factory = Uniswap V2. Created 2021-05-25 10:39 UTC (block 12503000). | `token0()`, `token1()` and `factory()` are checked by the script on every run |
| Daily price, liquidity and volume (2021-05-25 → 2021-09-30) | 339,213 Swap and the matching Sync events of the pair, fetched via `eth_getLogs` (Tenderly public gateway). Price = end-of-day reserves. ETH/USD = end-of-day reserves of Uniswap V2 USDC/WETH 0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc |
| Peak close **2021-05-30, $5.088e-7**. Collapse **2021-06-27, $4.389e-8 (−91.4%)**, the first close ≥90% below peak. | Computed from the series |
| Burn of **437.97 trillion EMAX** to 0x…dEaD at **2021-06-14 01:08:47 UTC** (June 13, 6:08 pm Pacific) from 0x3b6c70a7…4638, tx 0x23078c9e…3773. That was 77.5% of that wallet's 565.3T balance. | `eth_getLogs` Transfer to 0x…dEaD; `balanceOf` at the previous block |
| **8,671** distinct buyers from the pool in the 72 h after that burn (13,076 buy transfers). **56,954** buyers during the pump (May 26 – June 2). | EMAX Transfer events with from = pair |

## Not verified, or left out

- **Mayweather's own posts**: no regulator or court quotes a Mayweather social-media post about EMAX. His three entries are events described in the court's summary of the complaint and in press reports. They are allegations, with `platform: "other"` and `disclosedPayment: null`. The Bitcoin-conference date is only "early June 2021" (from the FT chart reproduced in the court order), so it is stored as month precision. The claim that he wore EthereumMax on his fight trunks appears only in secondary reporting and is not used.
- **Kardashian's May 30, 2021 story**: an allegation from the complaint, shown in the court order. The SEC did not cite it.
- **Pierce's May 28 tweet**: emoji-only. The emoji count can't be read reliably from the order's image, so no text is stored.
- **Exact post times**: none of the sources give one. The Kardashian post time is inferred from its own "a few minutes ago … burned" line plus the burn transaction. Whether the burning wallet was EthereumMax's "admin wallet" is not established.
- **Date mismatches**: the court's summary of the complaint dates Kardashian's post June 14 and Pierce's last tweet June 6. The SEC dates are June 13 and June 5. The SEC dates are used. The court order also misprints 2022 for 2021 in places.
- **Pierce penalty**: the SEC press release says $1,115,000, the order says $1,150,000. The order's figure is used because it is the one that adds up to the release's $1.409M total.
- **June 2023 ruling**: exactly which claims survived was taken from secondary reports. The order itself was not read, because CourtListener/PACER blocked automated access.
- **Aug 2025 certification date**: Cointelegraph says only "a Wednesday filing", so the date is stored as 2025-08. No later developments (settlement or trial) were found as of Oct 2026.
- **Holder concentration**: left out. EMAX's reported `totalSupply` (904T today, 2,000T in June 2021) is smaller than the sum of its largest balances, so a top-10 percentage would be meaningless.
- **May 14–24, 2021**: trading on the old contract is not in the series, because the migration mechanics were not verified.
- **Intraday highs**: the complaint's $0.000000863 all-time high on May 29 (CoinMarketCap-style) is higher than this file's end-of-day peak. That difference is expected.
- **Data source note**: Blockscout's Etherscan-style API rate-limited this machine for about 30 minutes during the build, so logs come from a JSON-RPC archive node. Set `RPC_URL` to use another node, which must return `blockTimestamp` on logs.
