// POST { caseSlug?, wallet, evidenceHash, claimantRef, walletSalt?, purchaseBlocks? }
//   -> asks the Chainlink CRE workflow canary-claims to confirm the wallet's purchases on Ethereum mainnet and
//      record "claim verified" in CanaryRegistry (see src/lib/claims/verify.ts and cre/README.md).
//   Already verified on-chain  -> { status: "verified", purchases, firstBuyBlock, verifiedAt, ... }
//   Workflow not deployed      -> { status: "not-configured", simulateCommand, payload, ... }
//   Sent to the deployed DON   -> { status: "submitted", requestId, ... }  (poll GET below for the result)
// GET ?caseSlug=emax&evidenceHash=0x… -> { status: "verified", … } or { status: "pending" | "not-configured" }.
// The wallet is a public address; nothing is stored or logged here.
import { NextResponse } from "next/server";
import { createPublicClient, http, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { loadCase } from "@/lib/cases";
import { toHotlineCase } from "@/lib/hotline/caseFacts";
import { findPurchases, type PurchaseReport } from "@/lib/hotline/purchases";
import demoSnapshot from "@/lib/hotline/demoSnapshot.json";
import { clientIp, makeLimiter } from "@/lib/rateLimit";
import { REGISTRY_ABI, registryConfig } from "@/lib/registry";
import {
  caseIdForSlug,
  forwardToWorkflow,
  newWalletSalt,
  simulateCommand,
  triggerMissing,
  validateVerifyRequest,
  workflowInput,
  type VerifyResult,
} from "@/lib/claims/verify";

export const runtime = "nodejs";
export const maxDuration = 60;
const limited = makeLimiter(6);
const HEX32 = /^0x[0-9a-f]{64}$/;

/** What CanaryRegistry already says about this claim; null when no registry is configured or it can't be read. */
async function onChainVerification(caseId: Hex, evidenceHash: Hex): Promise<Extract<VerifyResult, { status: "verified" }> | null> {
  const cfg = registryConfig();
  if (!cfg) return null;
  try {
    const client = createPublicClient({ chain: sepolia, transport: http(cfg.rpc, { timeout: 15_000 }) });
    const v = await client.readContract({ address: cfg.address, abi: REGISTRY_ABI, functionName: "getClaimVerification", args: [caseId, evidenceHash] });
    if (!v.at) return null;
    return {
      status: "verified",
      caseId,
      evidenceHash,
      verifiedAt: Number(v.at),
      purchases: v.purchases,
      firstBuyBlock: Number(v.firstBuyBlock),
      registry: cfg.address,
      registryUrl: `https://sepolia.etherscan.io/address/${cfg.address}`,
      by: "Chainlink CRE workflow canary-claims",
    };
  } catch {
    return null; // e.g. a registry deployed before report kind 3 existed
  }
}

/** The wallet's buys inside the class period, as hints for the workflow (which re-checks each one on-chain). */
async function classPeriodBuyBlocks(caseSlug: string, wallet: string): Promise<number[] | null> {
  const cf = await loadCase(caseSlug);
  if (!cf) return null;
  const k = toHotlineCase(cf);
  let report: PurchaseReport;
  try {
    report = await findPurchases(wallet, k);
  } catch {
    if (!(k.demoWallet && wallet.toLowerCase() === k.demoWallet.address.toLowerCase())) throw new Error("The blockchain node didn't answer. Try again in a minute.");
    report = demoSnapshot as PurchaseReport;
  }
  return report.purchases.filter((p) => p.inClassPeriod).map((p) => p.blockNumber);
}

export async function POST(req: Request) {
  if (limited(clientIp(req))) return NextResponse.json({ status: "error", message: "Too many requests. Please wait a few minutes." }, { status: 429 });
  const parsed = validateVerifyRequest(await req.json().catch(() => null));
  if (!parsed)
    return NextResponse.json(
      { status: "error", message: "Send { wallet, evidenceHash, claimantRef } (0x-prefixed; hashes are 32-byte hex), optionally caseSlug, walletSalt and purchaseBlocks." },
      { status: 400 },
    );
  const caseId = caseIdForSlug(parsed.caseSlug);

  const done = await onChainVerification(caseId, parsed.evidenceHash);
  if (done) return NextResponse.json(done);

  let blocks = parsed.purchaseBlocks;
  if (!blocks) {
    try {
      blocks = (await classPeriodBuyBlocks(parsed.caseSlug, parsed.wallet)) ?? undefined;
    } catch (e) {
      return NextResponse.json({ status: "error", message: e instanceof Error ? e.message : "The purchase lookup failed." } satisfies VerifyResult, { status: 502 });
    }
    if (!blocks) return NextResponse.json({ status: "error", message: "Case file not found." } satisfies VerifyResult, { status: 404 });
  }
  if (blocks.length === 0)
    return NextResponse.json({
      status: "no-purchases",
      caseId,
      evidenceHash: parsed.evidenceHash,
      message: "No buys of the coin from its trading pool were found for this wallet inside the class period, so there is nothing for the Chainlink network to confirm.",
    } satisfies VerifyResult);

  const walletSalt = parsed.walletSalt ?? newWalletSalt();
  const input = workflowInput(parsed, blocks, walletSalt);
  const missing = triggerMissing();
  if (missing.length)
    return NextResponse.json({ status: "not-configured", caseId, evidenceHash: parsed.evidenceHash, missing, simulateCommand: simulateCommand(input), payload: input, walletSalt } satisfies VerifyResult);

  try {
    const { requestId, gateway } = await forwardToWorkflow(input);
    return NextResponse.json({
      status: "submitted",
      caseId,
      evidenceHash: parsed.evidenceHash,
      requestId,
      walletSalt,
      gateway,
      note: "The Chainlink network is checking the purchases now. The result is written to CanaryRegistry on Sepolia; ask again with GET in a minute.",
    } satisfies VerifyResult);
  } catch (e) {
    return NextResponse.json({ status: "error", message: (e instanceof Error ? e.message : "The CRE gateway request failed.").slice(0, 200) } satisfies VerifyResult, { status: 502 });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const caseSlug = url.searchParams.get("caseSlug") ?? "emax";
  const evidenceHash = (url.searchParams.get("evidenceHash") ?? "").toLowerCase();
  if (!/^[a-z0-9-]{1,32}$/.test(caseSlug) || !HEX32.test(evidenceHash)) return NextResponse.json({ status: "error", message: "Pass ?caseSlug=…&evidenceHash=0x…" }, { status: 400 });
  const caseId = caseIdForSlug(caseSlug);
  if (!registryConfig()) return NextResponse.json({ status: "not-configured", caseId, evidenceHash, missing: ["CANARY_REGISTRY_ADDRESS"] });
  const done = await onChainVerification(caseId, evidenceHash as Hex);
  return NextResponse.json(done ?? { status: "pending", caseId, evidenceHash });
}
