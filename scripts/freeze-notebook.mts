// Freezes the agents' notebook for a case into data/notebooks/<slug>.json.
// This exact file is what the Chainlink workflow records on-chain (its final fingerprint), so it must stay
// downloadable and verifiable even after the agents' code changes. Run it once before recording on-chain:
//   npx tsx scripts/freeze-notebook.mts emax
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { runCase } from "../src/lib/engine/pipeline";
import { stepClock, verifyTrail } from "../src/lib/engine/trail";

const slug = process.argv[2] ?? "emax";
const cf = JSON.parse(readFileSync(`data/cases/${slug}.json`, "utf8"));
const run = await runCase(cf, { llm: null, clock: stepClock("2026-10-30T00:00:00.000Z") });
const check = await verifyTrail(run.trail);
if (!check.ok) throw new Error(`notebook does not verify: ${check.reason}`);
let commit: string | null = null;
try {
  commit = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
} catch {}
const out = {
  format: "canary.notebook/1",
  slug,
  headHash: run.headHash,
  verdict: run.debate.judge.verdict,
  collapsed: run.collapse.detected,
  promoters: new Set(cf.posts.map((p: { promoter: string }) => p.promoter)).size,
  frozenAt: new Date().toISOString(),
  engineCommit: commit,
  note: "The agents' notebook exactly as recorded on-chain by the Chainlink workflow. Verify it at /verify.",
  trail: run.trail,
};
mkdirSync("data/notebooks", { recursive: true });
writeFileSync(`data/notebooks/${slug}.json`, JSON.stringify(out, null, 2) + "\n");
console.log(`froze ${slug}: ${run.trail.length} steps, head 0x${run.headHash}`);
