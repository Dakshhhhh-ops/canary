import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TrailEntry } from "./types";

/** The frozen notebook a case's on-chain record points to (data/notebooks/<slug>.json), or null. */
export type FrozenNotebook = { format: "canary.notebook/1"; slug: string; headHash: string; verdict: string; collapsed: boolean; promoters: number; frozenAt: string; engineCommit: string | null; trail: TrailEntry[] };

export async function loadNotebook(slug: string): Promise<FrozenNotebook | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  try {
    const nb = JSON.parse(await readFile(path.join(process.cwd(), "data", "notebooks", `${slug}.json`), "utf8")) as FrozenNotebook;
    return nb.format === "canary.notebook/1" && /^[0-9a-f]{64}$/.test(nb.headHash) ? nb : null;
  } catch {
    return null;
  }
}
