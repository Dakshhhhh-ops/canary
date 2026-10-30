// A saved radar run, and how anyone (a judge's browser included) re-checks it with no key:
// the trail must verify, and every raw RYO reply in the file must hash to the digest the trail recorded.
// Browser-safe: Web Crypto only.
import { canonical, sha256Hex } from "../canonical";
import type { LiveRun } from "../engine/pipeline";
import type { Catalog, RyoRawCall } from "../engine/ryo";
import { verifyTrail } from "../engine/trail";

export const RUN_FORMAT = "canary.radar.run/1";

export type SavedRun = {
  format: typeof RUN_FORMAT;
  savedAt: string;
  appVersion: string;
  trigger: string; // "schedule" | "manual" | "ui"
  run: LiveRun; // includes the full hash-chained trail
  rawRyo: RyoRawCall[]; // every request and the server's reply, as received (no key: it only ever travelled in a header)
  catalog: Catalog; // the tool catalog snapshot this run worked from
  ledger: { head: string; added: number } | null; // the ledger entries this run produced
};

export type SavedRunSummary = {
  file: string;
  startedAt: string;
  savedAt: string;
  trigger: string;
  symbols: string[];
  callsOk: number;
  calls: number;
  accepted: string[];
  refused: number;
  gaps: number;
  headHash: string;
  catalogSource: Catalog["source"];
  tools: number;
};

export const summarise = (file: string, s: SavedRun): SavedRunSummary => ({
  file,
  startedAt: s.run.startedAt,
  savedAt: s.savedAt,
  trigger: s.trigger,
  symbols: s.run.symbols,
  callsOk: s.run.ryo.calls.filter((c) => c.ok).length,
  calls: s.run.ryo.calls.length,
  accepted: s.run.perSymbol.filter((p) => p.trade.decision === "accepted").map((p) => p.symbol),
  refused: s.run.perSymbol.filter((p) => p.trade.decision === "refused").length,
  gaps: s.run.gaps.length,
  headHash: s.run.headHash,
  catalogSource: s.catalog.source,
  tools: s.catalog.tools.length,
});

export type SavedRunCheck = { ok: boolean; steps: number; head: string | null; rawChecked: number; problems: string[] };

/** Re-verify a saved run: the trail chain, its head, and each raw reply against the digest the trail holds. */
export async function verifySavedRun(s: SavedRun): Promise<SavedRunCheck> {
  const problems: string[] = [];
  const chain = await verifyTrail(s.run.trail);
  if (!chain.ok) problems.push(`trail broken at step ${chain.seq}: ${chain.reason}`);
  else if (chain.head !== s.run.headHash) problems.push("the trail's last hash is not the head the run reports");
  const collector = s.run.trail.find((e) => e.kind === "collector.ryo" || e.kind === "collector.ryo-unavailable");
  const recorded = ((collector?.data as { raw?: { tool: string; digest: string | null }[] } | undefined)?.raw ?? []) as { tool: string; digest: string | null }[];
  if (recorded.length !== s.rawRyo.length) problems.push(`the trail lists ${recorded.length} RYO calls but the file holds ${s.rawRyo.length} replies`);
  let rawChecked = 0;
  for (let i = 0; i < Math.min(recorded.length, s.rawRyo.length); i++) {
    const r = s.rawRyo[i];
    const digest = r.response == null ? null : await sha256Hex(canonical(r.response));
    if (r.tool !== recorded[i].tool || digest !== recorded[i].digest) problems.push(`RYO reply ${i + 1} (${r.tool}) does not match what the trail recorded`);
    else rawChecked++;
  }
  const catStep = s.run.trail.find((e) => e.kind === "collector.catalog");
  if (catStep && canonical(catStep.data) !== canonical(s.catalog)) problems.push("the catalog snapshot differs from the one in the trail");
  return { ok: problems.length === 0, steps: s.run.trail.length, head: chain.ok ? chain.head : null, rawChecked, problems };
}
