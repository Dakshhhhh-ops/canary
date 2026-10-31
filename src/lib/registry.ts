import "server-only";
import { createPublicClient, http, parseAbi, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";

// Read side of CanaryRegistry on Sepolia (written by the Chainlink CRE workflow and the hotline relayer).
export const REGISTRY_ABI = parseAbi([
  "function statusOf(bytes32 caseId) view returns (uint8 level, bytes32 trailHash, bool collapsed)",
  "function claimAnchoredAt(bytes32 caseId, bytes32 evidenceHash) view returns (uint64)",
  "event AlertRecorded(bytes32 indexed caseId, string symbol, address indexed token, uint8 level, uint32 promoters, bytes32 trailHash, uint64 at)",
  "event CollapseRecorded(bytes32 indexed caseId, address indexed token, uint256 liquidityBefore, uint256 liquidityNow, uint16 dropBps, uint64 at)",
  "event ClaimAnchored(bytes32 indexed caseId, bytes32 indexed evidenceHash, bytes32 claimantRef, uint64 at)",
  // Written by the canary-claims CRE workflow (report kind 3) once the Chainlink network confirmed the purchase.
  "event ClaimVerified(bytes32 indexed caseId, bytes32 indexed evidenceHash, bytes32 claimantRef, uint32 purchases, uint64 firstBuyBlock, uint64 at)",
  "function claimVerifiedAt(bytes32 caseId, bytes32 evidenceHash) view returns (uint64)",
  "function getClaimVerification(bytes32 caseId, bytes32 evidenceHash) view returns ((bytes32 claimantRef, bytes32 walletRef, uint32 purchases, uint64 firstBuyBlock, uint64 at))",
  // Written by the canary-anchor CRE workflow (EVM log trigger on ClaimAnchored, report kind 4): the claim's chain of custody.
  // A registry deployed before kind 4 simply has no such events.
  "event ClaimCustodyRecorded(bytes32 indexed caseId, bytes32 indexed evidenceHash, bytes32 anchorTx, bytes32 trailHash, uint8 level, uint256 poolLiquidityCents, uint64 mainnetBlock, uint64 at)",
]);

export function registryConfig() {
  const address = process.env.CANARY_REGISTRY_ADDRESS as Address | undefined;
  const rpc = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
  const fromBlock = BigInt(process.env.CANARY_REGISTRY_FROM_BLOCK || "0");
  return address && /^0x[0-9a-fA-F]{40}$/.test(address) ? { address, rpc, fromBlock } : null;
}

export type RegistryStatus =
  | { configured: false }
  | {
      configured: true;
      address: Address;
      explorer: string;
      level: number;
      trailHash: Hex;
      collapsed: boolean;
      events: { name: string; txHash: Hex; block: string; at: number | null; detail: Record<string, string> }[];
      error?: string;
    };

export async function registryStatus(caseId: Hex): Promise<RegistryStatus> {
  const cfg = registryConfig();
  if (!cfg) return { configured: false };
  const client = createPublicClient({ chain: sepolia, transport: http(cfg.rpc, { timeout: 15_000 }) });
  const explorer = `https://sepolia.etherscan.io/address/${cfg.address}`;
  try {
    const [level, trailHash, collapsed] = await client.readContract({ address: cfg.address, abi: REGISTRY_ABI, functionName: "statusOf", args: [caseId] });
    const evs = REGISTRY_ABI.filter((x) => x.type === "event");
    const logs = (
      await Promise.all(evs.map((event) => client.getLogs({ address: cfg.address, event, args: { caseId }, fromBlock: cfg.fromBlock, toBlock: "latest" }).catch(() => [])))
    )
      .flat()
      .sort((a, b) => Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n)));
    const events = logs.map((l) => {
      const args = (l as unknown as { args: Record<string, unknown> }).args ?? {};
      const detail: Record<string, string> = {};
      for (const [k, v] of Object.entries(args)) if (k !== "caseId") detail[k] = typeof v === "bigint" ? v.toString() : String(v);
      return { name: (l as unknown as { eventName: string }).eventName, txHash: l.transactionHash as Hex, block: String(l.blockNumber), at: args.at ? Number(args.at) : null, detail };
    });
    return { configured: true, address: cfg.address, explorer, level: Number(level), trailHash, collapsed, events };
  } catch (e) {
    return { configured: true, address: cfg.address, explorer, level: 0, trailHash: `0x${"0".repeat(64)}`, collapsed: false, events: [], error: e instanceof Error ? e.message.slice(0, 200) : "read failed" };
  }
}

/** When (unix seconds) an evidence fingerprint was anchored for a case, 0 if never; null when no registry is configured. */
export async function claimAnchoredAt(caseId: Hex, evidenceHash: Hex): Promise<number | null> {
  const cfg = registryConfig();
  if (!cfg) return null;
  const client = createPublicClient({ chain: sepolia, transport: http(cfg.rpc, { timeout: 15_000 }) });
  const at = await client.readContract({ address: cfg.address, abi: REGISTRY_ABI, functionName: "claimAnchoredAt", args: [caseId, evidenceHash] });
  return Number(at);
}
