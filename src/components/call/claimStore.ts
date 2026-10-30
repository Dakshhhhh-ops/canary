// Claim packs live only in this browser (localStorage). Every access is wrapped: private windows,
// blocked storage or a full quota must never break the page.

import type { ClaimPack } from "@/lib/claims/types";
import type { DocKind } from "@/lib/hotline/agent";

export type AnchorState =
  | { status: "not-configured"; caseId: string; evidenceHash: string; missing: string[] }
  | { status: "already-anchored"; anchoredAt: number; registryUrl: string }
  | { status: "submitted" | "anchored"; txHash: string; explorerUrl: string; registryUrl: string }
  | { status: "error"; message: string };

export type StoredClaim = {
  pack: ClaimPack;
  edits: Partial<Record<DocKind, string>>;
  done: Partial<Record<string, boolean>>;
  salt?: string; // for claimantRef; never leaves this browser
  anchor?: AnchorState;
};

const KEY = (id: string) => `canary.claim.${id}`;
const INDEX = "canary.claims";

export function saveClaim(c: StoredClaim): boolean {
  try {
    localStorage.setItem(KEY(c.pack.id), JSON.stringify(c));
    const ids: string[] = JSON.parse(localStorage.getItem(INDEX) ?? "[]");
    if (!ids.includes(c.pack.id)) localStorage.setItem(INDEX, JSON.stringify([c.pack.id, ...ids].slice(0, 20)));
    return true;
  } catch {
    return false;
  }
}

export function loadClaim(id: string): StoredClaim | null {
  try {
    const raw = localStorage.getItem(KEY(id));
    return raw ? (JSON.parse(raw) as StoredClaim) : null;
  } catch {
    return null;
  }
}

export function deleteClaim(id: string) {
  try {
    localStorage.removeItem(KEY(id));
    const ids: string[] = JSON.parse(localStorage.getItem(INDEX) ?? "[]");
    localStorage.setItem(INDEX, JSON.stringify(ids.filter((x) => x !== id)));
  } catch {}
}

/** Keeps the pack for this tab even when localStorage is unavailable. */
const memory = new Map<string, StoredClaim>();
export const rememberInTab = (c: StoredClaim) => memory.set(c.pack.id, c);
export const recallFromTab = (id: string) => memory.get(id) ?? null;

export function download(filename: string, text: string, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
