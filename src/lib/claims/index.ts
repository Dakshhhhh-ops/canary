// Claim pack: evidence file first (its fingerprint is quoted by every document), then the documents.
// Pure and browser-safe, so the pack can be built on the caller's own device.

import { complaintsFor } from "../hotline/agent";
import type { Place } from "../hotline/parse";
import { formatAmount } from "../hotline/parse";
import { buildDocuments } from "./documents";
import { buildEvidence } from "./evidence";
import { EU_NCA, JURISDICTION_LABEL, LAW, jurisdictionOf } from "./law";
import type { ClaimInput, ClaimPack } from "./types";

export * from "./types";
export { buildEvidence, checkEvidenceFile, evidenceObject, postsCited } from "./evidence";
export { buildDocuments, classAssessment } from "./documents";
export { allowedFacts, extractFacts, factGuard } from "./guard";
export { EU_CHOICES, EU_NCA, JURISDICTION_LABEL, LAW, euAuthority, jurisdictionOf, law, placeFor, type Jurisdiction, type LawRef } from "./law";
export { buildClaimPdf, pdfSha256 } from "./pdf";

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
    jurisdiction: jurisdictionLabel(f.place),
    docs,
    evidence,
  };
}

export function jurisdictionLabel(place?: Place | null): string | null {
  const j = jurisdictionOf(place);
  if (!j || !place) return null;
  return j === "EU" && place.euState ? `${JURISDICTION_LABEL.EU} (${place.countryName})` : JURISDICTION_LABEL[j];
}

/** A short random id for the claim (also the localStorage key). */
export function newClaimId(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(36).padStart(2, "0")).join("").slice(0, 12);
}

/** The allowed-fact inputs for a claim: everything the documents were built from, including the sourced law table. */
export const guardInputs = (input: ClaimInput, fingerprint: string) => [input.kase, input.facts, input.consents, input.generatedAt, input.id, fingerprint, input.origin ?? "", LAW, EU_NCA];

/**
 * The same claim for a different place (picked in the claim pack). Documents the caller already agreed to stay in
 * if they still apply; the new place's own documents are added, because choosing the place is asking for them.
 */
export function withPlace(input: ClaimInput, place: Place | undefined): ClaimInput {
  const facts = { ...input.facts, place, placeHeard: undefined };
  const declined = [...new Set([...(input.declined ?? []), ...complaintsFor(input.facts).filter((d) => !input.consents.includes(d))])];
  const consents = complaintsFor(facts).filter((d) => !declined.includes(d));
  return { ...input, facts, consents, declined };
}
