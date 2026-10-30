import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

// The public proof that the Chainlink CRE workflow ran: data/onchain.json (written by `npm run chain:setup`
// and `npm run chain:simulate`) and cre/SIMULATION.md (the simulator's redacted output). Both are optional:
// every function here returns null when the file is missing or isn't a Sepolia record (local test chains).

export type OnchainTx = { kind: string; hash: string; block?: string; status?: string };
export type OnchainRun = { at: string; workflow: string; target: string; broadcast: boolean; cliVersion?: string; command?: string; txs: OnchainTx[] };
export type Onchain = {
  network: "sepolia";
  chainId: number;
  registry: string;
  deployTx: string;
  deployBlock: string;
  deployer: string;
  deployedAt: string;
  simulations: OnchainRun[];
};

export const ETHERSCAN = "https://sepolia.etherscan.io";
const isAddr = (x: unknown): x is string => typeof x === "string" && /^0x[0-9a-fA-F]{40}$/.test(x);
const isHash = (x: unknown): x is string => typeof x === "string" && /^0x[0-9a-fA-F]{64}$/.test(x);
const str = (x: unknown, max = 200) => (typeof x === "string" ? x.slice(0, max) : "");

function readText(...parts: string[]): string | null {
  try {
    return readFileSync(path.join(process.cwd(), ...parts), "utf8");
  } catch {
    return null;
  }
}

/** data/onchain.json, validated (every address and hash checked before it can end up in a link). */
export function loadOnchain(): Onchain | null {
  const raw = readText("data", "onchain.json");
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (j.network !== "sepolia" || !isAddr(j.registry)) return null;
    const runs = Array.isArray(j.simulations) ? (j.simulations as Record<string, unknown>[]) : [];
    return {
      network: "sepolia",
      chainId: Number(j.chainId) || 11155111,
      registry: j.registry,
      deployTx: isHash(j.deployTx) ? j.deployTx : "",
      deployBlock: str(j.deployBlock, 20),
      deployer: isAddr(j.deployer) ? j.deployer : "",
      deployedAt: str(j.deployedAt, 40),
      simulations: runs.map((r) => ({
        at: str(r.at, 40),
        workflow: str(r.workflow, 60),
        target: str(r.target, 60),
        broadcast: r.broadcast === true,
        cliVersion: str(r.cliVersion, 20) || undefined,
        command: str(r.command, 300) || undefined,
        txs: (Array.isArray(r.txs) ? (r.txs as Record<string, unknown>[]) : [])
          .filter((t) => isHash(t.hash))
          .map((t) => ({ kind: str(t.kind, 40) || "report", hash: t.hash as string, block: str(t.block, 20) || undefined, status: str(t.status, 20) || undefined })),
      })),
    };
  } catch {
    return null;
  }
}

/** Every transaction the workflow has written, oldest first, with the run it came from. */
export function onchainTxs(o: Onchain) {
  return o.simulations.flatMap((r) => r.txs.map((t) => ({ ...t, at: r.at, workflow: r.workflow, target: r.target, url: `${ETHERSCAN}/tx/${t.hash}` })));
}

/** cre/SIMULATION.md: the Chainlink CRE simulator's output (already redacted by scripts/chain/simulate.mts). */
export function loadSimulationLog(): string | null {
  const md = readText("cre", "SIMULATION.md");
  return md && md.trim() ? md : null;
}

/** The small, public summary the client components fetch from /api/onchain. */
export function onchainSummary() {
  const o = loadOnchain();
  const log = loadSimulationLog();
  if (!o) return { deployed: false as const, hasLog: Boolean(log) };
  const last = o.simulations[o.simulations.length - 1];
  return {
    deployed: true as const,
    hasLog: Boolean(log),
    registry: o.registry,
    registryUrl: `${ETHERSCAN}/address/${o.registry}`,
    deployTxUrl: o.deployTx ? `${ETHERSCAN}/tx/${o.deployTx}` : null,
    deployBlock: o.deployBlock,
    runs: o.simulations.length,
    lastRun: last ? { at: last.at, workflow: last.workflow, target: last.target, broadcast: last.broadcast, cliVersion: last.cliVersion ?? null } : null,
    txs: onchainTxs(o).map(({ kind, hash, at, workflow, target, url, status }) => ({ kind, hash, at, workflow, target, url, status: status ?? null })),
  };
}
export type OnchainSummary = ReturnType<typeof onchainSummary>;
