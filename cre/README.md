# Canary × Chainlink CRE

This folder holds two **Chainlink Runtime Environment (CRE)** workflows: `canary-watch` (catches the pump and the collapse) and `canary-claims` (confirms a victim's purchase before their claim is recorded, see [below](#canary-claims-the-chainlink-network-confirms-the-victims-evidence)). The contract it writes to lives in `../contracts/CanaryRegistry.sol`.

## What it does

Canary's AI agents watch crypto promoters. When several of them push the same token at once, the agents flag it and keep a hash-chained reasoning trail. The Canary app publishes its current verdict at `GET /api/watch/snapshot`.

Every 10 minutes, `canary-watch` runs on a Chainlink network of independent nodes:

1. **Fetches the snapshot (HTTP capability).** Every node fetches the snapshot on its own. They must agree on the case ID, symbol, level and trail hash, and they take the median of the dollar figures. Nothing is used unless the nodes reach consensus.
2. **Checks the liquidity on-chain (EVM read on Ethereum mainnet).** Canary's own numbers aren't trusted for this step. The workflow reads the token's Uniswap V2 pool (`getReserves`, `token0`, `token1`) and prices it with the Chainlink ETH/USD Data Feed (stablecoin pairs are priced at $1). This gives the pool's real dollar liquidity.
3. **Asks the registry what it already knows (EVM read on Sepolia).** It calls `CanaryRegistry.statusOf(caseId)` so it doesn't re-send old news.
4. **Writes signed reports (EVM write on Sepolia).** Each report goes through `writeReport` → Chainlink forwarder → `CanaryRegistry.onReport`:
   - **alert**: the agents rate the case level ≥ 1 (1 suspicious, 2 pump-and-dump, 3 collapsed)
   - **collapse**: on-chain liquidity is down **≥ 80%** from the snapshot's "liquidity before" figure

Victims' claims can be anchored two ways. The hotline's relayer calls `CanaryRegistry.anchorClaim(caseId, sha256(evidence file), saltedClaimantHash)` directly (any claim, including people who bought on an exchange). For a claim with a wallet, the `canary-claims` workflow has the Chainlink network confirm the purchases on Ethereum mainnet first and records a `ClaimVerified` report (which anchors the claim too). No personal data ever goes on-chain.

## Files

| File | What it is |
|---|---|
| `project.yaml` | RPC endpoints per target (`ethereum-mainnet` for reads, an archive node because `canary-claims` reads 2021 logs; `ethereum-testnet-sepolia` for the registry) |
| `secrets.yaml` | Empty. The workflow needs no secrets. |
| `.env.example` | Copy it to `.env` and set `CRE_ETH_PRIVATE_KEY` (Sepolia key, no `0x`) |
| `canary-watch/workflow.yaml` | The three targets: `staging-settings`, `local-settings` and `production-settings` |
| `canary-watch/config.staging.json` | No app needed: the app's real EMAX verdict inline as `fixtureSnapshot`, real mainnet reads of the EMAX/WETH pool |
| `canary-watch/config.local.json` | Reads the snapshot over HTTP from the app running locally at `http://localhost:3100/api/watch/snapshot?case=emax` |
| `canary-watch/config.production.json` | Reads the snapshot from the public app URL (`npm run chain:simulate -- --target production-settings --url https://…` fills it in) |
| `canary-watch/workflow.ts` | The workflow logic |
| `canary-watch/main.ts` | The entry point |
| `canary-watch/workflow.test.ts` | Unit tests (`bun test`), with mocked HTTP and EVM |
| `canary-watch/abi/` | The minimal ABIs: Uniswap V2 pair, Chainlink feed, and CanaryRegistry plus the report layout |
| `canary-watch/fixtures/snapshot.json` | The app's live EMAX snapshot (`GET /api/watch/snapshot?case=emax`), the exact JSON the workflow reads; `config.staging.json` embeds the same object |
| `SIMULATION.md` | Written by `npm run chain:simulate`: the simulator's full output (keys redacted) and what each step did |

### Config fields

- `snapshotUrl`: the snapshot API URL. Set it to `""` to use `fixtureSnapshot` from the same file instead.
- `liquidity.pairAddress`: the default Uniswap V2 pair to check (the EMAX/WETH pair `0xb6CA52c7916ad7960C12Dc489FD93E5Af7cA257f`). A snapshot can override it with its own `pair` field.
- `liquidity.quoteTokens`: the tokens a pool can be priced in (WETH via Chainlink ETH/USD, plus USDC, USDT and DAI at $1).
- `collapseDropBps`: the collapse threshold. `8000` means 80%.
- `registry.address`: the deployed `CanaryRegistry` on Sepolia. **The zero address means observe-only mode**: the workflow decides and logs what it would write, but writes nothing.

### Snapshot API contract (for the Next.js app)

```json
{
  "caseId": "0x…64 hex",           // bytes32, keccak256("canary:<slug>")
  "symbol": "EMAX",
  "token": "0x…40 hex",            // EVM token address (anything else is recorded as 0x0)
  "level": 3,                       // 0 none, 1 suspicious, 2 pump-and-dump, 3 collapsed
  "promoters": 3,
  "trailHash": "0x…64 hex",        // head of the agents' hash-chained reasoning trail
  "liquidityBeforeUsd": 7263266,    // USD, the pool's documented peak before the dump
  "liquidityNowUsd": 1850255,       // USD, the app's own last figure (logged, not trusted)
  "pair": "0x…40 hex"              // optional: the token's Uniswap V2 pair on Ethereum mainnet
}
```

The app must return the same JSON to every node during a run, so use no per-request randomness or timestamps. On-chain, liquidity is stored in **US cents** (USD × 100).

## One-command proof (recommended)

From the repo root, once `.env.local` has `CANARY_RELAYER_KEY=0x…` (a fresh, funded Sepolia **test** wallet) and you have run `cre login`:

```bash
npm run chain:setup                    # compile + deploy CanaryRegistry, write the address into config.*.json, .env.local, cre/.env, data/onchain.json
npm run chain:simulate -- --broadcast  # build, simulate (dry run), simulate --broadcast; writes cre/SIMULATION.md + tx hashes into data/onchain.json
npm run chain:status                   # statusOf + events for EMAX on Sepolia
```

What staging does today: it takes the app's real EMAX verdict (level 3, 3 promoters, documented peak pool liquidity of $7.26M), reads the EMAX/WETH Uniswap V2 pool on Ethereum mainnet right now (about 13 WETH), prices it with the Chainlink ETH/USD feed, finds a drop of well over 80%, and writes an **alert** and a **collapse** report.

Notes:

- `chain:simulate` waits until Sepolia has **finalized** the registry's deploy block (~13 minutes after `chain:setup`), because the workflow reads the registry at the last finalized block. `--no-wait` skips the wait.
- `--target local-settings` exercises the HTTP fetch + consensus against the running app (`--url http://localhost:3000` if it isn't on port 3100); `--target production-settings --url https://<app>` against the deployed app.
- Running `--broadcast` again sends nothing new: the registry already holds the verdict (the workflow reads `statusOf` first).
- `--workflow <folder>` simulates another workflow in this folder with the same logging and recording.

## Commands (Windows PowerShell)

Everything is installed under `C:\Users\daksh\canary\.tools` (git-ignored): the CRE CLI v1.39.0 is `.tools\cre.exe` and Bun 1.3.11 is in `.tools\bun\node_modules\.bin`. First, put both on PATH for the session:

```powershell
$env:Path = "C:\Users\daksh\canary\.tools;C:\Users\daksh\canary\.tools\bun\node_modules\.bin;$env:Path"
cre version          # CRE CLI version v1.39.0
bun --version        # 1.3.11
```

### Install, test and compile (no login needed)

```powershell
cd C:\Users\daksh\canary\cre\canary-watch
bun install
bun test                                        # 11 unit tests (mocked HTTP and EVM)
cd ..
cre workflow build ./canary-watch -T staging-settings   # -> canary-watch/binary.wasm
```

### Simulate (needs a Chainlink account)

```powershell
cre login            # opens the browser: Chainlink Platform account + 2FA (create one at https://app.chain.link — see https://docs.chain.link/chainlink-platform/creating-an-account)
cre whoami
cd C:\Users\daksh\canary\cre
copy .env.example .env   # then put your Sepolia key (64 hex, no 0x) in CRE_ETH_PRIVATE_KEY

# Dry run: real mainnet reads; writes are simulated, not sent.
cre workflow simulate ./canary-watch -T staging-settings --non-interactive --trigger-index 0

# Against the app running locally (npm run dev in the repo root; config.local.json expects port 3100):
cre workflow simulate ./canary-watch -T local-settings --non-interactive --trigger-index 0

# Real Sepolia transactions through the simulation forwarder (needs registry.address set and Sepolia ETH):
cre workflow simulate ./canary-watch -T staging-settings --non-interactive --trigger-index 0 --broadcast
```

In a headless shell, set `CRE_API_KEY` (created under Organization → API Keys at https://app.chain.link) instead of running `cre login`.

### Deploy the contract (Sepolia)

```powershell
cd C:\Users\daksh\canary\contracts
npm install
npm test                                  # compile + 18 contract tests on a local in-process chain
$env:SEPOLIA_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com"   # or your Alchemy/Infura URL
$env:DEPLOYER_PRIVATE_KEY = "0x…"         # funded Sepolia key (faucet: https://faucets.chain.link/sepolia)
$env:CANARY_FORWARDERS = "simulation"     # simulation | production | both
node deploy.mts                           # writes out/deployment.sepolia.json
```

Next, put the printed address into `registry.address` in `canary-watch/config.*.json`.

**Forwarders** (from https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts, Ethereum Sepolia):

- `0x15fC6ae953E024d975e77382eEeC56A9101f9F88` is the MockKeystoneForwarder, used by `cre workflow simulate --broadcast`. It is **permissionless and checks no signatures**, so use it only for the demo.
- `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` is the KeystoneForwarder, used by deployed workflows.

**Going to production:** run `cre workflow deploy ./canary-watch -T production-settings` (this needs deploy access: `cre account access`). Then, on the contract, call `setForwarder(0x15fC…9F88, false)`, `setForwarder(0xF834…4482, true)` and `setExpectedWorkflow(<cre workflow hash>, <your owner address>)`.

> **Two workflows, one registry:** `setExpectedWorkflow` pins a single workflow ID. `canary-watch` and `canary-claims` both write to the same `CanaryRegistry`, so in production pin only the owner: `setExpectedWorkflow(0x00…00, <your workflow owner address>)`. Pinning one workflow ID would make every report from the other one revert with `WrongWorkflow`.

---

## canary-claims: the Chainlink network confirms the victim's evidence

When a victim files a claim through the hotline and gave a wallet address, `canary-claims` has a Chainlink DON check on Ethereum mainnet that the wallet really bought the coin from its trading pool during the class period. Only after that does it record the claim in `CanaryRegistry`. A court, a class-action administrator or a regulator can read the result on Sepolia without trusting Canary's own lookup.

### Trigger: HTTP (chosen over cron + `GET /api/claims/pending`)

The CRE TypeScript SDK 1.23.0 has an HTTP trigger (`cre.capabilities.HTTPCapability`, `http-trigger@1.0.0-alpha`), and the CLI v1.39.0 simulates it with `--http-payload <json | @file>`. So there's no need for a polling cron or a pending-claims queue in the app:

- **Simulation:** `authorizedEvmAddresses: []` (an open trigger; the docs allow that only in simulation).
- **Deployed:** the app signs a JSON-RPC `workflows.execute` request with a JWT from a key listed in `authorizedEvmAddresses` (`src/lib/claims/verify.ts`). The run is asynchronous: the app then reads the result from the registry (`GET /api/claims/verify`). CRE rate-limits an HTTP trigger to one run per 30 seconds per workflow (`PerWorkflow.HTTPTrigger.RateLimit`), which is enough for a hotline.

### Payload (what the app sends)

```json
{
  "caseId": "0xec37cf03d275f8d560ab4244c8da6e0572a67d885ae7f42c25de4e15dd407255",
  "wallet": "0xac85724be118b69a9aee3b03bd2af2ac0071f26a",
  "evidenceHash": "0x40befb1f86421ec08d3f41fdc704905a87b1fd8f4d5d04c6946e70f2e0eeb952",
  "claimantRef": "0x021611b967a5966f24b47ab975d28eec68864e60818b278cea8bf9bfbc8e6808",
  "walletSalt": "0x93430834fe0501891fba25ddcb345e95157c0e8a542b568505bdd07b9a516272",
  "purchaseBlocks": [12556426, 12638738, 12660238, 12700204, 12700228]
}
```

- `caseId` is `keccak256("canary:emax")`, the same ID `canary-watch` uses.
- `evidenceHash` is the SHA-256 of the claim pack. `claimantRef` is the salted claimant hash, the same pair as `anchorClaim`.
- `walletSalt` is optional. The report carries `walletRef = keccak256(abi.encodePacked(walletSalt, wallet))`, never the wallet itself. Without a salt, anyone could test the ~100,000 EMAX buyers against `walletRef`, so the app should send the same browser-held salt it used for `claimantRef`.
- `purchaseBlocks` are **hints**: the blocks where the app's archive-node search (`src/lib/hotline/purchases.ts`) found the buys. The DON re-checks every hint on-chain; a wrong or invented hint simply finds nothing.

This is the hotline's demo wallet (a real EMAX buyer: 5 buys from June 2 to June 25, 2021). The payload is saved as `canary-claims/payloads/demo-emax.json`, and the evidence and claimant hashes are demo values.

### How the verification works

The class period is May 14 to June 27, 2021 (UTC days, inclusive), in *In re EthereumMax Investor Litigation*. As Ethereum mainnet blocks, found by binary search on block timestamps against an archive node:

| Bound | Block | Timestamp (UTC) |
|---|---|---|
| First block of 2021-05-14 | **12,429,199** | 2021-05-14 00:00:13 (block 12,429,198 is 23:59:58 the day before) |
| EMAX/WETH pool created (case file) | **12,503,000** | 2021-05-25 10:39:49 |
| Last block of 2021-06-27 | **12,719,181** | 2021-06-27 23:59:27 (block 12,719,182 is 2021-06-28 00:00:01) |

There can't be buys from the pool before it existed, so the workflow scans **12,503,000 to 12,719,181**. Trading from May 14 to May 24 happened on the old EMAX contract, which is not checked (the hotline doesn't check it either).

For each claim the workflow does the following:

1. **Plans the reads.** It keeps the hinted blocks inside that range and groups them into windows of at most **100 blocks**. CRE's `ChainRead.LogQueryBlockLimit` is 100 blocks per log query, so the ~216,000-block period can't be scanned in one go; that is why hints are needed. It runs at most `maxLogQueries` = 10 windows, because CRE allows 15 EVM reads per execution (1 `token0` + 10 log queries + 1 registry read). Hints it can't check are counted in `hints.dropped`, never dropped silently.
2. **EVM read, mainnet:** `pair.token0()`, to know which side of a `Swap` is EMAX.
3. **EVM read, mainnet:** `filterLogs` for each window with `addresses = [EMAX, pool]`, `topics = [[Transfer, Swap], *, [wallet]]`. This returns only logs *addressed to the wallet*: an EMAX `Transfer` with `to = wallet`, and a pool `Swap` with `to = wallet`. A **purchase** is a `Transfer(from = pool, to = wallet)` with a pool `Swap(to = wallet)` in the same transaction that pays out EMAX. A pool transfer without a swap (for example, liquidity being withdrawn) doesn't count. Every DON node runs the same reads, and the EVM capability's results reach consensus before the workflow uses them.
4. **EVM read, Sepolia:** `claimVerifiedAt(caseId, evidenceHash)`. If the claim is already verified, nothing more is sent.
5. **EVM write, Sepolia:** a DON-signed report goes `writeReport` → forwarder → `onReport`, with **kind 3**: `abi.encode(uint8 3, abi.encode(bytes32 caseId, bytes32 evidenceHash, bytes32 claimantRef, bytes32 walletRef, uint32 purchases, uint64 firstBuyBlock))`. The contract emits `ClaimVerified(caseId, evidenceHash, claimantRef, purchases, firstBuyBlock, at)` and also anchors the claim (`ClaimAnchored`), unless the relayer already did. Reports are idempotent and accepted only from the forwarder. The contract also offers `claimVerifiedAt(caseId, evidenceHash)` and `getClaimVerification(...)`.

With `registry.address` set to the zero address the workflow runs **observe-only**: it verifies and logs, but writes nothing.

**Limits (stated plainly):**

- It confirms the purchases it was **pointed at**. `purchases` counts the hinted buys that are real, not every buy the wallet ever made. Without hints, the 100-block log limit makes a full search impossible in CRE.
- It sees only buys **straight from the EMAX/WETH Uniswap V2 pool** into the claimed wallet. Buys through another pool, an aggregator that forwards the tokens, or an exchange are not visible. Those claims still go through `anchorClaim`, without the "verified" mark.
- It proves the wallet bought. It doesn't prove the *claimant* controls the wallet. That would need a signature from the wallet, which could be added later.
- The DON's mainnet RPC must serve **2021 logs (an archive node)**. For simulation, `project.yaml` points `ethereum-mainnet` at `https://mainnet.gateway.tenderly.co`, because publicnode is pruned below block 15,500,000. `canary-watch`'s latest-state reads work the same on it.
- The wallet address reaches the DON nodes, because they have to read it. On-chain there is only `walletRef`.

### Files

| File | What it is |
|---|---|
| `canary-claims/workflow.ts` | The workflow: HTTP trigger → mainnet `token0` + `filterLogs` → Sepolia `claimVerifiedAt` → kind-3 report |
| `canary-claims/abi/index.ts` | Transfer/Swap topics, Uniswap `token0`, registry `claimVerifiedAt`, the kind-3 report layout |
| `canary-claims/config.{staging,local,production}.json` | The EMAX case (token, pool, class-period blocks), query limits, registry. Production needs `authorizedEvmAddresses` and `registry.address` |
| `canary-claims/payloads/demo-emax.json` | The demo claim above |
| `canary-claims/fixtures/mainnet-logs.emax-demo.json` | Real mainnet logs for the demo wallet (captured with `eth_getLogs`), replayed by the tests |
| `canary-claims/fixtures/reports.generated.json` | Written by `bun test`: the exact report bytes, fed into the real contract by `contracts/test` |
| `canary-claims/workflow.test.ts` | 19 unit tests (mocked EVM serving the real logs) |

### Install, test, compile, simulate (Windows PowerShell)

```powershell
$env:Path = "C:\Users\daksh\canary\.tools;C:\Users\daksh\canary\.tools\bun\node_modules\.bin;$env:Path"
cd C:\Users\daksh\canary\cre\canary-claims
bun install
bun test                                                   # 19 tests
cd ..
cre workflow build ./canary-claims -T staging-settings     # -> canary-claims/binary.wasm (takes ~2 minutes)

cre login                                                  # once (or set CRE_API_KEY)
# Dry run with the demo claim: real mainnet reads, observe-only until registry.address is set
cre workflow simulate ./canary-claims -T staging-settings --non-interactive --trigger-index 0 --http-payload "./canary-claims/payloads/demo-emax.json"
```

Expected outcome: 4 log queries (blocks 12556426, 12638738, 12660238 and 12700204–12700228), then `Verified: 5 buys from the pool in the class period, first at block 12556426`, and a result with `"status":"verified","purchases":5,"firstBuyBlock":12556426`.

To write to Sepolia for real, deploy the updated `CanaryRegistry` (it must include report kind 3), put its address in `canary-claims/config.staging.json` → `registry.address`, set `CRE_ETH_PRIVATE_KEY` in `cre/.env`, then add `--broadcast` to the simulate command.

For any other claim, `POST /api/claims/verify` returns the exact simulate command and payload when the workflow isn't deployed yet. Write the payload to a file and pass `--http-payload @file`; Windows PowerShell 5.1 mangles inline JSON quotes.

### Deploy and connect the app

```powershell
cre workflow deploy ./canary-claims -T production-settings   # after setting authorizedEvmAddresses + registry.address
```

Then set these in the app's environment (server only):

| Variable | Value |
|---|---|
| `CRE_CLAIMS_TRIGGER_URL` | `https://01.gateway.zone-a.cre.chain.link` (CRE Public gateway) |
| `CRE_CLAIMS_WORKFLOW_ID` | the 64-hex workflow ID printed by `cre workflow deploy` |
| `CRE_CLAIMS_TRIGGER_KEY` | private key of the address in `authorizedEvmAddresses` (it only triggers the workflow; it needs no funds) |

App API:

- `POST /api/claims/verify` takes `{ caseSlug?, wallet, evidenceHash, claimantRef, walletSalt?, purchaseBlocks? }`. If `purchaseBlocks` is missing, the server looks up the wallet's class-period buys itself. It returns one of:
  - `verified`: already on-chain, with `purchases`, `firstBuyBlock` and `verifiedAt`
  - `submitted`: sent to the DON
  - `not-configured`: with `simulateCommand` and `payload`
  - `no-purchases` or `error`
- `GET /api/claims/verify?caseSlug=emax&evidenceHash=0x…` returns `verified`, `pending` or `not-configured`. Use it to poll after `submitted`.
