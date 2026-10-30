// Shared helpers for scripts/chain/*.mts (Node 24 runs these .mts files directly).
//
// Secrets rule for every script here: private keys and API keys are read, used and passed to child
// processes, but their VALUES are never printed, logged or written anywhere except the two git-ignored
// env files they belong in (.env.local and cre/.env).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const P = {
  envLocal: join(ROOT, ".env.local"),
  creDir: join(ROOT, "cre"),
  creEnv: join(ROOT, "cre", ".env"),
  creEnvExample: join(ROOT, "cre", ".env.example"),
  contracts: join(ROOT, "contracts"),
  artifact: join(ROOT, "contracts", "out", "CanaryRegistry.json"),
  onchain: join(ROOT, "data", "onchain.json"),
  simulationMd: join(ROOT, "cre", "SIMULATION.md"),
  readme: join(ROOT, "README.md"),
  tools: join(ROOT, ".tools"),
  bunBin: join(ROOT, ".tools", "bun", "node_modules", ".bin"),
};

export const SEPOLIA_CHAIN_ID = 11155111;
export const DEFAULT_SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
export const SEPOLIA_MOCK_FORWARDER = "0x15fC6ae953E024d975e77382eEeC56A9101f9F88";
export const SEPOLIA_KEYSTONE_FORWARDER = "0xF8344CFd5c43616a4366C34E3EEE75af79a74482";
export const FAUCET = "https://faucets.chain.link/sepolia";
export const EMAX_SLUG = "emax";

// ───────────── tiny CLI helpers ─────────────

export const args = process.argv.slice(2);
export const flag = (name: string) => args.includes(`--${name}`);
export function opt(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith("--")) return args[i + 1];
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
}

export function fail(msg: string, code = 1): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(code);
}
export const ok = (msg: string) => console.log(`✓ ${msg}`);
export const info = (msg: string) => console.log(`  ${msg}`);

// ───────────── .env files (dotenv-style; values never printed) ─────────────

/** Parses KEY=VALUE lines (export prefix, quotes and inline # comments on unquoted values handled). */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "").trim();
    out[m[1]] = v;
  }
  return out;
}

export function readEnvFile(path: string): Record<string, string> {
  return existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
}

/** process.env wins over .env.local (lets tests point the scripts at a local chain without editing files). */
export function envValue(name: string): string | undefined {
  const v = process.env[name] ?? readEnvFile(P.envLocal)[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

/** Sets KEY=value lines in an env file: replaces existing (uncommented) lines, appends missing ones, keeps everything else byte for byte. */
export function upsertEnvFile(path: string, values: Record<string, string>, header?: string) {
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text === "" ? [] : text.split(/\r?\n/);
  const trailingEmpty = lines.length > 0 && lines[lines.length - 1] === "";
  if (trailingEmpty) lines.pop();
  const done = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && m[1] in values) {
      if (done.has(m[1])) {
        lines.splice(i--, 1); // drop duplicate definitions so the new value is the only one
        continue;
      }
      lines[i] = `${m[1]}=${values[m[1]]}`;
      done.add(m[1]);
    }
  }
  const missing = Object.keys(values).filter((k) => !done.has(k));
  if (missing.length) {
    if (header) lines.push(header);
    for (const k of missing) lines.push(`${k}=${values[k]}`);
  }
  writeFileSync(path, lines.join(eol) + eol);
}

/** Normalises a hex private key to 0x + 64 hex, or returns null. */
export function normaliseKey(raw: string | undefined): `0x${string}` | null {
  if (!raw) return null;
  const k = raw.trim().replace(/^0x/i, "");
  return /^[0-9a-fA-F]{64}$/.test(k) ? (`0x${k.toLowerCase()}` as `0x${string}`) : null;
}

// ───────────── redaction ─────────────

/** Every secret-looking value we know about (from .env.local, cre/.env and the environment), in the forms it could be printed. */
function knownSecrets(): string[] {
  const vals = new Set<string>();
  const sources = [readEnvFile(P.envLocal), readEnvFile(P.creEnv), process.env as Record<string, string | undefined>];
  for (const src of sources) {
    for (const [k, v] of Object.entries(src)) {
      if (!v || v.length < 8) continue;
      if (!/(KEY|SECRET|TOKEN|PASSWORD|PRIVATE)/i.test(k)) continue;
      vals.add(v);
      const hex = v.replace(/^0x/i, "");
      if (/^[0-9a-fA-F]{64}$/.test(hex)) {
        vals.add(hex);
        vals.add(hex.toLowerCase());
        vals.add(hex.toUpperCase());
      }
    }
  }
  return [...vals].sort((a, b) => b.length - a.length);
}

let secretsCache: string[] | null = null;
export function resetSecretCache() {
  secretsCache = null;
}

/** Removes private keys, API keys and other long secrets from text before it is shown or saved. */
export function redact(text: string): string {
  secretsCache ??= knownSecrets();
  let t = text;
  for (const s of secretsCache) t = t.split(s).join("[REDACTED]");
  return t
    .replace(/((?:private[_ -]?key|client[_ -]?secret|api[_ -]?key|password|(?:access|auth|api|bearer)[_ -]?token)[^\n:=]{0,20}[:=]\s*)("?)[^\s"']{8,}\2/gi, "$1$2[REDACTED]$2")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED-JWT]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|ryo_mcp_[A-Za-z0-9_-]{8,}|cre_[A-Za-z0-9_-]{24,})\b/g, "[REDACTED]");
}

export const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\u001b\][^\u0007]*\u0007/g, "");

// ───────────── processes ─────────────

/** process.env with the CRE CLI and Bun prepended to PATH (Windows keeps the key as "Path"). */
export function toolEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  const sep = process.platform === "win32" ? ";" : ":";
  env[pathKey] = [P.tools, P.bunBin, env[pathKey] ?? ""].join(sep);
  return env;
}

export const creExe = () => {
  const local = join(P.tools, process.platform === "win32" ? "cre.exe" : "cre");
  return existsSync(local) ? local : "cre";
};

/** Runs a command, streaming output, and fails the script if it fails. */
export function run(cmd: string, cmdArgs: string[], cwd: string, what: string) {
  // npm/bun are .cmd shims on Windows and need a shell; the arguments here are fixed strings from these scripts
  const viaShell = process.platform === "win32" && !cmd.endsWith(".exe");
  const r = viaShell
    ? spawnSync([cmd, ...cmdArgs].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" "), { cwd, stdio: "inherit", env: toolEnv(), shell: true })
    : spawnSync(cmd, cmdArgs, { cwd, stdio: "inherit", env: toolEnv() });
  if (r.status !== 0) fail(`${what} failed (exit ${r.status ?? r.signal}).`);
}

export function gitIgnored(path: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", path], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ───────────── data/onchain.json ─────────────

export type OnchainTx = { kind: string; hash: string; block?: string; status?: "success" | "reverted" | "unknown" };
export type OnchainSimulation = {
  at: string;
  workflow: string;
  target: string;
  broadcast: boolean;
  cliVersion?: string;
  command?: string;
  result?: Record<string, unknown> | null;
  txs: OnchainTx[];
};
export type Onchain = {
  network: string; // "sepolia" (anything else is a local test chain)
  chainId: number;
  registry: string;
  deployTx: string;
  deployBlock: string;
  deployer: string;
  forwarders: string[];
  relayer: string;
  deployedAt: string;
  explorer: string;
  simulations: OnchainSimulation[];
};

export function readOnchain(): Onchain | null {
  if (!existsSync(P.onchain)) return null;
  try {
    return JSON.parse(readFileSync(P.onchain, "utf8")) as Onchain;
  } catch {
    fail(`${P.onchain} is not valid JSON. Fix or delete it.`);
  }
}

export function writeOnchain(o: Onchain) {
  writeFileSync(P.onchain, `${JSON.stringify(o, null, 2)}\n`);
}

export const explorerFor = (chainId: number) => (chainId === SEPOLIA_CHAIN_ID ? "https://sepolia.etherscan.io" : "");

// ───────────── CRE workflow configs ─────────────

export const WATCH_DIR = join(ROOT, "cre", "canary-watch");
export const TARGET_CONFIG: Record<string, string> = {
  "staging-settings": "config.staging.json",
  "local-settings": "config.local.json",
  "production-settings": "config.production.json",
};

export function readJson<T = Record<string, unknown>>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
export function writeJson(path: string, value: unknown) {
  // keep the file's existing line endings
  const eol = existsSync(path) && readFileSync(path, "utf8").includes("\r\n") ? "\r\n" : "\n";
  writeFileSync(path, JSON.stringify(value, null, 2).replace(/\n/g, eol) + eol);
}

// ───────────── cre workflow simulate output ─────────────

/** Pulls the canary-watch log lines (and any reported tx hashes) out of `cre workflow simulate` output. */
export function parseSimOutput(out: string) {
  const g = (re: RegExp) => out.match(re);
  const snap = g(/Snapshot case=(0x[0-9a-fA-F]{64}) (\S+) level=(\d) promoters=(\d+) liquidityBefore=\$([\d.e+]+) liquidityNow\(app\)=\$([\d.e+]+)/);
  const pool = g(/On-chain (\S+) pair (0x[0-9a-fA-F]{40}): (\S+) reserve=(\d+) price=(\d+) => liquidity=\$([\d.e+]+)/);
  const decision = g(/Decision: alert=(true|false) collapse=(true|false)(?: \(drop ([\d.]+)% vs threshold ([\d.]+)%\))?/);
  const known = g(/Registry already has: level=(\d+) trail=(0x[0-9a-fA-F]+) collapsed=(true|false)/);
  const writes: OnchainTx[] = [];
  // canary-watch logs "Alert|Collapse written to CanaryRegistry, tx 0x…"; canary-claims "Claim verification written to …"
  for (const m of out.matchAll(/\b(Claim verification|[A-Za-z][\w-]*) written to \w+, tx (0x[0-9a-fA-F]{64})/g)) {
    writes.push({ kind: m[1].toLowerCase().replace(/\s+/g, "-"), hash: m[2].toLowerCase() });
  }
  let result: Record<string, unknown> | null = null;
  const rj = out.match(/\{\\?"caseId\\?"[^\n]*\}/);
  if (rj) {
    try {
      result = JSON.parse(rj[0].includes('\\"') ? rj[0].replace(/\\"/g, '"') : rj[0]);
    } catch {
      result = null;
    }
  }
  // fallback: tx hashes listed in the workflow's result JSON but not logged with a kind
  const txs = Array.isArray(result?.txs) ? (result!.txs as string[]) : [];
  for (const h of txs) if (/^0x[0-9a-fA-F]{64}$/.test(h) && !writes.some((w) => w.hash === h.toLowerCase())) writes.push({ kind: "report", hash: h.toLowerCase() });
  return {
    fixture: /Using fixtureSnapshot from config/.test(out),
    snap: snap && { caseId: snap[1], symbol: snap[2], level: Number(snap[3]), promoters: Number(snap[4]), beforeUsd: Number(snap[5]), nowAppUsd: Number(snap[6]) },
    pool: pool && { chain: pool[1], pair: pool[2], quote: pool[3], reserve: BigInt(pool[4]), price: BigInt(pool[5]), liquidityUsd: Number(pool[6]) },
    decision: decision && { alert: decision[1] === "true", collapse: decision[2] === "true", drop: decision[3] ? Number(decision[3]) : null, threshold: decision[4] ? Number(decision[4]) : null },
    known: known && { level: Number(known[1]), trail: known[2], collapsed: known[3] === "true" },
    observeOnly: /observe-only mode/.test(out),
    writes: writes.filter((w) => !/^0x0+$/.test(w.hash)),
    result,
  };
}
