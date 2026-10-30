# Chainlink CRE simulation log

Written by `npm run chain:simulate` (scripts/chain/simulate.mts) from the real output of the Chainlink CRE CLI simulator. Each workflow/target section is replaced on the next run of that combination. Do not edit by hand.

The registry address and transaction links are also in `data/onchain.json`, on `/judges` in the app, and in README.md → On-chain proof.

<!-- sim:canary-watch:staging-settings:start -->
## `canary-watch` · `staging-settings`

- **Run at:** 2026-10-30 02:43:15 UTC
- **CRE CLI:** v1.39.0
- **Registry:** [`0x9978E9F91cABfBB1e1b9A5Ae714328068B2DC116`](https://sepolia.etherscan.io/address/0x9978E9F91cABfBB1e1b9A5Ae714328068B2DC116) on Ethereum Sepolia
- **Commands** (run from `cre/`): `cre workflow build ./canary-watch -T staging-settings`, then `cre workflow simulate ./canary-watch -T staging-settings --non-interactive --trigger-index 0`, then `cre workflow simulate ./canary-watch -T staging-settings --non-interactive --trigger-index 0 --broadcast`

### What happened, step by step (dry run)

1. **Trigger.** The cron trigger (index 0, every 10 minutes in production) fired once.
3. **EVM read, Ethereum mainnet (finalized block).** `token0()`, `token1()` and `getReserves()` on the Uniswap V2 pair `0xb6CA52c7916ad7960C12Dc489FD93E5Af7cA257f`: the pool holds 13.1725 WETH. `latestRoundData()` on the Chainlink ETH/USD Data Feed `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` returned $2,204. A V2 pool holds equal value on both sides, so its liquidity today is 2 × 13.1725 × $2,204 ≈ **$58,053**, measured on-chain, not taken from Canary.
4. **Decision.** Alert: yes (level ≥ 1). Collapse: yes: the pool is down **99.2%** from its documented peak, against a 80% threshold.
6. **EVM write.** Dry run: the reports were built and signed by the simulated DON, and the write was simulated, not sent. The `--broadcast` run below sends them.

### What the `--broadcast` run did

1. **Trigger.** The cron trigger (index 0, every 10 minutes in production) fired once.
3. **EVM read, Ethereum mainnet (finalized block).** `token0()`, `token1()` and `getReserves()` on the Uniswap V2 pair `0xb6CA52c7916ad7960C12Dc489FD93E5Af7cA257f`: the pool holds 13.1725 WETH. `latestRoundData()` on the Chainlink ETH/USD Data Feed `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` returned $2,204. A V2 pool holds equal value on both sides, so its liquidity today is 2 × 13.1725 × $2,204 ≈ **$58,053**, measured on-chain, not taken from Canary.
4. **Decision.** Alert: yes (level ≥ 1). Collapse: yes: the pool is down **99.2%** from its documented peak, against a 80% threshold.
6. **EVM write, Sepolia.** `runtime.report` → `writeReport` → MockKeystoneForwarder `0x15fC6ae953E024d975e77382eEeC56A9101f9F88` → `CanaryRegistry.onReport`: alert [`0xd6003f3d3839816a223cc59c8ab05dcd63b5ca8f236341fa14f5c597d6e10c9a`](https://sepolia.etherscan.io/tx/0xd6003f3d3839816a223cc59c8ab05dcd63b5ca8f236341fa14f5c597d6e10c9a) (success), collapse [`0xc0fad796d7417550fecb531c8f4124cdf67041e47fe7538c430b30f6e0952cc9`](https://sepolia.etherscan.io/tx/0xc0fad796d7417550fecb531c8f4124cdf67041e47fe7538c430b30f6e0952cc9) (success).

### Full output: `cre workflow simulate ./canary-watch -T staging-settings --non-interactive --trigger-index 0`

Private keys and API keys are redacted.

```text
Initializing...
Loading settings...
Checking RPC connectivity...
Compiling workflow...
✓ Workflow compiled
✓ Simulation limits enabled
  HTTP: req=120kb resp=250kb timeout=10s | ConfHTTP: req=125kb resp=500kb timeout=1m30s | Consensus obs=25kb | ChainWrite evm_report=50kb evm_gas=10000000 solana_report=265b solana_cu=300000 | WASM binary=100mb compressed=20mb
  Binary hash: cbd685e6cfd4df01a51862051c629677638e25cbda1f4bd13e48d6b4637df9cc
  Config hash: df94eb38a5e2d878c54385e8a6c4b7f90ca4ee4caca48b1f73a0a6d6d348aabd
2026-10-30T08:12:27Z [SIMULATION] Simulator Initialized

2026-10-30T08:12:27Z [SIMULATION] Running trigger trigger=cron-trigger@1.0.0
2026-10-30T08:12:27Z [USER LOG] Using fixtureSnapshot from config (snapshotUrl is empty)
2026-10-30T08:12:27Z [USER LOG] Snapshot case=0xec37cf03d275f8d560ab4244c8da6e0572a67d885ae7f42c25de4e15dd407255 EMAX promoters=3 liquidityBefore=$7263266 liquidityNow(app)=$1850255
2026-10-30T08:12:29Z [USER LOG] On-chain ethereum-mainnet pair 0xb6CA52c7916ad7960C12Dc489FD93E5Af7cA257f: WETH reserve=13172539426403660684 price=220355000000 => liquidity=$58052.69
2026-10-30T08:12:29Z [USER LOG] Decision: alert=true collapse=true (drop 99.2% vs threshold 80%)
2026-10-30T08:12:29Z [USER LOG] Registry already has: trail=0x0000000000000000000000000000000000000000000000000000000000000000 collapsed=false
2026-10-30T08:12:30Z [USER LOG] Alert written to CanaryRegistry, tx 0x0000000000000000000000000000000000000000000000000000000000000000
2026-10-30T08:12:30Z [USER LOG] Collapse written to CanaryRegistry, tx 0x0000000000000000000000000000000000000000000000000000000000000000

✓ Workflow Simulation Result:
"{\"caseId\":\"0xec37cf03d275f8d560ab4244c8da6e0572a67d885ae7f42c25de4e15dd407255\",\"symbol\":\"EMAX\",\"level\":3,\"onchainLiquidityCents\":\"5805269\",\"snapshotLiquidityNowCents\":\"185025500\",\"liquidityBeforeCents\":\"726326600\",\"dropBps\":9920,\"alert\":\"written\",\"collapse\":\"written\",\"txs\":[\"0x0000000000000000000000000000000000000000000000000000000000000000\",\"0x0000000000000000000000000000000000000000000000000000000000000000\"]}"

2026-10-30T08:12:30Z [SIMULATION] Execution finished signal received
2026-10-30T08:12:30Z [SIMULATION] Skipping WorkflowEngineV2

╭──────────────────────────────────────────────────────╮
│ Simulation complete! Ready to deploy your workflow?  │
│                                                      │
│ Run cre account access to request deployment access. │
╰──────────────────────────────────────────────────────╯
```

### Full output: `cre workflow simulate ./canary-watch -T staging-settings --non-interactive --trigger-index 0 --broadcast`

Private keys and API keys are redacted.

```text
Initializing...
Loading settings...
Checking RPC connectivity...
Compiling workflow...
✓ Workflow compiled
✓ Simulation limits enabled
  HTTP: req=120kb resp=250kb timeout=10s | ConfHTTP: req=125kb resp=500kb timeout=1m30s | Consensus obs=25kb | ChainWrite evm_report=50kb evm_gas=10000000 solana_report=265b solana_cu=300000 | WASM binary=100mb compressed=20mb
  Binary hash: cbd685e6cfd4df01a51862051c629677638e25cbda1f4bd13e48d6b4637df9cc
  Config hash: df94eb38a5e2d878c54385e8a6c4b7f90ca4ee4caca48b1f73a0a6d6d348aabd
2026-10-30T08:12:55Z [SIMULATION] Simulator Initialized

2026-10-30T08:12:55Z [SIMULATION] Running trigger trigger=cron-trigger@1.0.0
2026-10-30T08:12:55Z [USER LOG] Using fixtureSnapshot from config (snapshotUrl is empty)
2026-10-30T08:12:55Z [USER LOG] Snapshot case=0xec37cf03d275f8d560ab4244c8da6e0572a67d885ae7f42c25de4e15dd407255 EMAX promoters=3 liquidityBefore=$7263266 liquidityNow(app)=$1850255
2026-10-30T08:12:57Z [USER LOG] On-chain ethereum-mainnet pair 0xb6CA52c7916ad7960C12Dc489FD93E5Af7cA257f: WETH reserve=13172539426403660684 price=220355000000 => liquidity=$58052.69
2026-10-30T08:12:57Z [USER LOG] Decision: alert=true collapse=true (drop 99.2% vs threshold 80%)
2026-10-30T08:12:57Z [USER LOG] Registry already has: trail=0x0000000000000000000000000000000000000000000000000000000000000000 collapsed=false
2026-10-30T08:13:02Z [USER LOG] Alert written to CanaryRegistry, tx 0xd6003f3d3839816a223cc59c8ab05dcd63b5ca8f236341fa14f5c597d6e10c9a
2026-10-30T08:13:13Z [USER LOG] Collapse written to CanaryRegistry, tx 0xc0fad796d7417550fecb531c8f4124cdf67041e47fe7538c430b30f6e0952cc9

✓ Workflow Simulation Result:
"{\"caseId\":\"0xec37cf03d275f8d560ab4244c8da6e0572a67d885ae7f42c25de4e15dd407255\",\"symbol\":\"EMAX\",\"level\":3,\"onchainLiquidityCents\":\"5805269\",\"snapshotLiquidityNowCents\":\"185025500\",\"liquidityBeforeCents\":\"726326600\",\"dropBps\":9920,\"alert\":\"written\",\"collapse\":\"written\",\"txs\":[\"0xd6003f3d3839816a223cc59c8ab05dcd63b5ca8f236341fa14f5c597d6e10c9a\",\"0xc0fad796d7417550fecb531c8f4124cdf67041e47fe7538c430b30f6e0952cc9\"]}"

2026-10-30T08:13:13Z [SIMULATION] Execution finished signal received
2026-10-30T08:13:13Z [SIMULATION] Skipping WorkflowEngineV2

╭──────────────────────────────────────────────────────╮
│ Simulation complete! Ready to deploy your workflow?  │
│                                                      │
│ Run cre account access to request deployment access. │
╰──────────────────────────────────────────────────────╯
```

<!-- sim:canary-watch:staging-settings:end -->

<!-- sim:canary-claims:staging-settings:start -->
## `canary-claims` · `staging-settings`

- **Run at:** 2026-10-30 02:44:26 UTC
- **CRE CLI:** v1.39.0
- **Registry:** [`0x9978E9F91cABfBB1e1b9A5Ae714328068B2DC116`](https://sepolia.etherscan.io/address/0x9978E9F91cABfBB1e1b9A5Ae714328068B2DC116) on Ethereum Sepolia
- **Commands** (run from `cre/`): `cre workflow build ./canary-claims -T staging-settings`, then `cre workflow simulate ./canary-claims -T staging-settings --non-interactive --trigger-index 0 --http-payload ./canary-claims/payloads/demo-emax.json`, then `cre workflow simulate ./canary-claims -T staging-settings --non-interactive --trigger-index 0 --http-payload ./canary-claims/payloads/demo-emax.json --broadcast`

### What happened, step by step (dry run)

This is the `canary-claims` workflow; see its README for what each step does.

### What the `--broadcast` run did

This is the `canary-claims` workflow; see its README for what each step does.
Transactions it reported: claim-verification `0x85473c9811d3e7a70d1e25187faa3298291aa61a9b12e3dc98d92a278905ae6c`.

### Full output: `cre workflow simulate ./canary-claims -T staging-settings --non-interactive --trigger-index 0 --http-payload ./canary-claims/payloads/demo-emax.json`

Private keys and API keys are redacted.

```text
Initializing...
Loading settings...
Checking RPC connectivity...
Compiling workflow...
✓ Workflow compiled
✓ Simulation limits enabled
  HTTP: req=120kb resp=250kb timeout=10s | ConfHTTP: req=125kb resp=500kb timeout=1m30s | Consensus obs=25kb | ChainWrite evm_report=50kb evm_gas=10000000 solana_report=265b solana_cu=300000 | WASM binary=100mb compressed=20mb
  Binary hash: 2406fdcfbbc2571b3c035a271d03df1ae2afebe8c9c42cd19c2e75c7b1a8fee8
  Config hash: 79cfd872ecf102a28a954e94865c3ba1c7102379151d24447a43c99f8921d130
✓ Loaded JSON from file: C:\Users\daksh\canary\cre\canary-claims\payloads\demo-emax.json
✓ Created HTTP trigger payload with 6 fields
2026-10-30T08:13:45Z [SIMULATION] Simulator Initialized

2026-10-30T08:13:45Z [SIMULATION] Running trigger trigger=http-trigger@1.0.0-alpha
2026-10-30T08:13:45Z [USER LOG] Claim for EMAX (emax) walletRef=0xe77f16719c4c383e273a187c21447b753e463e30abb3449cae31a76b40be7abd hints=5 inside=5 outside=0 dropped=0; class period 2021-05-14..2021-06-27 = blocks 12503000..12719181
2026-10-30T08:13:47Z [USER LOG] Blocks 12556426..12556426: 2 logs to the wallet, 1 confirmed buys
2026-10-30T08:13:47Z [USER LOG] Blocks 12638738..12638738: 2 logs to the wallet, 1 confirmed buys
2026-10-30T08:13:48Z [USER LOG] Blocks 12660238..12660238: 2 logs to the wallet, 1 confirmed buys
2026-10-30T08:13:48Z [USER LOG] Blocks 12700204..12700228: 4 logs to the wallet, 2 confirmed buys
2026-10-30T08:13:48Z [USER LOG] Verified: 5 buys from the pool in the class period, first at block 12556426
2026-10-30T08:13:49Z [USER LOG] Claim verification written to CanaryRegistry, tx 0x0000000000000000000000000000000000000000000000000000000000000000

✓ Workflow Simulation Result:
"{\"status\":\"verified\",\"caseId\":\"0xec37cf03d275f8d560ab4244c8da6e0572a67d885ae7f42c25de4e15dd407255\",\"case\":\"emax\",\"evidenceHash\":\"0x40befb1f86421ec08d3f41fdc704905a87b1fd8f4d5d04c6946e70f2e0eeb952\",\"walletRef\":\"0xe77f16719c4c383e273a187c21447b753e463e30abb3449cae31a76b40be7abd\",\"purchases\":5,\"firstBuyBlock\":12556426,\"buys\":[{\"block\":12556426,\"txHash\":\"0xdd3ae813c62eb3f57ca97eddaee0f2e6d456f8ab795243f855e042c186b52ba0\",\"logIndex\":271,\"amount\":\"1924122545506946367218507928\"},{\"block\":12638738,\"txHash\":\"0xccd8174eaa3dfa490f003da33a6b79ea8d50bf136b2b0afe7e8844819af938e1\",\"logIndex\":159,\"amount\":\"7635382269287763940487829541\"},{\"block\":12660238,\"txHash\":\"0x7f224d8f7ac4fcb17a245ae1443d27ce1be4b02b250bff7950fe8327c71adc99\",\"logIndex\":256,\"amount\":\"4654457184739930309143060727\"},{\"block\":12700204,\"txHash\":\"0x84cb47a710847637b9e056723aa0b91400ca4a09245b51a5f8dc0549b67f4e2c\",\"logIndex\":216,\"amount\":\"337139314603776304359248106\"},{\"block\":12700228,\"txHash\":\"0xe9da72585eda003ea6af88f6dcf099dcf720c2cba62dec2665205df4880e9a28\",\"logIndex\":301,\"amount\":\"6340474427191996224182000633\"}],\"scanned\":[{\"fromBlock\":12556426,\"toBlock\":12556426},{\"fromBlock\":12638738,\"toBlock\":12638738},{\"fromBlock\":12660238,\"toBlock\":12660238},{\"fromBlock\":12700204,\"toBlock\":12700228}],\"hints\":{\"given\":5,\"unique\":5,\"outside\":0,\"dropped\":0},\"write\":\"written\",\"txHash\":\"0x0000000000000000000000000000000000000000000000000000000000000000\"}"

2026-10-30T08:13:49Z [SIMULATION] Execution finished signal received
2026-10-30T08:13:49Z [SIMULATION] Skipping WorkflowEngineV2

╭──────────────────────────────────────────────────────╮
│ Simulation complete! Ready to deploy your workflow?  │
│                                                      │
│ Run cre account access to request deployment access. │
╰──────────────────────────────────────────────────────╯
```

### Full output: `cre workflow simulate ./canary-claims -T staging-settings --non-interactive --trigger-index 0 --http-payload ./canary-claims/payloads/demo-emax.json --broadcast`

Private keys and API keys are redacted.

```text
Initializing...
Loading settings...
Checking RPC connectivity...
Compiling workflow...
✓ Workflow compiled
✓ Simulation limits enabled
  HTTP: req=120kb resp=250kb timeout=10s | ConfHTTP: req=125kb resp=500kb timeout=1m30s | Consensus obs=25kb | ChainWrite evm_report=50kb evm_gas=10000000 solana_report=265b solana_cu=300000 | WASM binary=100mb compressed=20mb
  Binary hash: 2406fdcfbbc2571b3c035a271d03df1ae2afebe8c9c42cd19c2e75c7b1a8fee8
  Config hash: 79cfd872ecf102a28a954e94865c3ba1c7102379151d24447a43c99f8921d130
✓ Loaded JSON from file: C:\Users\daksh\canary\cre\canary-claims\payloads\demo-emax.json
✓ Created HTTP trigger payload with 6 fields
2026-10-30T08:14:15Z [SIMULATION] Simulator Initialized

2026-10-30T08:14:15Z [SIMULATION] Running trigger trigger=http-trigger@1.0.0-alpha
2026-10-30T08:14:15Z [USER LOG] Claim for EMAX (emax) walletRef=0xe77f16719c4c383e273a187c21447b753e463e30abb3449cae31a76b40be7abd hints=5 inside=5 outside=0 dropped=0; class period 2021-05-14..2021-06-27 = blocks 12503000..12719181
2026-10-30T08:14:16Z [USER LOG] Blocks 12556426..12556426: 2 logs to the wallet, 1 confirmed buys
2026-10-30T08:14:17Z [USER LOG] Blocks 12638738..12638738: 2 logs to the wallet, 1 confirmed buys
2026-10-30T08:14:17Z [USER LOG] Blocks 12660238..12660238: 2 logs to the wallet, 1 confirmed buys
2026-10-30T08:14:18Z [USER LOG] Blocks 12700204..12700228: 4 logs to the wallet, 2 confirmed buys
2026-10-30T08:14:18Z [USER LOG] Verified: 5 buys from the pool in the class period, first at block 12556426
2026-10-30T08:14:25Z [USER LOG] Claim verification written to CanaryRegistry, tx 0x85473c9811d3e7a70d1e25187faa3298291aa61a9b12e3dc98d92a278905ae6c

✓ Workflow Simulation Result:
"{\"status\":\"verified\",\"caseId\":\"0xec37cf03d275f8d560ab4244c8da6e0572a67d885ae7f42c25de4e15dd407255\",\"case\":\"emax\",\"evidenceHash\":\"0x40befb1f86421ec08d3f41fdc704905a87b1fd8f4d5d04c6946e70f2e0eeb952\",\"walletRef\":\"0xe77f16719c4c383e273a187c21447b753e463e30abb3449cae31a76b40be7abd\",\"purchases\":5,\"firstBuyBlock\":12556426,\"buys\":[{\"block\":12556426,\"txHash\":\"0xdd3ae813c62eb3f57ca97eddaee0f2e6d456f8ab795243f855e042c186b52ba0\",\"logIndex\":271,\"amount\":\"1924122545506946367218507928\"},{\"block\":12638738,\"txHash\":\"0xccd8174eaa3dfa490f003da33a6b79ea8d50bf136b2b0afe7e8844819af938e1\",\"logIndex\":159,\"amount\":\"7635382269287763940487829541\"},{\"block\":12660238,\"txHash\":\"0x7f224d8f7ac4fcb17a245ae1443d27ce1be4b02b250bff7950fe8327c71adc99\",\"logIndex\":256,\"amount\":\"4654457184739930309143060727\"},{\"block\":12700204,\"txHash\":\"0x84cb47a710847637b9e056723aa0b91400ca4a09245b51a5f8dc0549b67f4e2c\",\"logIndex\":216,\"amount\":\"337139314603776304359248106\"},{\"block\":12700228,\"txHash\":\"0xe9da72585eda003ea6af88f6dcf099dcf720c2cba62dec2665205df4880e9a28\",\"logIndex\":301,\"amount\":\"6340474427191996224182000633\"}],\"scanned\":[{\"fromBlock\":12556426,\"toBlock\":12556426},{\"fromBlock\":12638738,\"toBlock\":12638738},{\"fromBlock\":12660238,\"toBlock\":12660238},{\"fromBlock\":12700204,\"toBlock\":12700228}],\"hints\":{\"given\":5,\"unique\":5,\"outside\":0,\"dropped\":0},\"write\":\"written\",\"txHash\":\"0x85473c9811d3e7a70d1e25187faa3298291aa61a9b12e3dc98d92a278905ae6c\"}"

2026-10-30T08:14:25Z [SIMULATION] Execution finished signal received
2026-10-30T08:14:25Z [SIMULATION] Skipping WorkflowEngineV2

╭──────────────────────────────────────────────────────╮
│ Simulation complete! Ready to deploy your workflow?  │
│                                                      │
│ Run cre account access to request deployment access. │
╰──────────────────────────────────────────────────────╯
```

<!-- sim:canary-claims:staging-settings:end -->
