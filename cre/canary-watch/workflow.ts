/**
 * canary-watch: the Chainlink CRE workflow behind Canary.
 *
 * Every 10 minutes (cron trigger):
 *   1. HTTP  - fetch Canary's verdicts from the Canary app. Either ONE case (/api/watch/snapshot?case=emax)
 *              or the LIST of watched cases (/api/watch/snapshot?list=1: the EMAX case file plus every coin the
 *              live radar flagged). Every DON node fetches it; the nodes must agree (consensus) before anything
 *              is used. An optional bearer token comes from a CRE secret, never from the config.
 *   2. EVM read (Ethereum mainnet) - read each token's Uniswap V2 pool reserves and the Chainlink
 *              ETH/USD feed, so the "liquidity was pulled" claim is checked on-chain, independently of
 *              Canary's own numbers.
 *   3. EVM read (Sepolia) - ask CanaryRegistry what it already knows, so we don't re-send old news.
 *   4. EVM write (Sepolia) - signed reports to CanaryRegistry.onReport:
 *        alert    when the agents rate the case level >= 1
 *        collapse when on-chain liquidity is down >= 80% from the snapshot's "before" figure
 *
 * CRE allows 15 chain reads and 10 writes per run. One case costs at most 3 pool reads + 1 registry read
 * (the ETH/USD price is read once per run and shared), so a run handles at most `maxCasesPerRun` (3 by
 * default) cases, and longer lists are worked through in turns, one slice per run (see pickCases).
 */
import {
	bytesToHex,
	ConsensusAggregationByFields,
	consensusIdenticalAggregation,
	type CronPayload,
	cre,
	encodeCallMsg,
	getNetwork,
	type HTTPSendRequester,
	identical,
	json,
	LAST_FINALIZED_BLOCK_NUMBER,
	median,
	ok,
	prepareReportRequest,
	type Runtime,
	TxStatus,
} from '@chainlink/cre-sdk'
import {
	type Address,
	decodeFunctionResult,
	encodeAbiParameters,
	encodeFunctionData,
	type Hex,
	isAddress,
	zeroAddress,
} from 'viem'
import { z } from 'zod'
import {
	AggregatorV3,
	AlertBodyParams,
	CanaryRegistry,
	CollapseBodyParams,
	REPORT_ALERT,
	REPORT_COLLAPSE,
	ReportEnvelopeParams,
	UniswapV2Pair,
} from './abi'

// ───────────────────────────── Config ─────────────────────────────

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'must be 0x + 32 bytes hex')
const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 0x EVM address')

/** The JSON the Canary app serves at /api/watch/snapshot (also usable inline as a fixture). */
export const snapshotSchema = z.object({
	caseId: hex32,
	symbol: z.string(),
	token: z.string(), // EVM address of the token (anything else is recorded as address(0))
	level: z.number().int().min(0).max(3), // 0 none, 1 suspicious, 2 pump-and-dump, 3 collapsed
	promoters: z.number().int().min(0),
	trailHash: hex32,
	liquidityBeforeUsd: z.number().min(0),
	liquidityNowUsd: z.number().min(0),
	pair: evmAddress.optional(), // optional: Uniswap V2 pair for this token (overrides config)
})
export type Snapshot = z.infer<typeof snapshotSchema>

/** Most cases one list may carry (keeps the consensus observation well under CRE's 25 kB). */
export const MAX_LIST = 25
/** The JSON the Canary app serves at /api/watch/snapshot?list=1. Extra fields (gaps, notes) are ignored. */
export const snapshotListSchema = z.object({ cases: z.array(snapshotSchema).max(MAX_LIST) })

const quoteTokenSchema = z.object({
	symbol: z.string(),
	address: evmAddress,
	decimals: z.number().int().min(0).max(36),
	// Chainlink USD feed for this token on the liquidity chain; "" means the token is a $1 stablecoin.
	usdFeed: z.union([evmAddress, z.literal('')]),
	feedDecimals: z.number().int().min(0).max(36),
})

export const configSchema = z.object({
	schedule: z.string(), // e.g. "0 */10 * * * *" (every 10 minutes)
	// URL of the Canary snapshot API for ONE case. Empty string => use `fixtureSnapshot` instead (offline demo/testing).
	snapshotUrl: z.string(),
	fixtureSnapshot: snapshotSchema.optional(),
	// URL of the LIST of watched cases (/api/watch/snapshot?list=1). When set (non-empty) it wins over snapshotUrl.
	snapshotListUrl: z.string().optional(),
	// Offline list (used when both URLs are empty and fixtureSnapshot is not set).
	fixtureSnapshots: z.array(snapshotSchema).max(MAX_LIST).optional(),
	// List mode: how many cases one run handles (default 3; see CRE read budget above) and how often the
	// slice moves on (minutes; default 10 = the cron interval).
	maxCasesPerRun: z.number().int().min(1).max(5).optional(),
	rotateEveryMinutes: z.number().int().min(1).optional(),
	// Name of a CRE secret holding a bearer token for the snapshot API ("" or absent = public fetch).
	// The value lives in the secrets store (cre/secrets.yaml -> an env var in simulation, Vault DON when deployed).
	authSecret: z.string().optional(),
	collapseDropBps: z.number().int().min(1).max(10_000), // 8000 = 80%
	liquidity: z.object({
		chainName: z.string(), // "ethereum-mainnet"
		pairAddress: z.union([evmAddress, z.literal('')]), // default Uniswap V2 pair to watch
		quoteTokens: z.array(quoteTokenSchema).min(1), // what the pool is priced against (WETH, USDC, ...)
	}),
	registry: z.object({
		chainName: z.string(), // "ethereum-testnet-sepolia"
		// CanaryRegistry address. Zero address => "observe only": decide and log, but write nothing.
		address: evmAddress,
		gasLimit: z.string(),
	}),
})
export type Config = z.infer<typeof configSchema>

/** CRE's per-run limit on chain reads (ChainRead.CallLimit in `cre workflow limits export`). */
export const CHAIN_READ_LIMIT = 15
export const DEFAULT_MAX_CASES = 3

// ───────────────────────────── Helpers ─────────────────────────────

const safeJson = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x))

function evmClientFor(chainName: string) {
	const network = getNetwork({ chainFamily: 'evm', chainSelectorName: chainName })
	if (!network) throw new Error(`Unknown chain name: ${chainName}`)
	return new cre.capabilities.EVMClient(network.chainSelector.selector)
}

type EvmClient = ReturnType<typeof evmClientFor>

/** Counts chain reads, so a run never goes over CRE's limit. */
export type ReadBudget = { used: number; readonly limit: number }

function readView(runtime: Runtime<Config>, client: EvmClient, to: Address, data: Hex, budget?: ReadBudget): Hex {
	if (budget) {
		if (budget.used >= budget.limit) throw new Error(`CRE chain-read limit (${budget.limit}) reached`)
		budget.used++
	}
	const reply = client
		.callContract(runtime, {
			call: encodeCallMsg({ from: zeroAddress, to, data }),
			blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
		})
		.result()
	return bytesToHex(reply.data)
}

const usdToCents = (usd: number): bigint => BigInt(Math.round(usd * 100))

/** Drop in basis points from `before` to `now` (0 when it went up). */
export function dropBps(before: bigint, now: bigint): number {
	if (before <= 0n || now >= before) return 0
	return Number(((before - now) * 10_000n) / before)
}

// ───────────────────── Step 1: HTTP snapshot (with consensus) ─────────────────────

/**
 * What every node returns after fetching the snapshot. Only primitives, so the DON can compare them:
 * the identity/verdict fields must be identical on every node; the dollar figures use the median.
 */
export type SnapshotObservation = {
	caseId: string
	symbol: string
	token: string
	level: number
	promoters: number
	trailHash: string
	pair: string
	liquidityBeforeCents: bigint
	liquidityNowCents: bigint
}

const toObservation = (s: Snapshot): SnapshotObservation => ({
	caseId: s.caseId.toLowerCase(),
	symbol: s.symbol,
	token: s.token,
	level: s.level,
	promoters: s.promoters,
	trailHash: s.trailHash.toLowerCase(),
	pair: s.pair ?? '',
	liquidityBeforeCents: usdToCents(s.liquidityBeforeUsd),
	liquidityNowCents: usdToCents(s.liquidityNowUsd),
})

const requestHeaders = (token: string): Record<string, string> =>
	token ? { accept: 'application/json', authorization: `Bearer ${token}` } : { accept: 'application/json' }

/** Runs on each node (node mode). `token` is the optional bearer token read from a CRE secret. */
export const fetchSnapshot = (sendRequester: HTTPSendRequester, config: Config, token = ''): SnapshotObservation => {
	const response = sendRequester
		.sendRequest({
			url: config.snapshotUrl,
			method: 'GET',
			headers: requestHeaders(token),
		})
		.result()
	if (!ok(response)) throw new Error(`Snapshot request failed: HTTP ${response.statusCode}`)
	const parsed = snapshotSchema.safeParse(json(response))
	if (!parsed.success) throw new Error(`Snapshot JSON is not in the expected shape: ${parsed.error.message}`)
	return toObservation(parsed.data)
}

export const snapshotAggregation = ConsensusAggregationByFields<SnapshotObservation>({
	caseId: identical,
	symbol: identical,
	token: identical,
	level: identical,
	promoters: identical,
	trailHash: identical,
	pair: identical,
	liquidityBeforeCents: median,
	liquidityNowCents: median,
})

/**
 * List mode, on each node: fetch, validate, drop repeated case ids, and reduce the list to one canonical
 * string. The DON then requires that string to be IDENTICAL on every node (the app builds the list from
 * saved files with no clock, so honest nodes always agree). A median per figure isn't possible across a
 * list; a node that saw anything different simply doesn't reach consensus, and the run writes nothing.
 */
export function canonicalList(cases: Snapshot[]): string {
	const seen = new Set<string>()
	const out: Record<string, string | number>[] = []
	for (const s of cases) {
		const o = toObservation(s)
		if (seen.has(o.caseId)) continue
		seen.add(o.caseId)
		out.push({
			...o,
			liquidityBeforeCents: o.liquidityBeforeCents.toString(),
			liquidityNowCents: o.liquidityNowCents.toString(),
		})
	}
	return JSON.stringify(out)
}

export function parseCanonicalList(text: string): SnapshotObservation[] {
	return (JSON.parse(text) as Record<string, string | number>[]).map((o) => ({
		caseId: String(o.caseId),
		symbol: String(o.symbol),
		token: String(o.token),
		level: Number(o.level),
		promoters: Number(o.promoters),
		trailHash: String(o.trailHash),
		pair: String(o.pair),
		liquidityBeforeCents: BigInt(o.liquidityBeforeCents),
		liquidityNowCents: BigInt(o.liquidityNowCents),
	}))
}

export const fetchSnapshotList = (sendRequester: HTTPSendRequester, config: Config, token = ''): string => {
	const response = sendRequester
		.sendRequest({ url: config.snapshotListUrl ?? '', method: 'GET', headers: requestHeaders(token) })
		.result()
	if (!ok(response)) throw new Error(`Snapshot list request failed: HTTP ${response.statusCode}`)
	const parsed = snapshotListSchema.safeParse(json(response))
	if (!parsed.success) throw new Error(`Snapshot list JSON is not in the expected shape: ${parsed.error.message}`)
	return canonicalList(parsed.data.cases)
}

/** The bearer token from the CRE secret named in `authSecret`; "" when none is configured or set. */
export function readAuthToken(runtime: Runtime<Config>): string {
	const id = runtime.config.authSecret ?? ''
	if (id === '') return ''
	try {
		const value = runtime.getSecret({ id }).result().value
		runtime.log(value ? `Using the ${id} secret as a bearer token for the snapshot API` : `Secret ${id} is empty: public fetch`)
		return value
	} catch {
		runtime.log(`Secret ${id} is not available: fetching the snapshot without Authorization`)
		return ''
	}
}

type Source = { kind: 'one'; snap: SnapshotObservation } | { kind: 'list'; cases: SnapshotObservation[] }

function getSource(runtime: Runtime<Config>): Source {
	const cfg = runtime.config
	const http = () => new cre.capabilities.HTTPClient()
	if ((cfg.snapshotListUrl ?? '') !== '') {
		const token = readAuthToken(runtime)
		const text = http().sendRequest(runtime, fetchSnapshotList, consensusIdenticalAggregation<string>())(cfg, token).result()
		return { kind: 'list', cases: parseCanonicalList(text) }
	}
	if (cfg.snapshotUrl !== '') {
		const token = readAuthToken(runtime)
		return { kind: 'one', snap: http().sendRequest(runtime, fetchSnapshot, snapshotAggregation)(cfg, token).result() }
	}
	if (cfg.fixtureSnapshot) {
		runtime.log('Using fixtureSnapshot from config (snapshotUrl is empty)')
		return { kind: 'one', snap: toObservation(cfg.fixtureSnapshot) }
	}
	if (cfg.fixtureSnapshots) {
		runtime.log('Using fixtureSnapshots from config (snapshotListUrl and snapshotUrl are empty)')
		return { kind: 'list', cases: parseCanonicalList(canonicalList(cfg.fixtureSnapshots)) }
	}
	throw new Error('snapshotUrl and snapshotListUrl are empty and no fixtureSnapshot(s) is configured')
}

/**
 * Which cases this run handles. A list longer than `cap` is worked through in turns: run k takes the `cap`
 * cases starting at k*cap (wrapping around), where k counts `rotateEveryMinutes` slots since 1970 from the
 * cron trigger's scheduled time. Every node sees the same scheduled time, so they all pick the same slice.
 */
export function pickCases<T>(cases: T[], cap: number, runIndex: number): { picked: T[]; deferred: T[] } {
	if (cases.length <= cap) return { picked: [...cases], deferred: [] }
	const start = (runIndex * cap) % cases.length
	const order = [...cases.slice(start), ...cases.slice(0, start)]
	return { picked: order.slice(0, cap), deferred: order.slice(cap) }
}

export function runIndexOf(payload: CronPayload | undefined, rotateEveryMinutes: number): number {
	const s = payload?.scheduledExecutionTime?.seconds
	if (s === undefined) return 0
	return Number(BigInt(s) / BigInt(60 * rotateEveryMinutes))
}

// ───────────────────── Step 2: on-chain liquidity (Ethereum mainnet) ─────────────────────

export type OnchainLiquidity = {
	pair: string
	quoteSymbol: string
	quoteReserve: bigint
	quoteUsdPrice: bigint // scaled by feedDecimals
	liquidityCents: bigint // 2 x quote side, in US cents (a V2 pool holds equal value on both sides)
}

/** Per-run cache: one Chainlink feed read serves every case priced in the same quote token. */
export type FeedCache = Map<string, bigint>

export function readOnchainLiquidity(
	runtime: Runtime<Config>,
	pair: Address,
	budget?: ReadBudget,
	feeds?: FeedCache,
): OnchainLiquidity | null {
	const cfg = runtime.config.liquidity
	const client = evmClientFor(cfg.chainName)

	const token0 = decodeFunctionResult({
		abi: UniswapV2Pair,
		functionName: 'token0',
		data: readView(runtime, client, pair, encodeFunctionData({ abi: UniswapV2Pair, functionName: 'token0' }), budget),
	}) as Address
	const token1 = decodeFunctionResult({
		abi: UniswapV2Pair,
		functionName: 'token1',
		data: readView(runtime, client, pair, encodeFunctionData({ abi: UniswapV2Pair, functionName: 'token1' }), budget),
	}) as Address
	const [reserve0, reserve1] = decodeFunctionResult({
		abi: UniswapV2Pair,
		functionName: 'getReserves',
		data: readView(runtime, client, pair, encodeFunctionData({ abi: UniswapV2Pair, functionName: 'getReserves' }), budget),
	}) as readonly [bigint, bigint, number]

	const quote = cfg.quoteTokens.find(
		(q) => q.address.toLowerCase() === token0.toLowerCase() || q.address.toLowerCase() === token1.toLowerCase(),
	)
	if (!quote) {
		runtime.log(`Pair ${pair} (${token0}/${token1}) has no configured quote token; cannot price it on-chain`)
		return null
	}
	const quoteReserve = quote.address.toLowerCase() === token0.toLowerCase() ? reserve0 : reserve1

	let price = 10n ** BigInt(quote.feedDecimals) // $1 for stablecoins
	if (quote.usdFeed !== '') {
		const cached = feeds?.get(quote.usdFeed.toLowerCase())
		if (cached !== undefined) {
			price = cached
		} else {
			const round = decodeFunctionResult({
				abi: AggregatorV3,
				functionName: 'latestRoundData',
				data: readView(
					runtime,
					client,
					quote.usdFeed as Address,
					encodeFunctionData({ abi: AggregatorV3, functionName: 'latestRoundData' }),
					budget,
				),
			}) as readonly [bigint, bigint, bigint, bigint, bigint]
			price = round[1]
			if (price <= 0n) throw new Error(`Chainlink feed ${quote.usdFeed} returned a non-positive price`)
			feeds?.set(quote.usdFeed.toLowerCase(), price)
		}
	}

	// cents = 2 * reserve / 10^decimals * price / 10^feedDecimals * 100
	const liquidityCents =
		(2n * quoteReserve * price * 100n) / (10n ** BigInt(quote.decimals) * 10n ** BigInt(quote.feedDecimals))

	return { pair, quoteSymbol: quote.symbol, quoteReserve, quoteUsdPrice: price, liquidityCents }
}

// ───────────────────── Step 3 + 4: registry read and report writes (Sepolia) ─────────────────────

type RegistryStatus = { level: number; trailHash: string; collapsed: boolean }

function readRegistryStatus(runtime: Runtime<Config>, client: EvmClient, caseId: Hex, budget?: ReadBudget): RegistryStatus {
	const [level, trailHash, collapsed] = decodeFunctionResult({
		abi: CanaryRegistry,
		functionName: 'statusOf',
		data: readView(
			runtime,
			client,
			runtime.config.registry.address as Address,
			encodeFunctionData({ abi: CanaryRegistry, functionName: 'statusOf', args: [caseId] }),
			budget,
		),
	}) as readonly [number, Hex, boolean]
	return { level: Number(level), trailHash: trailHash.toLowerCase(), collapsed }
}

export function encodeAlertReport(s: SnapshotObservation): Hex {
	const token = isAddress(s.token, { strict: false }) ? (s.token.toLowerCase() as Address) : zeroAddress
	const body = encodeAbiParameters(AlertBodyParams, [
		s.caseId as Hex,
		s.symbol,
		token,
		s.level,
		s.promoters,
		s.trailHash as Hex,
	])
	return encodeAbiParameters(ReportEnvelopeParams, [REPORT_ALERT, body])
}

export function encodeCollapseReport(
	s: SnapshotObservation,
	liquidityBeforeCents: bigint,
	liquidityNowCents: bigint,
	drop: number,
): Hex {
	const token = isAddress(s.token, { strict: false }) ? (s.token.toLowerCase() as Address) : zeroAddress
	const body = encodeAbiParameters(CollapseBodyParams, [
		s.caseId as Hex,
		token,
		liquidityBeforeCents,
		liquidityNowCents,
		drop,
	])
	return encodeAbiParameters(ReportEnvelopeParams, [REPORT_COLLAPSE, body])
}

function writeToRegistry(runtime: Runtime<Config>, client: EvmClient, reportHex: Hex, what: string): string {
	// Consensus: the DON signs the report; the forwarder verifies the signatures on-chain.
	const report = runtime.report(prepareReportRequest(reportHex)).result()
	const result = client
		.writeReport(runtime, {
			receiver: runtime.config.registry.address,
			report,
			gasConfig: { gasLimit: runtime.config.registry.gasLimit },
		})
		.result()
	if (result.txStatus !== TxStatus.SUCCESS) {
		throw new Error(`${what} write failed: ${result.errorMessage || `txStatus ${result.txStatus}`}`)
	}
	const txHash = bytesToHex(result.txHash ?? new Uint8Array(32))
	runtime.log(`${what} written to CanaryRegistry, tx ${txHash}`)
	return txHash
}

// ───────────────────────────── Handler ─────────────────────────────

export type WatchResult = {
	caseId: string
	symbol: string
	level: number
	onchainLiquidityCents: string | null
	snapshotLiquidityNowCents: string
	liquidityBeforeCents: string
	dropBps: number | null
	alert: 'written' | 'already-recorded' | 'not-needed' | 'observe-only'
	collapse: 'written' | 'already-recorded' | 'not-needed' | 'unconfirmed' | 'observe-only'
	txs: string[]
}

/** The run's result in list mode. */
export type WatchListResult = {
	mode: 'list'
	listed: number
	runIndex: number
	cases: WatchResult[]
	deferred: { caseId: string; symbol: string; reason: string }[]
	chainReads: number
	txs: string[]
}

type RunContext = { budget: ReadBudget; feeds: FeedCache; registry: EvmClient | null }

/** Reads that one case may need at most: 3 pool reads, an uncached feed read, and statusOf. */
function worstCaseReads(runtime: Runtime<Config>, snap: SnapshotObservation, ctx: RunContext): number {
	const cfg = runtime.config
	const hasPair = (snap.pair !== '' ? snap.pair : cfg.liquidity.pairAddress) !== ''
	const uncachedFeed = cfg.liquidity.quoteTokens.some((q) => q.usdFeed !== '' && !ctx.feeds.has(q.usdFeed.toLowerCase()))
	return (hasPair ? 3 + (uncachedFeed ? 1 : 0) : 0) + (ctx.registry ? 1 : 0)
}

/** Steps 2-4 for one case. */
function watchCase(runtime: Runtime<Config>, snap: SnapshotObservation, ctx: RunContext): WatchResult {
	const cfg = runtime.config
	runtime.log(
		`Snapshot case=${snap.caseId} ${snap.symbol} caseLevel=${snap.level} promoters=${snap.promoters} ` +
			`liquidityBefore=$${Number(snap.liquidityBeforeCents) / 100} liquidityNow(app)=$${Number(snap.liquidityNowCents) / 100}`,
	)

	// 2. Independent on-chain liquidity check
	const pair = (snap.pair !== '' ? snap.pair : cfg.liquidity.pairAddress) as Address | ''
	let onchain: OnchainLiquidity | null = null
	if (pair === '') {
		runtime.log('No Uniswap V2 pair configured for this case; skipping the on-chain liquidity check')
	} else {
		onchain = readOnchainLiquidity(runtime, pair, ctx.budget, ctx.feeds)
		if (onchain) {
			runtime.log(
				`On-chain ${cfg.liquidity.chainName} pair ${pair}: ${onchain.quoteSymbol} reserve=${onchain.quoteReserve} ` +
					`price=${onchain.quoteUsdPrice} => liquidity=$${Number(onchain.liquidityCents) / 100}`,
			)
		}
	}
	const drop = onchain ? dropBps(snap.liquidityBeforeCents, onchain.liquidityCents) : null
	const collapseConfirmed = drop !== null && snap.liquidityBeforeCents > 0n && drop >= cfg.collapseDropBps
	const wantAlert = snap.level >= 1

	const result: WatchResult = {
		caseId: snap.caseId,
		symbol: snap.symbol,
		level: snap.level,
		onchainLiquidityCents: onchain ? onchain.liquidityCents.toString() : null,
		snapshotLiquidityNowCents: snap.liquidityNowCents.toString(),
		liquidityBeforeCents: snap.liquidityBeforeCents.toString(),
		dropBps: drop,
		alert: wantAlert ? 'observe-only' : 'not-needed',
		collapse: collapseConfirmed ? 'observe-only' : drop === null ? 'unconfirmed' : 'not-needed',
		txs: [],
	}
	runtime.log(
		`Decision: alert=${wantAlert} collapse=${collapseConfirmed}` +
			(drop !== null ? ` (drop ${drop / 100}% vs threshold ${cfg.collapseDropBps / 100}%)` : ' (no on-chain figure)'),
	)

	// 3 + 4. Registry (skip writes entirely in observe-only mode)
	if (!ctx.registry) {
		runtime.log('registry.address is the zero address: observe-only mode, nothing written')
		return result
	}
	const known = readRegistryStatus(runtime, ctx.registry, snap.caseId as Hex, ctx.budget)
	runtime.log(`Registry already has: caseLevel=${known.level} trail=${known.trailHash} collapsed=${known.collapsed}`)

	if (wantAlert) {
		if (known.trailHash === snap.trailHash && known.level >= snap.level) {
			result.alert = 'already-recorded'
		} else {
			result.txs.push(writeToRegistry(runtime, ctx.registry, encodeAlertReport(snap), 'Alert'))
			result.alert = 'written'
		}
	}
	if (collapseConfirmed && onchain && drop !== null) {
		if (known.collapsed) {
			result.collapse = 'already-recorded'
		} else {
			const report = encodeCollapseReport(snap, snap.liquidityBeforeCents, onchain.liquidityCents, drop)
			result.txs.push(writeToRegistry(runtime, ctx.registry, report, 'Collapse'))
			result.collapse = 'written'
		}
	}
	return result
}

export function onCron(runtime: Runtime<Config>, payload?: CronPayload): string {
	const cfg = runtime.config
	const observeOnly = cfg.registry.address.toLowerCase() === zeroAddress
	const ctx: RunContext = {
		budget: { used: 0, limit: CHAIN_READ_LIMIT },
		feeds: new Map(),
		registry: observeOnly ? null : evmClientFor(cfg.registry.chainName),
	}

	// 1. Snapshot(s) (HTTP + consensus)
	const source = getSource(runtime)
	if (source.kind === 'one') return safeJson(watchCase(runtime, source.snap, ctx))

	const cap = cfg.maxCasesPerRun ?? DEFAULT_MAX_CASES
	const runIndex = runIndexOf(payload, cfg.rotateEveryMinutes ?? 10)
	const { picked, deferred } = pickCases(source.cases, cap, runIndex)
	runtime.log(
		`Watch list: ${source.cases.length} case(s) [${source.cases.map((c) => c.symbol).join(', ')}]; ` +
			`this run (turn ${runIndex}) takes ${picked.length}: ${picked.map((c) => c.symbol).join(', ') || 'none'}`,
	)
	const out: WatchListResult = {
		mode: 'list',
		listed: source.cases.length,
		runIndex,
		cases: [],
		deferred: deferred.map((c) => ({ caseId: c.caseId, symbol: c.symbol, reason: `waits its turn (at most ${cap} cases per run)` })),
		chainReads: 0,
		txs: [],
	}
	for (const snap of picked) {
		const need = worstCaseReads(runtime, snap, ctx)
		if (ctx.budget.used + need > ctx.budget.limit) {
			runtime.log(`Deferring ${snap.symbol}: it may need ${need} more chain reads, and only ${ctx.budget.limit - ctx.budget.used} are left this run`)
			out.deferred.push({ caseId: snap.caseId, symbol: snap.symbol, reason: 'CRE chain-read limit for this run' })
			continue
		}
		const r = watchCase(runtime, snap, ctx)
		out.cases.push(r)
		out.txs.push(...r.txs)
	}
	out.chainReads = ctx.budget.used
	return safeJson(out)
}

// ───────────────────────────── Init ─────────────────────────────

export function initWorkflow(config: Config) {
	const cron = new cre.capabilities.CronCapability()
	return [cre.handler(cron.trigger({ schedule: config.schedule }), onCron)]
}
