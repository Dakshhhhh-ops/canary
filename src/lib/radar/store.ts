// Saved radar runs and the paper ledger on disk (data/radar/). Node only: used by the API route,
// the /radar page (server side) and scripts/radar/run.mts. No "server-only" import, so the script can use it.
//
// Nothing is written that looks like a key. The key only ever travels in an Authorization header, so
// it should never appear in a reply or a trail; if anything key-shaped turns up anyway, saving is
// refused outright rather than redacted (redacting would break the hashes that make the run verifiable).
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { emptyLedger, lossOnDay, replayLedger, updateLedger, type LedgerFile } from "../engine/ledger";
import type { LiveRun } from "../engine/pipeline";
import type { RyoRawCall } from "../engine/ryo";
import { RUN_FORMAT, summarise, type SavedRun, type SavedRunSummary } from "./saved";

export const radarDir = () => process.env.RADAR_DATA_DIR || path.join(process.cwd(), "data", "radar");
const runsDir = (dir: string) => path.join(dir, "runs");
const ledgerPath = (dir: string) => path.join(dir, "ledger.json");

/** <ISO time with : as ->-<SYMBOLS>.json, e.g. 2026-10-30T04-00-12Z-BTC-ETH-PEPE.json */
export const RUN_FILE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-[A-Z0-9][A-Z0-9-]{0,80}(-\d+)?\.json$/;

export function runFileName(run: Pick<LiveRun, "startedAt" | "symbols">): string {
  const t = new Date(run.startedAt).toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
  const syms = run.symbols.map((s) => s.replace(/[^A-Z0-9]/gi, "").toUpperCase()).filter(Boolean).join("-").slice(0, 60).replace(/-+$/, "");
  return `${t}-${syms || "NONE"}.json`;
}

// ---------- secrets ----------

const SECRET_PATTERNS: [string, RegExp][] = [
  ["a RYO key", /ryo_mcp_[A-Za-z0-9_-]{6,}/],
  ["an OpenRouter key", /sk-or-[A-Za-z0-9_-]{10,}/],
  ["an API key", /\bsk-[A-Za-z0-9_-]{20,}/],
  ["a bearer token", /Bearer\s+[A-Za-z0-9._~+/-]{12,}/i],
];

/** Names of the secret kinds found in a text (never the values). */
export function findSecrets(text: string, env: Record<string, string | undefined> = process.env): string[] {
  const hits = SECRET_PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name);
  for (const k of ["RYO_MCP_KEY", "OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "INTERNAL_TOKEN"]) {
    const v = env[k];
    if (v && v.length >= 8 && text.includes(v)) hits.push(`the value of ${k}`);
  }
  return [...new Set(hits)];
}

async function writeJsonAtomic(file: string, text: string) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, file);
}

async function appVersion(): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8")) as { version?: string };
    const sha = process.env.GITHUB_SHA?.slice(0, 7);
    return `canary ${pkg.version ?? "?"}${sha ? ` (${sha})` : ""}`;
  } catch {
    return "canary";
  }
}

// ---------- ledger ----------

export async function readLedger(dir = radarDir()): Promise<LedgerFile | null> {
  try {
    return JSON.parse(await readFile(ledgerPath(dir), "utf8")) as LedgerFile;
  } catch {
    return null;
  }
}

/** Realised losses today, for the daily circuit breaker of the next run. */
export async function ledgerLossToday(dir = radarDir(), now = new Date().toISOString()): Promise<number> {
  const l = await readLedger(dir);
  return l ? lossOnDay(replayLedger(l.trail), now) : 0;
}

export const openSymbols = async (dir = radarDir()) => (await readLedger(dir))?.state.positions.map((p) => p.symbol) ?? [];

// ---------- runs ----------

export type SaveInput = { run: LiveRun; rawRyo: RyoRawCall[]; trigger: string; updateLedger?: boolean; dir?: string; expiryDays?: number };
export type SaveResult = { file: string; path: string; ledger: { head: string; added: number } | null };

/** True when the run actually reached RYO: at least one tool answered. Gap-only runs are not saved. */
export const reachedRyo = (run: LiveRun) => run.mode === "live" && run.ryo.configured && run.ryo.calls.some((c) => c.ok);

/** Save a live run (and, by default, apply it to the paper ledger). Throws on fixture runs, gap-only runs, or anything key-shaped. */
export async function saveRun(input: SaveInput): Promise<SaveResult> {
  const dir = input.dir ?? radarDir();
  const { run } = input;
  if (run.mode !== "live") throw new Error("recorded-fixture runs are never saved as runs");
  if (!reachedRyo(run)) throw new Error("RYO did not answer any call in this run, so there is nothing real to save");
  let file = runFileName(run);
  const existing = new Set(await readdir(runsDir(dir)).catch(() => [] as string[]));
  for (let i = 2; existing.has(file); i++) file = runFileName(run).replace(/\.json$/, `-${i}.json`);

  let ledger: SaveResult["ledger"] = null;
  let ledgerFile: LedgerFile | null = null;
  if (input.updateLedger !== false) {
    const prev = await readLedger(dir);
    const { file: next, added } = await updateLedger(prev ?? emptyLedger(run.startedAt), { run, runFile: file, trigger: input.trigger, expiryDays: input.expiryDays });
    ledgerFile = next;
    ledger = { head: added.length ? added[added.length - 1].hash : (next.trail.at(-1)?.hash ?? ""), added: added.length };
  }

  const saved: SavedRun = { format: RUN_FORMAT, savedAt: new Date().toISOString(), appVersion: await appVersion(), trigger: input.trigger, run, rawRyo: input.rawRyo, catalog: run.catalog, ledger };
  const text = JSON.stringify(saved);
  const ledgerText = ledgerFile ? JSON.stringify(ledgerFile, null, 1) : null;
  const leaks = [...findSecrets(text), ...(ledgerText ? findSecrets(ledgerText) : [])];
  if (leaks.length) throw new Error(`refused to save: the run contains something that looks like ${leaks.join(", ")}`);

  const p = path.join(runsDir(dir), file);
  await writeJsonAtomic(p, text);
  if (ledgerText) await writeJsonAtomic(ledgerPath(dir), ledgerText);
  return { file, path: p, ledger };
}

export async function readRun(file: string, dir = radarDir()): Promise<SavedRun | null> {
  if (!RUN_FILE_RE.test(file)) return null; // also keeps any path tricks out
  try {
    return JSON.parse(await readFile(path.join(runsDir(dir), file), "utf8")) as SavedRun;
  } catch {
    return null;
  }
}

/** Newest first. Reads at most `limit` files. */
export async function listRuns(dir = radarDir(), limit = 40): Promise<{ runs: SavedRunSummary[]; total: number }> {
  const names = (await readdir(runsDir(dir)).catch(() => [] as string[])).filter((n) => RUN_FILE_RE.test(n)).sort().reverse();
  const runs: SavedRunSummary[] = [];
  for (const n of names.slice(0, limit)) {
    const s = await readRun(n, dir);
    if (s?.format === RUN_FORMAT) runs.push(summarise(n, s));
  }
  return { runs, total: names.length };
}
