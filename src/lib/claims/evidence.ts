// The evidence file: the facts a claim relies on, as canonical JSON, plus its SHA-256 fingerprint.
// Same input -> same bytes -> same fingerprint, so anyone can re-check it (and the blockchain anchor) later.
// Name and email are deliberately left out: the fingerprint may be published on-chain, the person may not.

import { canonical, sha256Hex } from "../canonical";
import { documentedBy } from "../hotline/caseFacts";
import type { PromoterPost } from "../types";
import type { ClaimInput, EvidenceFile } from "./types";

/** Posts the documents cite: those dated in the 3 days before a purchase, plus every post by a promoter the caller named. */
export function postsCited(input: ClaimInput): PromoterPost[] {
  const { kase, facts } = input;
  const ids = new Set<string>();
  for (const p of facts.purchases?.purchases ?? []) for (const b of p.postsBefore) ids.add(b.postId);
  const named = new Set(facts.promoters?.matched ?? []);
  for (const p of kase.posts) if (named.has(p.promoter)) ids.add(p.id);
  return kase.posts.filter((p) => ids.has(p.id)).sort((a, b) => a.postedAt.localeCompare(b.postedAt) || a.id.localeCompare(b.id));
}

export function evidenceObject(input: ClaimInput) {
  const { kase, facts } = input;
  const isCase = Boolean(facts.coin?.isCase);
  const r = facts.purchases;
  return {
    schema: "canary.evidence/1",
    claimId: input.id,
    generatedAt: input.generatedAt,
    case: isCase
      ? {
          slug: kase.slug,
          token: { name: kase.token.name, symbol: kase.token.symbol, chain: kase.token.chain, address: kase.token.address, pair: kase.token.pair ?? null, pairDex: kase.token.pairDex ?? null },
          legal: kase.legal.map((l) => ({ id: l.id, kind: l.kind, title: l.title, date: l.date, statute: l.statute ?? null, outcome: l.outcome ?? null, sources: l.sources })),
          classAction: kase.classAction
            ? {
                name: kase.classAction.name,
                formerName: kase.classAction.formerName,
                court: kase.classAction.court,
                docket: kase.classAction.docket,
                classPeriod: kase.classAction.classPeriod,
                certifiedStates: kase.classAction.certifiedStates,
                status: kase.classAction.status,
                statusDate: kase.classAction.statusDate,
                sources: kase.classAction.sources,
              }
            : null,
        }
      : null,
    statement: {
      coin: facts.coin?.text ?? null,
      promotersNamed: facts.promoters?.matched ?? [],
      whatMadeMeBuyInMyWords: facts.promoters?.text ?? null,
      whenInMyWords: facts.when?.text ?? null,
      whenApprox: facts.when?.date ?? facts.when?.month ?? null,
      amountLostInMyWords: facts.amount?.text ?? null,
      amountLost: facts.amount?.value != null ? { value: facts.amount.value, currency: facts.amount.currency ?? null } : null,
      country: facts.place?.countryName ?? null,
      usState: facts.place?.state ?? null,
      wallet: facts.wallet?.address ?? null,
      exchange: facts.wallet?.exchange ?? null,
      contactedByRecoveryScammer: Boolean(facts.recoveryScam),
    },
    purchases: r
      ? {
          address: r.address,
          addressUrl: r.addressUrl,
          checkedAt: r.checkedAt,
          source: r.source,
          method: r.method,
          notes: r.notes,
          purchases: r.purchases,
          sales: r.sales,
          totals: r.totals,
          truncated: r.truncated,
        }
      : null,
    postsCited: isCase
      ? postsCited(input).map((p) => ({
          id: p.id,
          promoter: p.promoter,
          handle: p.handle ?? null,
          platform: p.platform,
          postedAt: p.postedAt,
          datePrecision: p.datePrecision,
          text: p.text ?? null,
          disclosedPayment: p.disclosedPayment,
          paid: p.paid ?? null,
          documentedBy: documentedBy(p),
          sources: p.sources,
        }))
      : [],
    trailHead: input.trailHead ?? null,
    privacy: "Name and email are not in this file. They appear only in the documents kept in the person's own browser.",
  };
}

/**
 * The downloadable file: { kind, version, evidence, sha256 }, where sha256 = SHA-256 of canonical(evidence)
 * (src/lib/canonical.ts). /verify recomputes it the same way.
 */
export async function buildEvidence(input: ClaimInput): Promise<EvidenceFile> {
  const evidence = evidenceObject(input);
  const sha256 = await sha256Hex(canonical(evidence));
  const json = JSON.stringify({ kind: "canary.evidence", version: 1, evidence, sha256 }, null, 2) + "\n";
  return { json, sha256, filename: `canary-evidence-${input.id}.json` };
}

/** Re-check a downloaded evidence file: returns the recomputed fingerprint and whether it matches the one inside. */
export async function checkEvidenceFile(text: string): Promise<{ ok: boolean; recomputed: string; stated: string | null }> {
  const env = JSON.parse(text) as { kind?: string; version?: number; evidence?: unknown; sha256?: string };
  const recomputed = await sha256Hex(canonical(env.evidence ?? null));
  return { ok: env.kind === "canary.evidence" && recomputed === env.sha256, recomputed, stated: env.sha256 ?? null };
}
