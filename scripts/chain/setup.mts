// npm run chain:setup  [-- --force] [-- --skip-compile] [-- --workflows canary-watch,canary-claims]
//
// One-time on-chain setup for the Chainlink bounty proof:
//   1. reads CANARY_RELAYER_KEY from .env.local (a fresh, funded Sepolia TEST wallet)
//   2. checks it has enough Sepolia ETH (friendly stop + faucet link if not)
//   3. compiles contracts/CanaryRegistry.sol and deploys it to Sepolia
//      (forwarder = the CRE simulation MockKeystoneForwarder, relayer = this wallet)
//   4. writes the address everywhere it is needed:
//        cre/*/config.*.json  registry.address
//        .env.local           CANARY_REGISTRY_ADDRESS, CANARY_REGISTRY_FROM_BLOCK (only these lines)
//        cre/.env             CRE_ETH_PRIVATE_KEY (same key, no 0x; git-ignored, checked)
//        data/onchain.json    the public deployment record the app and README read
//
// Idempotent: if data/onchain.json already points at a registry with code on this chain, nothing is
// redeployed (the files above are just re-synced). Pass --force to deploy a fresh registry.
//
// Testing against a local chain: SEPOLIA_RPC_URL=http://127.0.0.1:8545 CANARY_ALLOW_NON_SEPOLIA=1
// CANARY_RELAYER_KEY=<throwaway> node scripts/chain/setup.mts   (process.env wins over .env.local)
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, defineChain, encodeDeployData, formatEther, getAddress, http, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  DEFAULT_SEPOLIA_RPC,
  FAUCET,
  P,
  ROOT,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_MOCK_FORWARDER,
  envValue,
  explorerFor,
  fail,
  flag,
  gitIgnored,
  info,
  normaliseKey,
  ok,
  opt,
  readJson,
  readOnchain,
  run,
  upsertEnvFile,
  writeJson,
  writeOnchain,
  type Onchain,
} from "./lib.mts";
import { updateReadme } from "./readme.mts";

const MIN_BALANCE = 3_000_000_000_000_000n; // 0.003 ETH
const GAS_PER_REPORT = 500_000n; // registry.gasLimit in the CRE configs; two reports (alert + collapse) per run

console.log("\nCanary · on-chain setup (CanaryRegistry on Ethereum Sepolia)\n");

// ── 1. key ──
const rawKey = envValue("CANARY_RELAYER_KEY");
if (!rawKey) {
  fail(
    [
      "CANARY_RELAYER_KEY is not set.",
      "  Add one line to .env.local in the repo root:",
      "    CANARY_RELAYER_KEY=0x<64 hex characters>",
      "  Use a FRESH test wallet that only ever holds Sepolia test ETH (never a wallet with real money).",
      `  Fund it at ${FAUCET}, then run: npm run chain:setup`,
    ].join("\n"),
  );
}
const key = normaliseKey(rawKey);
if (!key) fail("CANARY_RELAYER_KEY in .env.local doesn't look like a private key (expected 0x + 64 hex characters). The value is not shown here on purpose.");
const account = privateKeyToAccount(key);
ok(`Wallet ${account.address} (from CANARY_RELAYER_KEY; the key itself is never printed)`);

// ── 2. chain ──
const rpc = envValue("SEPOLIA_RPC_URL") ?? DEFAULT_SEPOLIA_RPC;
let chainId: number;
const probe = createPublicClient({ transport: http(rpc, { timeout: 20_000, retryCount: 2 }) });
try {
  chainId = await probe.getChainId();
} catch (e) {
  fail(`Couldn't reach the Sepolia RPC (${rpc}). Check your internet connection, or set SEPOLIA_RPC_URL in .env.local to another Sepolia endpoint.\n  ${(e as Error).message.split("\n")[0]}`);
}
const isSepolia = chainId === SEPOLIA_CHAIN_ID;
if (!isSepolia && process.env.CANARY_ALLOW_NON_SEPOLIA !== "1") {
  fail(`SEPOLIA_RPC_URL points at chain ${chainId}, not Ethereum Sepolia (${SEPOLIA_CHAIN_ID}).`);
}
const chain = isSepolia ? sepolia : defineChain({ id: chainId, name: `local-${chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const network = isSepolia ? "sepolia" : `local-${chainId}`;
const publicClient = createPublicClient({ chain, transport: http(rpc, { timeout: 30_000, retryCount: 3 }) });
const walletClient = createWalletClient({ account, chain, transport: http(rpc, { timeout: 30_000, retryCount: 3 }) });
ok(`Connected to ${isSepolia ? "Ethereum Sepolia" : `a LOCAL TEST chain (id ${chainId})`} via ${rpc.replace(/(\/\/[^/]+\/).{12,}$/, "$1…")}`);

// ── 3. existing deployment? ──
const existing = readOnchain();
let record: Onchain | null = null;
if (existing && existing.chainId === chainId && existing.registry && !flag("force")) {
  const code = await publicClient.getCode({ address: existing.registry as Address }).catch(() => undefined);
  if (code && code !== "0x") {
    record = existing;
    ok(`CanaryRegistry already deployed at ${existing.registry} (block ${existing.deployBlock}). Not redeploying (pass --force to deploy a new one).`);
  } else {
    info(`data/onchain.json lists ${existing.registry}, but there is no contract code there on this chain. Deploying a new one.`);
  }
}

if (!record) {
  // ── 4. compile ──
  if (!flag("skip-compile")) {
    if (!existsSync(join(P.contracts, "node_modules", "solc"))) run("npm", ["install", "--no-audit", "--no-fund"], P.contracts, "npm install in contracts/");
    run("npm", ["run", "compile"], P.contracts, "Compiling CanaryRegistry");
  }
  if (!existsSync(P.artifact)) fail(`Missing ${P.artifact}. Run "npm run compile" in contracts/.`);
  const artifact = readJson<{ abi: Abi; bytecode: Hex }>(P.artifact);

  // constructor args are matched by type, so the script keeps working if the contract gains features
  const ctor = artifact.abi.find((x) => x.type === "constructor") as { inputs?: { name: string; type: string }[] } | undefined;
  const ctorArgs = (ctor?.inputs ?? []).map((inp) => {
    if (inp.type === "address[]") return [SEPOLIA_MOCK_FORWARDER as Address];
    if (inp.type === "address") return account.address;
    fail(`CanaryRegistry's constructor has an input this script doesn't know how to fill: ${inp.type} ${inp.name}. Update scripts/chain/setup.mts.`);
  });

  // ── 5. balance ──
  const balance = await publicClient.getBalance({ address: account.address });
  const gasPrice: bigint = await publicClient
    .estimateFeesPerGas()
    .then((f) => f.maxFeePerGas)
    .catch(() => publicClient.getGasPrice());
  let deployGas: bigint;
  try {
    deployGas = await publicClient.estimateGas({ account: account.address, data: encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: ctorArgs }) });
  } catch {
    deployGas = 2_500_000n; // estimation fails on an empty wallet on some RPCs; use a safe upper bound
  }
  // estimate at today's gas price x1.3, but never less than 0.003 ETH (Sepolia gas spikes without warning)
  const estimate = ((deployGas + 2n * GAS_PER_REPORT) * gasPrice * 13n) / 10n;
  const needed = estimate > MIN_BALANCE ? estimate : MIN_BALANCE;
  info(`Balance ${formatEther(balance)} ETH; deploy + two reports cost about ${formatEther(estimate)} ETH at today's gas price (asking for at least ${formatEther(needed)}).`);
  if (balance < needed) {
    fail(
      [
        `Not enough Sepolia ETH in ${account.address}.`,
        `  Has ${formatEther(balance)} ETH, needs at least ${formatEther(needed)} ETH.`,
        `  Get free test ETH at ${FAUCET} (paste the address above), wait a minute, then run: npm run chain:setup`,
      ].join("\n"),
    );
  }

  // ── 6. deploy ──
  info(`Deploying CanaryRegistry (forwarder ${SEPOLIA_MOCK_FORWARDER} = CRE simulation MockKeystoneForwarder, relayer ${account.address})…`);
  const hash = await walletClient.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args: ctorArgs });
  info(`tx ${hash}${isSepolia ? `  https://sepolia.etherscan.io/tx/${hash}` : ""}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 300_000 });
  if (receipt.status !== "success" || !receipt.contractAddress) fail(`Deployment transaction ${hash} failed.`);
  const address = getAddress(receipt.contractAddress);
  ok(`Deployed CanaryRegistry at ${address} in block ${receipt.blockNumber}`);

  record = {
    network,
    chainId,
    registry: address,
    deployTx: hash,
    deployBlock: receipt.blockNumber.toString(),
    deployer: account.address,
    forwarders: [SEPOLIA_MOCK_FORWARDER],
    relayer: account.address,
    deployedAt: new Date().toISOString(),
    explorer: explorerFor(chainId),
    simulations: [],
  };
  // keep contracts/out/deployment.sepolia.json in sync with what deploy.mts would have written
  if (isSepolia) {
    writeFileSync(
      join(P.contracts, "out", "deployment.sepolia.json"),
      `${JSON.stringify({ network: "ethereum-testnet-sepolia", chainId, address, txHash: hash, blockNumber: record.deployBlock, deployer: account.address, forwarders: record.forwarders, relayer: account.address, deployedAt: record.deployedAt }, null, 2)}\n`,
    );
  }
}

// ── 7. sync every place that needs the address ──
writeOnchain(record);
ok("data/onchain.json");

const creConfigs: string[] = [];
const onlyWorkflows = opt("workflows")?.split(",").map((x) => x.trim()); // default: every workflow folder in cre/
for (const dir of readdirSync(P.creDir, { withFileTypes: true })) {
  if (!dir.isDirectory() || dir.name.startsWith(".") || dir.name === "node_modules") continue;
  if (onlyWorkflows && !onlyWorkflows.includes(dir.name)) continue;
  for (const f of readdirSync(join(P.creDir, dir.name))) {
    if (!/^config\..+\.json$/.test(f)) continue;
    const path = join(P.creDir, dir.name, f);
    let cfg: { registry?: { address?: unknown } };
    try {
      cfg = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      continue;
    }
    if (!cfg.registry || typeof cfg.registry.address !== "string") continue;
    if (cfg.registry.address !== record.registry) {
      cfg.registry.address = record.registry;
      writeJson(path, cfg);
    }
    creConfigs.push(`cre/${dir.name}/${f}`);
  }
}
ok(`registry.address in ${creConfigs.join(", ") || "(no CRE configs found)"}`);

upsertEnvFile(P.envLocal, { CANARY_REGISTRY_ADDRESS: record.registry, CANARY_REGISTRY_FROM_BLOCK: record.deployBlock }, "# CanaryRegistry (written by npm run chain:setup)");
ok(".env.local: CANARY_REGISTRY_ADDRESS, CANARY_REGISTRY_FROM_BLOCK (other lines untouched)");

if (!gitIgnored(join(ROOT, "cre", ".env"))) fail("cre/.env is NOT git-ignored, so the key won't be written there. Add `.env` to cre/.gitignore and run again.");
if (!existsSync(P.creEnv) && existsSync(P.creEnvExample)) writeFileSync(P.creEnv, readFileSync(P.creEnvExample, "utf8"));
upsertEnvFile(P.creEnv, { CRE_ETH_PRIVATE_KEY: key.slice(2) });
ok("cre/.env: CRE_ETH_PRIVATE_KEY (git-ignored; used by cre workflow simulate --broadcast)");

updateReadme();
ok("README.md On-chain proof section");

console.log(`
Done. CanaryRegistry: ${record.registry}${record.explorer ? `\n  ${record.explorer}/address/${record.registry}` : ""}

Next:
  cre login                                  (once; opens the browser)
  npm run chain:simulate -- --broadcast      (dry run, then real Sepolia writes through the CRE forwarder)
  npm run chain:status                       (what the registry holds for EMAX)
`);
