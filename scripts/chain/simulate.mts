// npm run chain:simulate [-- --broadcast] [-- --target staging-settings|local-settings|production-settings]
//                        [-- --url https://your-app.example.com] [-- --workflow canary-watch] [-- --no-wait]
//                        [-- --http-payload <json or file>] [-- --trigger-index 0] [-- --skip-build]
//
// Runs the Chainlink CRE workflow in the official simulator and keeps the proof:
//   1. checks you're logged in to Chainlink (cre whoami, or CRE_API_KEY)
//   2. cre workflow build, then cre workflow simulate … --non-interactive --trigger-index 0   (dry run)
//   3. with --broadcast: the same simulation again with --broadcast, which sends the reports to Sepolia
//      through the CRE MockKeystoneForwarder (real transactions, paid by the key in cre/.env)
//   4. writes cre/SIMULATION.md (redacted full output + what each step did, in plain words) and appends
//      the run and its transaction hashes to data/onchain.json, then refreshes README.md
//
// --target local-settings reads the snapshot from the app running locally (config.local.json snapshotUrl,
// default http://localhost:3100/api/watch/snapshot?case=emax; --url http://localhost:3000 changes it).
// --target production-settings --url https://your-app sets config.production.json snapshotUrl to
// <url>/api/watch/snapshot?case=emax first.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";
import {
  DEFAULT_SEPOLIA_RPC,
  EMAX_SLUG,
  P,
  ROOT,
  TARGET_CONFIG,
  creExe,
  envValue,
  fail,
  flag,
  info,
  ok,
  opt,
  readEnvFile,
  readJson,
  readOnchain,
  redact,
  run,
  stripAnsi,
  toolEnv,
  writeJson,
  writeOnchain,
  parseSimOutput,
} from "./lib.mts";
import { updateReadme } from "./readme.mts";

const target = opt("target") ?? "staging-settings";
const workflow = opt("workflow") ?? "canary-watch";
const broadcast = flag("broadcast");
const wfDir = join(P.creDir, workflow);
const ZERO = "0x0000000000000000000000000000000000000000";

console.log(`\nCanary · Chainlink CRE simulation (${workflow}, ${target}${broadcast ? ", then --broadcast" : ""})\n`);

if (!existsSync(join(wfDir, "workflow.yaml"))) fail(`No CRE workflow at cre/${workflow} (workflow.yaml missing).`);
const cre = creExe();
const creEnv = () => {
  const extra: Record<string, string> = { NO_COLOR: "1", TERM: "dumb" };
  const apiKey = envValue("CRE_API_KEY");
  if (apiKey) extra.CRE_API_KEY = apiKey;
  return toolEnv(extra);
};

// ── 1. Chainlink login ──
const version = (spawnSync(cre, ["version"], { env: creEnv(), encoding: "utf8" }).stdout ?? "").match(/v\d+\.\d+\.\d+/)?.[0];
if (!version) fail(`The CRE CLI isn't available (looked for ${cre}). See cre/README.md for the install.`);
const who = spawnSync(cre, ["whoami"], { cwd: P.creDir, env: creEnv(), encoding: "utf8" });
if (who.status !== 0) {
  fail(
    [
      "You're not logged in to Chainlink, and the simulator needs an account.",
      "  1. Create a free account at https://app.chain.link (see https://docs.chain.link/chainlink-platform/creating-an-account)",
      "  2. In PowerShell:",
      '       $env:Path = "C:\\Users\\daksh\\canary\\.tools;$env:Path"',
      "       cre login        (opens the browser; finish the sign-in and 2FA there)",
      "       cre whoami       (should show your account)",
      "  Headless alternative: create an API key under Organization → API Keys and put CRE_API_KEY=… in .env.local.",
      "  Then run this again: npm run chain:simulate -- --broadcast",
    ].join("\n"),
  );
}
ok(`Chainlink account: logged in (CRE CLI ${version})`);

// ── 2. config for the target ──
const cfgFile = TARGET_CONFIG[target];
if (!cfgFile) fail(`Unknown target "${target}". Use staging-settings, local-settings or production-settings.`);
const cfgPath = join(wfDir, cfgFile);
if (!existsSync(cfgPath)) fail(`cre/${workflow}/${cfgFile} doesn't exist.`);
const cfg = readJson<{ snapshotUrl?: string; registry?: { address?: string; chainName?: string }; liquidity?: { quoteTokens?: { symbol: string; decimals: number; feedDecimals: number; usdFeed: string }[] } }>(cfgPath);

const url = opt("url");
if (url) {
  if (target === "staging-settings") fail("--url only applies to local-settings and production-settings (staging uses the inline EMAX fixture).");
  if (!/^https?:\/\/[^\s]+$/.test(url)) fail(`--url must be an http(s) URL, got "${url}".`);
  const base = url.replace(/\/+$/, "").replace(/\/api\/watch\/snapshot.*$/, "");
  cfg.snapshotUrl = `${base}/api/watch/snapshot?case=${EMAX_SLUG}`;
  writeJson(cfgPath, cfg);
  ok(`cre/${workflow}/${cfgFile} snapshotUrl → ${cfg.snapshotUrl}`);
}
if (cfg.snapshotUrl?.includes("YOUR-CANARY-APP")) fail(`cre/${workflow}/${cfgFile} still has the placeholder URL. Pass --url https://<your deployed Canary app>.`);
if (target === "production-settings" && cfg.snapshotUrl && !cfg.snapshotUrl.startsWith("https://")) fail("production-settings needs an https:// URL (--url https://…).");

if (cfg.snapshotUrl) {
  // fail early and clearly if the app isn't serving the snapshot
  try {
    const r = await fetch(cfg.snapshotUrl, { signal: AbortSignal.timeout(20_000) });
    const j = (await r.json()) as { caseId?: string; symbol?: string; level?: number };
    if (!r.ok || !j.caseId) throw new Error(`HTTP ${r.status}`);
    ok(`Snapshot reachable: ${j.symbol} level ${j.level} (${cfg.snapshotUrl})`);
  } catch (e) {
    fail(`The workflow reads ${cfg.snapshotUrl}, but it isn't answering (${(e as Error).message}).${target === "local-settings" ? "\n  Start the app (npm run dev) or pass --url http://localhost:<port>." : ""}`);
  }
} else if (cfg.snapshotUrl === "") {
  ok("Snapshot: inline fixtureSnapshot (the app's real EMAX verdict, saved in the config)");
}

// ── 3. registry on Sepolia ──
const registry = (cfg.registry?.address ?? ZERO) as Address;
const observeOnly = registry.toLowerCase() === ZERO;
const onchain = readOnchain();
const sepoliaRpc = envValue("SEPOLIA_RPC_URL") ?? DEFAULT_SEPOLIA_RPC;
const sep = createPublicClient({ chain: sepolia, transport: http(sepoliaRpc, { timeout: 20_000, retryCount: 3 }) });

if (observeOnly) {
  if (broadcast) fail("No registry yet (registry.address is the zero address), so there is nothing to broadcast to. Run npm run chain:setup first.");
  info("registry.address is the zero address → observe-only: the workflow decides and logs, writes nothing. (npm run chain:setup deploys the registry.)");
} else {
  const code = await sep.getCode({ address: registry }).catch(() => undefined);
  if (!code || code === "0x") fail(`cre/${workflow}/${cfgFile} points at ${registry}, but there is no contract there on Sepolia. Run npm run chain:setup.`);
  ok(`Registry ${registry} has code on Sepolia`);
  // The workflow reads the registry at the LAST FINALIZED block; before the deploy block is finalized
  // (~13 min on Sepolia) statusOf() returns nothing and the run fails. Wait for it.
  const deployBlock = onchain && onchain.registry.toLowerCase() === registry.toLowerCase() ? BigInt(onchain.deployBlock) : null;
  if (deployBlock !== null && !flag("no-wait")) {
    const deadline = Date.now() + 30 * 60_000;
    for (;;) {
      const fin = await sep.getBlock({ blockTag: "finalized" }).catch(() => null);
      if (fin && fin.number >= deployBlock) {
        ok(`Deploy block ${deployBlock} is finalized (finalized head ${fin.number})`);
        break;
      }
      if (Date.now() > deadline) fail("Sepolia hasn't finalized the deploy block after 30 minutes. Try again later (or pass --no-wait).");
      info(`Waiting for Sepolia to finalize the deploy block ${deployBlock} (finalized head ${fin?.number ?? "?"}; Sepolia finalizes ~13 min after a block)…`);
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
}
if (broadcast) {
  const k = readEnvFile(P.creEnv).CRE_ETH_PRIVATE_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(k.replace(/^0x/, ""))) fail("--broadcast needs CRE_ETH_PRIVATE_KEY in cre/.env (npm run chain:setup writes it from CANARY_RELAYER_KEY).");
  ok("cre/.env has CRE_ETH_PRIVATE_KEY (value not shown)");
}

// ── 4. build + simulate ──
if (!existsSync(join(wfDir, "node_modules"))) run("bun", ["install"], wfDir, `bun install in cre/${workflow}`);
if (!flag("skip-build")) {
  console.log(`\n$ cre workflow build ./${workflow} -T ${target}`);
  run(cre, ["workflow", "build", `./${workflow}`, "-T", target], P.creDir, "cre workflow build");
}

type Captured = { command: string; output: string; code: number | null };
// Reuse the binary we just built (a compile takes minutes); the config still comes from the target.
const builtWasm = !flag("skip-build") && existsSync(join(wfDir, "binary.wasm"));
let useWasm = builtWasm;
function simulate(withBroadcast: boolean): Promise<Captured> {
  const a = ["workflow", "simulate", `./${workflow}`, "-T", target, "--non-interactive", "--trigger-index", opt("trigger-index") ?? "0"];
  if (useWasm) a.push("--wasm", `./${workflow}/binary.wasm`);
  const payload = opt("http-payload"); // HTTP-triggered workflows (canary-claims): JSON string or path to a JSON file
  if (payload) a.push("--http-payload", payload);
  if (withBroadcast) a.push("--broadcast");
  const command = `cre ${a.join(" ")}`;
  console.log(`\n$ ${command}\n`);
  return new Promise((resolve) => {
    const child = spawn(cre, a, { cwd: P.creDir, env: creEnv() });
    let all = "";
    let pending = "";
    const onData = (buf: Buffer) => {
      pending += buf.toString("utf8");
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const l of lines) {
        const clean = redact(stripAnsi(l));
        all += `${clean}\n`;
        console.log(clean);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => {
      if (pending) {
        const clean = redact(stripAnsi(pending));
        all += `${clean}\n`;
        console.log(clean);
      }
      resolve({ command, output: all.replace(/\r/g, ""), code });
    });
  });
}

const failed = (c: Captured) => c.code !== 0 || /workflow (?:execution|simulation) failed|execution error|panic:/i.test(c.output);
const runs: Captured[] = [];
let dry = await simulate(false);
if (failed(dry) && useWasm) {
  info("The run with the pre-built binary failed; retrying and letting the simulator compile the workflow itself…");
  useWasm = false;
  dry = await simulate(false);
}
runs.push(dry);
if (failed(dry)) fail(`The dry-run simulation failed (exit ${dry.code}). Nothing was recorded; cre/SIMULATION.md is unchanged.`);
if (workflow === "canary-watch" && !/Decision: alert=/.test(dry.output)) fail("The simulation finished but the workflow's decision line is missing from the output, so it wasn't recorded. Check the output above.");
let bc: Captured | null = null;
if (broadcast) {
  bc = await simulate(true);
  runs.push(bc);
  if (failed(bc)) fail(`The --broadcast simulation failed (exit ${bc.code}). Nothing was recorded; cre/SIMULATION.md is unchanged.`);
}

// ── 5. parse ──
type Parsed = ReturnType<typeof parseSimOutput>;
const parse = parseSimOutput;
const pd = parse(dry.output);
const pb = bc ? parse(bc.output) : null;

// confirm broadcast transactions on Sepolia
if (pb) {
  for (const w of pb.writes) {
    const r = await sep.waitForTransactionReceipt({ hash: w.hash as Hex, timeout: 120_000 }).catch(() => null);
    // The forwarder's own tx succeeds even when CanaryRegistry.onReport reverts (it catches the call and logs
    // ReportProcessed(result=false)). Only count a write as delivered if the registry itself emitted an event.
    const delivered = Boolean(r?.logs.some((l) => l.address.toLowerCase() === String(registry).toLowerCase()));
    w.status = !r ? "unknown" : r.status !== "success" ? r.status : delivered ? "success" : "rejected-by-registry";
    if (r) w.block = r.blockNumber.toString();
    (w.status === "success" ? ok : info)(`${w.kind} tx ${w.hash} → ${w.status}${r ? ` (block ${r.blockNumber})` : ""}  https://sepolia.etherscan.io/tx/${w.hash}`);
  }
  const rejected = pb.writes.filter((w) => w.status !== "success");
  if (rejected.length)
    fail(
      `${rejected.length} report(s) reached the forwarder but CanaryRegistry did not record them (often: gasLimit too low in the workflow config). Nothing was recorded; cre/SIMULATION.md is unchanged.`,
    );
}

// ── 6. cre/SIMULATION.md ──
const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const LEVEL = ["no signal", "suspicious", "pump-and-dump", "collapsed"];
function explain(p: Parsed, wasBroadcast: boolean): string[] {
  if (workflow !== "canary-watch") {
    return [
      `This is the \`${workflow}\` workflow; see its README for what each step does.`,
      wasBroadcast ? `Transactions it reported: ${p.writes.map((w) => `${w.kind} \`${w.hash}\``).join(", ") || "none"}.` : "",
    ].filter(Boolean);
  }
  const s: string[] = [];
  s.push("1. **Trigger.** The cron trigger (index 0, every 10 minutes in production) fired once.");
  if (p.snap) {
    const how = p.fixture
      ? "came from the inline `fixtureSnapshot` in `config.staging.json`: a byte-for-byte copy of what the Canary app serves at `/api/watch/snapshot?case=emax` (staging runs without the app). Run with `--target local-settings` or `production-settings` to exercise the HTTP fetch on every node."
      : `was fetched over HTTP from \`${cfg.snapshotUrl}\` by the HTTP capability on every node, and reduced with \`ConsensusAggregationByFields\`: case id, symbol, token, level, promoters, pair and trail hash had to be identical, the dollar figures took the median. In the simulator the same consensus code runs locally.`;
    s.push(
      `2. **Snapshot (HTTP + consensus).** The verdict ${how} Agreed value: ${p.snap.symbol}, level ${p.snap.level} (${LEVEL[p.snap.level] ?? "?"}), ${p.snap.promoters} promoters, peak pool liquidity ${usd(p.snap.beforeUsd)}, case id \`${p.snap.caseId}\`.`,
    );
  }
  if (p.pool) {
    const q = cfg.liquidity?.quoteTokens?.find((t) => t.symbol === p.pool!.quote);
    const reserve = q ? Number(p.pool.reserve) / 10 ** q.decimals : Number(p.pool.reserve);
    const price = q ? Number(p.pool.price) / 10 ** q.feedDecimals : Number(p.pool.price);
    s.push(
      `3. **EVM read, Ethereum mainnet (finalized block).** \`token0()\`, \`token1()\` and \`getReserves()\` on the Uniswap V2 pair \`${p.pool.pair}\`: the pool holds ${reserve.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${p.pool.quote}. ` +
        (q?.usdFeed ? `\`latestRoundData()\` on the Chainlink ${p.pool.quote === "WETH" ? "ETH" : p.pool.quote}/USD Data Feed \`${q.usdFeed}\` returned ${usd(price)}. ` : `${p.pool.quote} is priced at $1. `) +
        `A V2 pool holds equal value on both sides, so its liquidity today is 2 × ${reserve.toLocaleString("en-US", { maximumFractionDigits: 4 })} × ${usd(price)} ≈ **${usd(p.pool.liquidityUsd)}**, measured on-chain, not taken from Canary.`,
    );
  } else {
    s.push("3. **EVM read, Ethereum mainnet.** No pool figure was logged (no pair configured, or the pair has no known quote token).");
  }
  if (p.decision) {
    s.push(
      `4. **Decision.** Alert: ${p.decision.alert ? "yes (level ≥ 1)" : "no"}. Collapse: ${p.decision.collapse ? "yes" : "no"}` +
        (p.decision.drop !== null ? `: the pool is down **${p.decision.drop}%** from its ${p.snap ? usd(p.snap.beforeUsd) : "documented"} peak, against a ${p.decision.threshold}% threshold.` : "."),
    );
  }
  if (p.observeOnly) s.push("5. **Registry.** `registry.address` was the zero address, so this run was observe-only: it decided and logged, and wrote nothing.");
  else {
    if (p.known) s.push(`5. **EVM read, Sepolia.** \`statusOf(caseId)\` on CanaryRegistry \`${registry}\` returned level ${p.known.level}, collapsed=${p.known.collapsed}, so the workflow only sends what isn't recorded yet.`);
    if (wasBroadcast) {
      s.push(
        p.writes.length
          ? `6. **EVM write, Sepolia.** \`runtime.report\` → \`writeReport\` → MockKeystoneForwarder \`0x15fC6ae953E024d975e77382eEeC56A9101f9F88\` → \`CanaryRegistry.onReport\`: ${p.writes.map((w) => `${w.kind} [\`${w.hash}\`](https://sepolia.etherscan.io/tx/${w.hash})${w.status ? ` (${w.status})` : ""}`).join(", ")}.`
          : "6. **EVM write, Sepolia.** Nothing new to write: the registry already holds this verdict (see step 5).",
      );
    } else {
      s.push("6. **EVM write.** Dry run: the reports were built and signed by the simulated DON, and the write was simulated, not sent. The `--broadcast` run below sends them.");
    }
  }
  return s;
}

const now = new Date().toISOString();
const key = `${workflow}:${target}`;
const sectionLines = [
  `<!-- sim:${key}:start -->`,
  `## \`${workflow}\` · \`${target}\``,
  "",
  `- **Run at:** ${now.slice(0, 19).replace("T", " ")} UTC`,
  `- **CRE CLI:** ${version}`,
  `- **Registry:** ${observeOnly ? "none (observe-only)" : `[\`${registry}\`](https://sepolia.etherscan.io/address/${registry}) on Ethereum Sepolia`}`,
  `- **Commands** (run from \`cre/\`): \`cre workflow build ./${workflow} -T ${target}\`, then ${runs.map((r) => `\`${r.command}\``).join(", then ")}`,
  "",
  "### What happened, step by step (dry run)",
  "",
  ...explain(pd, false),
  "",
];
if (pb) sectionLines.push("### What the `--broadcast` run did", "", ...explain(pb, true), "");
for (const r of runs) {
  sectionLines.push(`### Full output: \`${r.command}\``, "", "Private keys and API keys are redacted.", "", "```text", r.output.trimEnd().replace(/```/g, "ʼʼʼ"), "```", "");
}
sectionLines.push(`<!-- sim:${key}:end -->`);
const section = sectionLines.join("\n");

const header = [
  "# Chainlink CRE simulation log",
  "",
  "Written by `npm run chain:simulate` (scripts/chain/simulate.mts) from the real output of the Chainlink CRE CLI simulator. Each workflow/target section is replaced on the next run of that combination. Do not edit by hand.",
  "",
  "The registry address and transaction links are also in `data/onchain.json`, on `/judges` in the app, and in README.md → On-chain proof.",
  "",
].join("\n");
let md = existsSync(P.simulationMd) ? readFileSync(P.simulationMd, "utf8").replace(/\r\n/g, "\n") : `${header}\n`;
const startTag = `<!-- sim:${key}:start -->`;
const endTag = `<!-- sim:${key}:end -->`;
const a = md.indexOf(startTag);
const b = md.indexOf(endTag);
md = a >= 0 && b > a ? md.slice(0, a) + section + md.slice(b + endTag.length) : `${md.trimEnd()}\n\n${section}\n`;
md = redact(md);
// last line of defence: never write a known private key, in any form
const relayer = (envValue("CANARY_RELAYER_KEY") ?? "").replace(/^0x/i, "").toLowerCase();
const creKey = (readEnvFile(P.creEnv).CRE_ETH_PRIVATE_KEY ?? "").replace(/^0x/i, "").toLowerCase();
for (const k of [relayer, creKey]) if (k.length >= 32 && md.toLowerCase().includes(k)) fail("Refusing to write cre/SIMULATION.md: it would contain a private key.");
writeFileSync(P.simulationMd, md);
ok("cre/SIMULATION.md");

// ── 7. data/onchain.json ──
if (onchain && !observeOnly && onchain.registry.toLowerCase() === registry.toLowerCase()) {
  for (const [r, p, wasBroadcast] of [[dry, pd, false], ...(bc && pb ? [[bc, pb, true]] : [])] as [Captured, Parsed, boolean][]) {
    onchain.simulations.push({ at: now, workflow, target, broadcast: wasBroadcast, cliVersion: version, command: r.command, result: p.result, txs: wasBroadcast ? p.writes : [] });
  }
  onchain.simulations = onchain.simulations.slice(-30);
  writeOnchain(onchain);
  ok(`data/onchain.json (+${runs.length} run${runs.length > 1 ? "s" : ""}${pb ? `, ${pb.writes.length} tx` : ""})`);
} else if (!observeOnly) {
  info(`data/onchain.json doesn't describe registry ${registry}; runs not recorded there (npm run chain:setup writes it).`);
}
updateReadme();
ok("README.md On-chain proof section");

console.log(`\nDone.${pb?.writes.length ? ` ${pb.writes.length} report(s) on Sepolia. The app shows them on /judges and on /case/emax (refresh).` : ""}\n  View the log: cre/SIMULATION.md  ·  On-chain state: npm run chain:status\n`);
void ROOT;
