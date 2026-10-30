import "server-only";
// Writes a claim's evidence fingerprint to the CanaryRegistry contract on Sepolia: anchorClaim(caseId, evidenceHash, claimantRef).
// Needs CANARY_REGISTRY_ADDRESS, SEPOLIA_RPC_URL and CANARY_RELAYER_KEY (a key the registry owner allowed with setRelayer).
// Without all three it says so plainly and writes nothing. It never receives or logs personal data:
// only two hashes arrive here, and claimantRef is already salted in the person's browser.

import { createPublicClient, createWalletClient, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { registryConfig } from "../registry";
import { caseIdOf } from "../snapshot";

const ABI = parseAbi([
  "function anchorClaim(bytes32 caseId, bytes32 evidenceHash, bytes32 claimantRef)",
  "function claimAnchoredAt(bytes32 caseId, bytes32 evidenceHash) view returns (uint64)",
]);

export const SEPOLIA_TX = (h: string) => `https://sepolia.etherscan.io/tx/${h}`;
export const SEPOLIA_ADDRESS = (a: string) => `https://sepolia.etherscan.io/address/${a}`;
const HEX32 = /^0x[0-9a-f]{64}$/;

export type AnchorRequest = { caseSlug: string; evidenceHash: string; claimantRef: string };

export type AnchorResult =
  | { status: "not-configured"; caseId: Hex; evidenceHash: Hex; missing: string[] }
  | { status: "already-anchored"; caseId: Hex; evidenceHash: Hex; anchoredAt: number; registry: string; registryUrl: string }
  | { status: "submitted" | "anchored"; caseId: Hex; evidenceHash: Hex; txHash: Hex; explorerUrl: string; registry: string; registryUrl: string }
  | { status: "error"; message: string };

export function anchorMissing(): string[] {
  const missing: string[] = [];
  if (!registryConfig()) missing.push("CANARY_REGISTRY_ADDRESS");
  if (!process.env.SEPOLIA_RPC_URL) missing.push("SEPOLIA_RPC_URL");
  if (!/^0x[0-9a-fA-F]{64}$/.test(process.env.CANARY_RELAYER_KEY ?? "")) missing.push("CANARY_RELAYER_KEY");
  return missing;
}

export function validateAnchorRequest(body: unknown): AnchorRequest | null {
  const b = body as Partial<AnchorRequest> | null;
  if (!b || typeof b !== "object") return null;
  const caseSlug = String(b.caseSlug ?? "");
  const evidenceHash = String(b.evidenceHash ?? "").toLowerCase();
  const claimantRef = String(b.claimantRef ?? "").toLowerCase();
  if (!/^[a-z0-9-]{1,32}$/.test(caseSlug) || !HEX32.test(evidenceHash) || !HEX32.test(claimantRef)) return null;
  if (/^0x0+$/.test(evidenceHash)) return null;
  return { caseSlug, evidenceHash, claimantRef };
}

export async function anchorClaim(req: AnchorRequest): Promise<AnchorResult> {
  const caseId = caseIdOf(req.caseSlug);
  const evidenceHash = req.evidenceHash as Hex;
  const missing = anchorMissing();
  if (missing.length) return { status: "not-configured", caseId, evidenceHash, missing };
  const cfg = registryConfig()!;
  const transport = http(process.env.SEPOLIA_RPC_URL, { timeout: 20_000 });
  const pub = createPublicClient({ chain: sepolia, transport });
  const registry = cfg.address;
  const registryUrl = SEPOLIA_ADDRESS(registry);
  try {
    const at = await pub.readContract({ address: registry, abi: ABI, functionName: "claimAnchoredAt", args: [caseId, evidenceHash] });
    if (at > 0n) return { status: "already-anchored", caseId, evidenceHash, anchoredAt: Number(at), registry, registryUrl };
    const account = privateKeyToAccount(process.env.CANARY_RELAYER_KEY as Hex);
    const wallet = createWalletClient({ chain: sepolia, transport, account });
    const { request } = await pub.simulateContract({ address: registry, abi: ABI, functionName: "anchorClaim", args: [caseId, evidenceHash, req.claimantRef as Hex], account });
    const txHash = await wallet.writeContract(request);
    try {
      const rcpt = await pub.waitForTransactionReceipt({ hash: txHash, timeout: 25_000 });
      if (rcpt.status !== "success") return { status: "error", message: "The transaction was sent but reverted." };
      return { status: "anchored", caseId, evidenceHash, txHash, explorerUrl: SEPOLIA_TX(txHash), registry, registryUrl };
    } catch {
      return { status: "submitted", caseId, evidenceHash, txHash, explorerUrl: SEPOLIA_TX(txHash), registry, registryUrl };
    }
  } catch (e) {
    const msg = e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : "unknown error";
    return { status: "error", message: msg.slice(0, 200) };
  }
}
