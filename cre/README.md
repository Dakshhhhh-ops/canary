# Canary × Chainlink CRE

This folder holds the **Chainlink Runtime Environment (CRE)** workflow `canary-watch`. The contract it writes to lives in `../contracts/CanaryRegistry.sol`.

## What it does

Canary's AI agents watch crypto promoters. When several of them push the same token at once, the agents flag it and keep a hash-chained reasoning trail. The Canary app publishes its current verdict at `GET /api/watch/snapshot`.

Every 10 minutes, `canary-watch` runs on a Chainlink network of independent nodes:

1. **Fetches the snapshot (HTTP capability).** Every node fetches the snapshot on its own. They must agree on the case ID, symbol, level and trail hash, and they take the median of the dollar figures. Nothing is used unless the nodes reach consensus.
2. **Checks the liquidity on-chain (EVM read on Ethereum mainnet).** Canary's own numbers aren't trusted for this step. The workflow reads the token's Uniswap V2 pool (`getReserves`, `token0`, `token1`) and prices it with the Chainlink ETH/USD Data Feed (stablecoin pairs are priced at $1). This gives the pool's real dollar liquidity.
3. **Asks the registry what it already knows (EVM read on Sepolia).** It calls `CanaryRegistry.statusOf(caseId)` so it doesn't re-send old news.
4. **Writes signed reports (EVM write on Sepolia).** Each report goes through `writeReport` → Chainlink forwarder → `CanaryRegistry.onReport`:
   - **alert**: the agents rate the case level ≥ 1 (1 suspicious, 2 pump-and-dump, 3 collapsed)
   - **collapse**: on-chain liquidity is down **≥ 80%** from the snapshot's "liquidity before" figure

Victims' claims don't go through CRE. The hotline's relayer calls `CanaryRegistry.anchorClaim(caseId, sha256(evidence file), saltedClaimantHash)` directly. No personal data ever goes on-chain.

## Files

| File | What it is |
|---|---|
| `project.yaml` | RPC endpoints per target (`ethereum-mainnet` for reads, `ethereum-testnet-sepolia` for the registry) |
| `secrets.yaml` | Empty. The workflow needs no secrets. |
| `.env.example` | Copy it to `.env` and set `CRE_ETH_PRIVATE_KEY` (Sepolia key, no `0x`) |
| `canary-watch/workflow.yaml` | The three targets: `staging-settings`, `local-settings` and `production-settings` |
| `canary-watch/config.staging.json` | Offline demo: an inline fixture snapshot (no app needed), real mainnet reads |
| `canary-watch/config.local.json` | Reads the snapshot from the app running locally at `http://localhost:3000/api/watch/snapshot` |
| `canary-watch/config.production.json` | Reads the snapshot from the public app URL (edit `snapshotUrl`) |
| `canary-watch/workflow.ts` | The workflow logic |
| `canary-watch/main.ts` | The entry point |
| `canary-watch/workflow.test.ts` | Unit tests (`bun test`), with mocked HTTP and EVM |
| `canary-watch/abi/` | The minimal ABIs: Uniswap V2 pair, Chainlink feed, and CanaryRegistry plus the report layout |
| `canary-watch/fixtures/snapshot.json` | Example snapshot JSON, the exact shape the app must serve |

### Config fields

- `snapshotUrl`: the snapshot API URL. Set it to `""` to use `fixtureSnapshot` from the same file instead.
- `liquidity.pairAddress`: the default Uniswap V2 pair to check. A snapshot can override it with its own `pair` field.
- `liquidity.quoteTokens`: the tokens a pool can be priced in (WETH via Chainlink ETH/USD, plus USDC, USDT and DAI at $1).
- `collapseDropBps`: the collapse threshold. `8000` means 80%.
- `registry.address`: the deployed `CanaryRegistry` on Sepolia. **The zero address means observe-only mode**: the workflow decides and logs what it would write, but writes nothing.

### Snapshot API contract (for the Next.js app)

```json
{
  "caseId": "0x…64 hex",           // bytes32
  "symbol": "MOONCAT",
  "token": "0x…40 hex",            // EVM token address (anything else is recorded as 0x0)
  "level": 2,                       // 0 none, 1 suspicious, 2 pump-and-dump, 3 collapsed
  "promoters": 7,
  "trailHash": "0x…64 hex",        // head of the agents' hash-chained reasoning trail
  "liquidityBeforeUsd": 1200000,    // USD, before the dump
  "liquidityNowUsd": 185000,        // USD, the app's own current figure (logged, not trusted)
  "pair": "0x…40 hex"              // optional: the token's Uniswap V2 pair on Ethereum mainnet
}
```

The app must return the same JSON to every node during a run, so use no per-request randomness or timestamps. On-chain, liquidity is stored in **US cents** (USD × 100).

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

# Against the app running locally (npm run dev in the repo root):
cre workflow simulate ./canary-watch -T local-settings --non-interactive --trigger-index 0

# Real Sepolia transactions through the simulation forwarder (needs registry.address set and Sepolia ETH):
cre workflow simulate ./canary-watch -T staging-settings --non-interactive --trigger-index 0 --broadcast
```

In a headless shell, set `CRE_API_KEY` (created under Organization → API Keys at https://app.chain.link) instead of running `cre login`.

### Deploy the contract (Sepolia)

```powershell
cd C:\Users\daksh\canary\contracts
npm install
npm test                                  # compile + 14 contract tests on a local in-process chain
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
