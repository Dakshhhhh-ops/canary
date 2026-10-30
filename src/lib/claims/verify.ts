// "The Chainlink network confirms the victim's evidence": sends a claim to the canary-claims CRE workflow
// (cre/canary-claims), which checks the wallet's purchases on Ethereum mainnet and records a ClaimVerified report
// in CanaryRegistry on Sepolia.
//
// Deployed workflow: requests go to the CRE gateway as JSON-RPC `workflows.execute`, signed with a JWT by a key
// listed in the workflow's `authorizedEvmAddresses` (docs: cre/guides/workflow/using-triggers/http-trigger/
// triggering-deployed-workflows). Needs three env vars:
//   CRE_CLAIMS_TRIGGER_URL   the gateway, e.g. https://01.gateway.zone-a.cre.chain.link
//   CRE_CLAIMS_WORKFLOW_ID   64 hex chars, from `cre workflow deploy` (no 0x)
//   CRE_CLAIMS_TRIGGER_KEY   0x + 64 hex: the private key of the authorized address (server only, never logged)
// Without them it returns "not-configured" plus the exact `cre workflow simulate` command for the same claim.
//
// Privacy: the wallet address goes to the Chainlink nodes (they must read its purchases) but never on-chain;
// the report carries walletRef = keccak256(walletSalt ‖ wallet). Use the same browser-held salt as claimantRef.

import { createHash, randomUUID } from "node:crypto";
import { getAddress, isAddress, keccak256, parseSignature, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const HEX32 = /^0x[0-9a-f]{64}$/;
/** The env vars this module reads (a plain record, so tests can pass their own). */
export type TriggerEnv = Record<string, string | undefined>;
const MAX_BLOCKS = 200;

export type VerifyRequest = {
  caseSlug: string;
  wallet: `0x${string}`; // checksummed
  evidenceHash: Hex;
  claimantRef: Hex;
  walletSalt?: Hex;
  purchaseBlocks?: number[]; // mainnet blocks of the wallet's buys (from the purchase report); looked up if absent
};

/** The JSON body the canary-claims HTTP trigger takes (cre/canary-claims/workflow.ts claimSchema). */
export type ClaimsWorkflowInput = {
  caseId: Hex;
  wallet: string;
  evidenceHash: Hex;
  claimantRef: Hex;
  walletSalt: Hex;
  purchaseBlocks: number[];
};

export type VerifyResult =
  | {
      status: "verified";
      caseId: Hex;
      evidenceHash: Hex;
      verifiedAt: number;
      purchases: number;
      firstBuyBlock: number;
      registry: string;
      registryUrl: string;
      by: "Chainlink CRE workflow canary-claims";
    }
  | { status: "not-configured"; caseId: Hex; evidenceHash: Hex; missing: string[]; simulateCommand: string; payload: ClaimsWorkflowInput; walletSalt: Hex }
  | { status: "submitted"; caseId: Hex; evidenceHash: Hex; requestId: string; walletSalt: Hex; gateway: unknown; note: string }
  | { status: "no-purchases"; caseId: Hex; evidenceHash: Hex; message: string }
  | { status: "error"; message: string };

/** Same derivation as src/lib/snapshot.ts caseIdOf (that module is server-only). */
export const caseIdForSlug = (slug: string): Hex => keccak256(toBytes(`canary:${slug}`));

export function validateVerifyRequest(body: unknown): VerifyRequest | null {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return null;
  const caseSlug = String(b.caseSlug ?? "emax");
  const wallet = String(b.wallet ?? "").trim();
  const evidenceHash = String(b.evidenceHash ?? "").toLowerCase();
  const claimantRef = String(b.claimantRef ?? "").toLowerCase();
  if (!/^[a-z0-9-]{1,32}$/.test(caseSlug) || !HEX32.test(evidenceHash) || !HEX32.test(claimantRef)) return null;
  if (/^0x0+$/.test(evidenceHash) || !isAddress(wallet, { strict: false })) return null;
  const out: VerifyRequest = { caseSlug, wallet: getAddress(wallet), evidenceHash: evidenceHash as Hex, claimantRef: claimantRef as Hex };
  if (b.walletSalt !== undefined) {
    const s = String(b.walletSalt).toLowerCase();
    if (!HEX32.test(s)) return null;
    out.walletSalt = s as Hex;
  }
  if (b.purchaseBlocks !== undefined) {
    if (!Array.isArray(b.purchaseBlocks) || b.purchaseBlocks.length > MAX_BLOCKS) return null;
    if (!b.purchaseBlocks.every((n) => Number.isSafeInteger(n) && (n as number) >= 0)) return null;
    out.purchaseBlocks = b.purchaseBlocks as number[];
  }
  return out;
}

export function newWalletSalt(): Hex {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return `0x${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export function workflowInput(req: VerifyRequest, purchaseBlocks: number[], walletSalt: Hex): ClaimsWorkflowInput {
  return {
    caseId: caseIdForSlug(req.caseSlug),
    wallet: req.wallet.toLowerCase(),
    evidenceHash: req.evidenceHash,
    claimantRef: req.claimantRef,
    walletSalt,
    purchaseBlocks: [...new Set(purchaseBlocks)].sort((a, b) => a - b),
  };
}

/** The local equivalent: run the workflow in the CRE simulator with this exact claim (from the cre/ folder). */
export function simulateCommand(input: ClaimsWorkflowInput): string {
  return `cre workflow simulate ./canary-claims -T staging-settings --non-interactive --trigger-index 0 --http-payload '${JSON.stringify(input)}'`;
}

export function triggerMissing(env: TriggerEnv = process.env): string[] {
  const missing: string[] = [];
  if (!/^https:\/\/\S+$/.test(env.CRE_CLAIMS_TRIGGER_URL ?? "")) missing.push("CRE_CLAIMS_TRIGGER_URL");
  if (!/^[0-9a-fA-F]{64}$/.test(env.CRE_CLAIMS_WORKFLOW_ID ?? "")) missing.push("CRE_CLAIMS_WORKFLOW_ID");
  if (!/^0x[0-9a-fA-F]{64}$/.test(env.CRE_CLAIMS_TRIGGER_KEY ?? "")) missing.push("CRE_CLAIMS_TRIGGER_KEY");
  return missing;
}

/** JSON with keys sorted at every level: the gateway hashes the request body in this form. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The gateway's JWT (alg "ETH"): digest = sha256 of the sorted request, signed as an Ethereum personal message. */
export async function createTriggerJwt(request: unknown, privateKey: Hex, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const account = privateKeyToAccount(privateKey);
  const header = { alg: "ETH", typ: "JWT" };
  const payload = {
    digest: `0x${createHash("sha256").update(stableStringify(request)).digest("hex")}`,
    iss: account.address,
    iat: now,
    exp: now + 300,
    jti: randomUUID(),
  };
  const message = `${b64url(Buffer.from(JSON.stringify(header)))}.${b64url(Buffer.from(JSON.stringify(payload)))}`;
  const { r, s, v, yParity } = parseSignature(await account.signMessage({ message }));
  const recovery = v !== undefined ? Number(v >= 27n ? v - 27n : v) : Number(yParity);
  const sig = Buffer.concat([Buffer.from(r.slice(2).padStart(64, "0"), "hex"), Buffer.from(s.slice(2).padStart(64, "0"), "hex"), Buffer.from([recovery])]);
  return `${message}.${b64url(sig)}`;
}

/** Fires the deployed workflow's HTTP trigger. The run is asynchronous: the result shows up in CanaryRegistry. */
export async function forwardToWorkflow(input: ClaimsWorkflowInput, opts: { env?: TriggerEnv; fetchImpl?: typeof fetch } = {}) {
  const env = opts.env ?? process.env;
  const requestId = randomUUID();
  const request = {
    jsonrpc: "2.0",
    id: requestId,
    method: "workflows.execute",
    params: { input, workflow: { workflowID: String(env.CRE_CLAIMS_WORKFLOW_ID).toLowerCase() } },
  };
  const jwt = await createTriggerJwt(request, env.CRE_CLAIMS_TRIGGER_KEY as Hex);
  const res = await (opts.fetchImpl ?? fetch)(String(env.CRE_CLAIMS_TRIGGER_URL), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
    body: stableStringify(request),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let body: unknown = text.slice(0, 2000);
  try {
    body = JSON.parse(text);
  } catch {}
  if (!res.ok) throw new Error(`CRE gateway answered HTTP ${res.status}`);
  const err = (body as { error?: { message?: string } } | null)?.error;
  if (err) throw new Error(`CRE gateway: ${String(err.message ?? "error").slice(0, 200)}`);
  return { requestId, gateway: (body as { result?: unknown } | null)?.result ?? body };
}
