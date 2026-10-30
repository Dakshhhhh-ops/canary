// Claim pack: evidence file first (its fingerprint is quoted by every document), then the documents.
// Pure and browser-safe, so the pack can be built on the caller's own device.

import { formatAmount } from "../hotline/parse";
import { buildDocuments } from "./documents";
import { buildEvidence } from "./evidence";
import type { ClaimInput, ClaimPack } from "./types";

export * from "./types";
export { buildEvidence, checkEvidenceFile, evidenceObject, postsCited } from "./evidence";
export { buildDocuments, classAssessment } from "./documents";
export { allowedFacts, extractFacts, factGuard } from "./guard";

export async function buildClaimPack(input: ClaimInput): Promise<ClaimPack> {
  const evidence = await buildEvidence(input);
  const docs = buildDocuments(input, evidence.sha256);
  const f = input.facts;
  return {
    v: 1,
    id: input.id,
    createdAt: input.generatedAt,
    caseSlug: input.kase.slug,
    isCase: Boolean(f.coin?.isCase),
    headline: {
      coin: f.coin?.isCase ? `${input.kase.token.name} (${input.kase.token.symbol})` : (f.coin?.text ?? "Unknown coin"),
      amount: f.amount ? formatAmount(f.amount) : f.purchases?.totals.boughtUsd != null ? `≈ $${Math.round(f.purchases.totals.boughtUsd).toLocaleString("en-US")} bought (blockchain estimate)` : null,
      where: f.place ? (f.place.stateName ?? f.place.ukNation ?? f.place.countryName) : null,
      purchases: f.purchases?.purchases.length ?? 0,
    },
    docs,
    evidence,
  };
}

/** A short random id for the claim (also the localStorage key). */
export function newClaimId(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(36).padStart(2, "0")).join("").slice(0, 12);
}

/** The allowed-fact inputs for a claim: everything the documents were built from. */
export const guardInputs = (input: ClaimInput, fingerprint: string) => [input.kase, input.facts, input.consents, input.generatedAt, input.id, fingerprint, input.origin ?? ""];
