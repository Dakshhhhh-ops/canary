import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CaseFile } from "./types";

/** Loads a documented case from data/cases/<slug>.json. Returns null while it hasn't been built yet. */
export async function loadCase(slug: string): Promise<CaseFile | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  try {
    const raw = await readFile(path.join(process.cwd(), "data", "cases", `${slug}.json`), "utf8");
    return JSON.parse(raw) as CaseFile;
  } catch {
    return null;
  }
}

export const CASES = ["emax"] as const;
