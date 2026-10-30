/**
 * canary-watch: the Chainlink CRE workflow behind Canary.
 *
 * Every 10 minutes (cron trigger):
 *   1. HTTP  - fetch Canary's current case snapshot from the Canary app (/api/watch/snapshot).
 *              Every DON node fetches it; the nodes must agree (consensus) before anything is used.
 *   2. EVM read (Ethereum mainnet) - read the token's Uniswap V2 pool reserves and the Chainlink
 *              ETH/USD feed, so the "liquidity was pulled" claim is checked on-chain, independently of
 *              Canary's own numbers.
 *   3. EVM read (Sepolia) - ask CanaryRegistry what it already knows, so we don't re-send old news.
 *   4. EVM write (Sepolia) - signed reports to CanaryRegistry.onReport:
 *        alert    when the agents rate the case level >= 1
 *        collapse when on-chain liquidity is down >= 80% from the snapshot's "before" figure
 */
import {
	bytesToHex,
	ConsensusAggregationByFields,
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
	// URL of the Canary snapshot API. Empty string => use `fixtureSnapshot` instead (offline demo/testing).
	snapshotUrl: z.string(),
	fixtureSnapshot: snapshotSchema.optional(),
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

// ───────────────────────────── Helpers ─────────────────────────────

const safeJson = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x))

function evmClientFor(chainName: string) {
	const network = getNetwork({ chainFamily: 'evm', chainSelectorName: chainName })
	if (!network) throw new Error(`Unknown chain name: ${chainName}`)
	return new cre.capabilities.EVMClient(network.chainSelector.selector)
}

type EvmClient = ReturnType<typeof evmClientFor>

function readView(runtime: Runtime<Config>, client: EvmClient, to: Address, data: Hex): Hex {
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
type SnapshotObservation = {
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

/** Runs on each node (node mode). */
export const fetchSnapshot = (sendRequester: HTTPSendRequester, config: Config): SnapshotObservation => {
	const response = sendRequester
		.sendRequest({
			url: config.snapshotUrl,
			method: 'GET',
			headers: { accept: 'application/json' },
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

function getSnapshot(runtime: Runtime<Config>): SnapshotObservation {
	const cfg = runtime.config
	if (cfg.snapshotUrl === '') {
		if (!cfg.fixtureSnapshot) throw new Error('snapshotUrl is empty and no fixtureSnapshot is configured')
		runtime.log('Using fixtureSnapshot from config (snapshotUrl is empty)')
		return toObservation(cfg.fixtureSnapshot)
	}
	const http = new cre.capabilities.HTTPClient()
	return http.sendRequest(runtime, fetchSnapshot, snapshotAggregation)(cfg).result()
}

// ───────────────────── Step 2: on-chain liquidity (Ethereum mainnet) ─────────────────────

export type OnchainLiquidity = {
	pair: string
	quoteSymbol: string
	quoteReserve: bigint
	quoteUsdPrice: bigint // scaled by feedDecimals
	liquidityCents: bigint // 2 x quote side, in US cents (a V2 pool holds equal value on both sides)
}

export function readOnchainLiquidity(runtime: Runtime<Config>, pair: Address): OnchainLiquidity | null {
	const cfg = runtime.config.liquidity
	const client = evmClientFor(cfg.chainName)

	const token0 = decodeFunctionResult({
		abi: UniswapV2Pair,
		functionName: 'token0',
		data: readView(runtime, client, pair, encodeFunctionData({ abi: UniswapV2Pair, functionName: 'token0' })),
	}) as Address
	const token1 = decodeFunctionResult({
		abi: UniswapV2Pair,
		functionName: 'token1',
		data: readView(runtime, client, pair, encodeFunctionData({ abi: UniswapV2Pair, functionName: 'token1' })),
	}) as Address
	const [reserve0, reserve1] = decodeFunctionResult({
		abi: UniswapV2Pair,
		functionName: 'getReserves',
		data: readView(runtime, client, pair, encodeFunctionData({ abi: UniswapV2Pair, functionName: 'getReserves' })),
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
		const round = decodeFunctionResult({
			abi: AggregatorV3,
			functionName: 'latestRoundData',
			data: readView(
				runtime,
				client,
				quote.usdFeed as Address,
				encodeFunctionData({ abi: AggregatorV3, functionName: 'latestRoundData' }),
			),
		}) as readonly [bigint, bigint, bigint, bigint, bigint]
		price = round[1]
		if (price <= 0n) throw new Error(`Chainlink feed ${quote.usdFeed} returned a non-positive price`)
	}

	// cents = 2 * reserve / 10^decimals * price / 10^feedDecimals * 100
	const liquidityCents =
		(2n * quoteReserve * price * 100n) / (10n ** BigInt(quote.decimals) * 10n ** BigInt(quote.feedDecimals))

	return { pair, quoteSymbol: quote.symbol, quoteReserve, quoteUsdPrice: price, liquidityCents }
}

// ───────────────────── Step 3 + 4: registry read and report writes (Sepolia) ─────────────────────

type RegistryStatus = { level: number; trailHash: string; collapsed: boolean }

function readRegistryStatus(runtime: Runtime<Config>, client: EvmClient, caseId: Hex): RegistryStatus {
	const [level, trailHash, collapsed] = decodeFunctionResult({
		abi: CanaryRegistry,
		functionName: 'statusOf',
		data: readView(
			runtime,
			client,
			runtime.config.registry.address as Address,
			encodeFunctionData({ abi: CanaryRegistry, functionName: 'statusOf', args: [caseId] }),
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

export function onCron(runtime: Runtime<Config>, _payload?: CronPayload): string {
	const cfg = runtime.config

	// 1. Snapshot (HTTP + consensus)
	const snap = getSnapshot(runtime)
	runtime.log(
		`Snapshot case=${snap.caseId} ${snap.symbol} level=${snap.level} promoters=${snap.promoters} ` +
			`liquidityBefore=$${Number(snap.liquidityBeforeCents) / 100} liquidityNow(app)=$${Number(snap.liquidityNowCents) / 100}`,
	)

	// 2. Independent on-chain liquidity check
	const pair = (snap.pair !== '' ? snap.pair : cfg.liquidity.pairAddress) as Address | ''
	let onchain: OnchainLiquidity | null = null
	if (pair === '') {
		runtime.log('No Uniswap V2 pair configured for this case; skipping the on-chain liquidity check')
	} else {
		onchain = readOnchainLiquidity(runtime, pair)
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
	if (cfg.registry.address.toLowerCase() === zeroAddress) {
		runtime.log('registry.address is the zero address: observe-only mode, nothing written')
		return safeJson(result)
	}
	const registry = evmClientFor(cfg.registry.chainName)
	const known = readRegistryStatus(runtime, registry, snap.caseId as Hex)
	runtime.log(`Registry already has: level=${known.level} trail=${known.trailHash} collapsed=${known.collapsed}`)

	if (wantAlert) {
		if (known.trailHash === snap.trailHash && known.level >= snap.level) {
			result.alert = 'already-recorded'
		} else {
			result.txs.push(writeToRegistry(runtime, registry, encodeAlertReport(snap), 'Alert'))
			result.alert = 'written'
		}
	}
	if (collapseConfirmed && onchain && drop !== null) {
		if (known.collapsed) {
			result.collapse = 'already-recorded'
		} else {
			const report = encodeCollapseReport(snap, snap.liquidityBeforeCents, onchain.liquidityCents, drop)
			result.txs.push(writeToRegistry(runtime, registry, report, 'Collapse'))
			result.collapse = 'written'
		}
	}
	return safeJson(result)
}

// ───────────────────────────── Init ─────────────────────────────

export function initWorkflow(config: Config) {
	const cron = new cre.capabilities.CronCapability()
	return [cre.handler(cron.trigger({ schedule: config.schedule }), onCron)]
}
