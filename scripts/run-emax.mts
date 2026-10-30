// Runs the agents on the EMAX case with rules only and prints each trail step (for checking).
import { readFileSync } from "node:fs";
import { runCase } from "../src/lib/engine/pipeline";
import { stepClock } from "../src/lib/engine/trail";
const cf = JSON.parse(readFileSync("data/cases/emax.json", "utf8"));
const run = await runCase(cf, { llm: null, clock: stepClock("2026-10-30T00:00:00Z") });
for (const e of run.trail) console.log(`#${e.seq} [${e.agent}] ${e.kind}: ${e.summary}`);
console.log("verdict", run.debate.judge.verdict, run.debate.judge.score, "trade", run.trade.decision, run.trade.reasons);
console.log("gaps", run.gaps.map((g) => g.source + ": " + g.what));
console.log("head", run.headHash, "ok", run.trailOk);
console.log("convergence", JSON.stringify(run.convergence.bestCluster?.reasoning));
console.log("collapse", JSON.stringify(run.collapse).slice(0, 400));
