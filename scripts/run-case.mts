// Runs the agents on any case with rules only and prints each trail step (for checking).
//   npx tsx scripts/run-case.mts saitama
import { readFileSync } from "node:fs";
import { runCase } from "../src/lib/engine/pipeline";
import { stepClock } from "../src/lib/engine/trail";
const slug = process.argv[2] ?? "emax";
if (!/^[a-z0-9-]+$/.test(slug)) throw new Error("usage: npx tsx scripts/run-case.mts <slug>");
const cf = JSON.parse(readFileSync(`data/cases/${slug}.json`, "utf8"));
const run = await runCase(cf, { llm: null, clock: stepClock("2026-10-30T00:00:00Z") });
for (const e of run.trail) console.log(`#${e.seq} [${e.agent}] ${e.kind}: ${e.summary}`);
console.log("verdict", run.debate.judge.verdict, run.debate.judge.score, "trade", run.trade.decision, run.trade.reasons);
console.log("gaps", run.gaps.map((g) => g.source + ": " + g.what));
console.log("head", run.headHash, "ok", run.trailOk);
console.log("convergence", JSON.stringify(run.convergence.bestCluster?.reasoning));
console.log("news", run.news.map((n) => `${n.claimId}: ${n.verdict}`).join("; "));
console.log("hunter", JSON.stringify([...run.hunter.selected, ...run.hunter.rejected].map((v) => ({ s: v.symbol, score: v.score, rules: v.rules.map((r) => `${r.id}=${r.outcome}`) }))));
console.log("collapse", JSON.stringify(run.collapse).slice(0, 400));
console.log("trade", JSON.stringify({ plan: run.trade.plan, hindsight: run.trade.hindsight }));
console.log("judge", run.debate.judge.reasoning);
