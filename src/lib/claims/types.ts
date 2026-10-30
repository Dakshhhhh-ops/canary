import type { DocKind, Facts } from "../hotline/agent";
import type { HotlineCase } from "../hotline/caseFacts";

export type ClaimInput = {
  id: string;
  kase: HotlineCase;
  facts: Facts;
  /** complaints the caller said yes to */
  consents: DocKind[];
  generatedAt: string; // ISO
  /** head hash of the hotline's own hash-chained trail, if one was kept */
  trailHead?: string | null;
  /** site origin for the /verify link, e.g. https://canary.example (optional) */
  origin?: string;
};

export type ClaimDoc = {
  kind: DocKind;
  title: string;
  /** one line for the checklist */
  short: string;
  destination: { label: string; url: string } | null;
  body: string;
  filename: string;
};

export type EvidenceFile = {
  json: string; // the file: { kind: "canary.evidence", version: 1, evidence, sha256 }, pretty-printed
  sha256: string; // hex SHA-256 of canonical(evidence), no 0x
  filename: string;
};

export type ClaimPack = {
  v: 1;
  id: string;
  createdAt: string;
  caseSlug: string;
  isCase: boolean;
  headline: { coin: string; amount: string | null; where: string | null; purchases: number };
  docs: ClaimDoc[];
  evidence: EvidenceFile;
};
