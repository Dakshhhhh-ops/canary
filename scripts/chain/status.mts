// npm run chain:status [-- --case emax]
// What CanaryRegistry on Sepolia holds for a case: statusOf(caseId) plus every event for it, with links.
// Reads the address from .env.local (CANARY_REGISTRY_ADDRESS) or data/onchain.json. Read-only, no key needed.
import { existsSync } from "node:fs";
import { createPublicClient, decodeEventLog, http, keccak256, parseAbi, toBytes, type Abi, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { DEFAULT_SEPOLIA_RPC, P, envValue, fail, opt, readJson, readOnchain } from "./lib.mts";

const slug = opt("case") ?? "emax";
const caseId = keccak256(toBytes(`canary:${slug}`));
const onchain = readOnchain();
const address = (envValue("CANARY_REGISTRY_ADDRESS") ?? (onchain?.network === "sepolia" ? onchain.registry : undefined)) as Address | undefined;
if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) fail("No registry yet: CANARY_REGISTRY_ADDRESS isn't set and data/onchain.json is missing. Run npm run chain:setup.");

// the compiled ABI knows every event the contract can emit (it may have gained some); fall back to the core ones
const FALLBACK = parseAbi([
  "function statusOf(bytes32 caseId) view returns (uint8 level, bytes32 trailHash, bool collapsed)",
  "event AlertRecorded(bytes32 indexed caseId, string symbol, address indexed token, uint8 level, uint32 promoters, bytes32 trailHash, uint64 at)",
  "event CollapseRecorded(bytes32 indexed caseId, address indexed token, uint256 liquidityBefore, uint256 liquidityNow, uint16 dropBps, uint64 at)",
  "event ClaimAnchored(bytes32 indexed caseId, bytes32 indexed evidenceHash, bytes32 claimantRef, uint64 at)",
]);
const abi: Abi = existsSync(P.artifact) ? readJson<{ abi: Abi }>(P.artifact).abi : FALLBACK;

const rpc = envValue("SEPOLIA_RPC_URL") ?? DEFAULT_SEPOLIA_RPC;
const client = createPublicClient({ chain: sepolia, transport: http(rpc, { timeout: 20_000, retryCount: 3 }) });
const code = await client.getCode({ address }).catch(() => undefined);
if (!code || code === "0x") fail(`No contract at ${address} on Sepolia.`);

console.log(`\nCanaryRegistry ${address}  https://sepolia.etherscan.io/address/${address}`);
console.log(`Case "${slug}"  caseId ${caseId}\n`);

const [level, trailHash, collapsed] = (await client.readContract({ address, abi: FALLBACK, functionName: "statusOf", args: [caseId] })) as readonly [number, Hex, boolean];
const LEVEL = ["none", "suspicious", "pump-and-dump", "collapsed"];
console.log(`statusOf: level ${level} (${LEVEL[level] ?? "?"}), collapsed ${collapsed}, trail ${trailHash}`);

const fromBlock = BigInt(envValue("CANARY_REGISTRY_FROM_BLOCK") ?? onchain?.deployBlock ?? "0");
const latest = await client.getBlockNumber();
const STEP = 40_000n; // public RPCs cap eth_getLogs ranges
const logs = [];
for (let b = fromBlock; b <= latest; b += STEP) {
  const to = b + STEP - 1n > latest ? latest : b + STEP - 1n;
  logs.push(...(await client.getLogs({ address, fromBlock: b, toBlock: to })));
}
let n = 0;
for (const l of logs) {
  try {
    const ev = decodeEventLog({ abi, data: l.data, topics: l.topics }) as unknown as { eventName: string; args: Record<string, unknown> };
    if (String(ev.args?.caseId ?? "").toLowerCase() !== caseId) continue;
    n++;
    const detail = Object.entries(ev.args)
      .filter(([k]) => k !== "caseId")
      .map(([k, v]) => `${k}=${typeof v === "bigint" ? v.toString() : String(v)}`)
      .join(" ");
    console.log(`\n• ${ev.eventName}  block ${l.blockNumber}\n  ${detail}\n  https://sepolia.etherscan.io/tx/${l.transactionHash}`);
  } catch {
    // not an event of this ABI
  }
}
if (!n) console.log("\nNo events for this case yet. Run: npm run chain:simulate -- --broadcast");

if (onchain?.simulations?.length) {
  console.log(`\nSimulation runs recorded in data/onchain.json: ${onchain.simulations.length}`);
  for (const s of onchain.simulations.slice(-6)) console.log(`  ${s.at.slice(0, 19)}Z  ${s.workflow} ${s.target}${s.broadcast ? " --broadcast" : ""}  ${s.txs.map((t) => `${t.kind}:${t.hash.slice(0, 12)}…`).join(" ") || "(no tx)"}`);
}
console.log();
