// Browser side of anchoring. The claimant reference is keccak256(salt ‖ evidenceHash): the salt is random and
// stays in this browser only, so the on-chain record can't be linked to a person unless they reveal the salt.

import { concat, keccak256, type Hex } from "viem";

export function newSalt(): Hex {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return `0x${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/** evidenceSha is the plain hex SHA-256 of the evidence file (no 0x). */
export const evidenceHashHex = (evidenceSha: string): Hex => `0x${evidenceSha.toLowerCase().replace(/^0x/, "")}`;

export function claimantRef(salt: Hex, evidenceSha: string): Hex {
  return keccak256(concat([salt, evidenceHashHex(evidenceSha)]));
}
