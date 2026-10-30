// npm run chain:readme — refreshes the generated part of README.md's "On-chain proof" section from
// data/onchain.json (setup and simulate call this automatically). Only the text between the
// <!-- onchain:start --> and <!-- onchain:end --> markers is replaced.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { P, readOnchain } from "./lib.mts";

const START = "<!-- onchain:start -->";
const END = "<!-- onchain:end -->";

export function renderOnchainBlock(): string {
  const o = readOnchain();
  if (!o || o.network !== "sepolia") {
    return "_Not deployed yet._ Once the commands above have run, this block lists the registry and every transaction the workflow wrote, with Etherscan links (generated from `data/onchain.json`).";
  }
  const ex = o.explorer || "https://sepolia.etherscan.io";
  const lines = [
    `- **CanaryRegistry (Sepolia):** [\`${o.registry}\`](${ex}/address/${o.registry}) · deployed in block ${o.deployBlock} ([deploy tx](${ex}/tx/${o.deployTx}))`,
  ];
  const writes = o.simulations.flatMap((s) => s.txs.map((t) => ({ s, t })));
  if (writes.length) {
    lines.push("- **Reports written by the CRE workflow** (`cre workflow simulate --broadcast` → MockKeystoneForwarder → `CanaryRegistry.onReport`):");
    for (const { s, t } of writes) {
      lines.push(`  - ${t.kind} · [\`${t.hash.slice(0, 10)}…${t.hash.slice(-8)}\`](${ex}/tx/${t.hash}) · ${s.workflow} \`${s.target}\` · ${s.at.slice(0, 16).replace("T", " ")} UTC${t.status === "reverted" ? " · **reverted**" : ""}`);
    }
  } else {
    lines.push("- No broadcast run yet: `npm run chain:simulate -- --broadcast` writes the alert and collapse reports.");
  }
  const runs = o.simulations.length;
  if (runs) {
    const last = o.simulations[o.simulations.length - 1];
    lines.push(`- **Simulation runs recorded:** ${runs} (last: ${last.workflow} \`${last.target}\`${last.broadcast ? " with --broadcast" : ""}, CRE CLI ${last.cliVersion ?? "?"}, ${last.at.slice(0, 16).replace("T", " ")} UTC)`);
  }
  if (existsSync(P.simulationMd)) lines.push("- **Full simulator output:** [cre/SIMULATION.md](cre/SIMULATION.md) (also shown on `/judges` in the app)");
  return lines.join("\n");
}

export function updateReadme(): boolean {
  if (!existsSync(P.readme)) return false;
  const text = readFileSync(P.readme, "utf8");
  const a = text.indexOf(START);
  const b = text.indexOf(END);
  if (a < 0 || b < a) return false;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const next = `${text.slice(0, a + START.length)}${eol}${renderOnchainBlock().replace(/\n/g, eol)}${eol}${text.slice(b)}`;
  if (next !== text) writeFileSync(P.readme, next);
  return true;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  console.log(updateReadme() ? "README.md On-chain proof section updated." : "README.md has no <!-- onchain:start --> / <!-- onchain:end --> markers; nothing changed.");
}
