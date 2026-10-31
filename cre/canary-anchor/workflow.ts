/**
 * canary-anchor: the chain-of-custody record for every victim's claim (Chainlink CRE, EVM log trigger).
 *
 * Trigger: an EVM log trigger on Sepolia. It fires when CanaryRegistry emits
 *   ClaimAnchored(bytes32 indexed caseId, bytes32 indexed evidenceHash, bytes32 claimantRef, uint64 at)
 * which happens when the hotline's relayer anchors a victim's evidence file (anchorClaim), or when the
 * canary-claims workflow verifies a purchase and anchors the claim with it.
 *
 * Why it matters (evidence chain of custody): a claim is filed against one version of the agents' analysis.
 * The registry keeps only the LATEST reasoning-trail head per case, so a later alert overwrites it. This
 * workflow freezes, per claim, what the case looked like when the claim was filed, and adds a fact a contract
 * on Sepolia cannot read for itself: how much money was still in the token's trading pool on Ethereum
 * mainnet, at a named block. That is the "loss" context a regulator or court reads next to the claim.
 *
 *   1. EVM log trigger (Sepolia) - one ClaimAnchored log. The workflow re-checks that it came from the
 *              configured registry and has the right shape; a log removed by a reorg is ignored.
 *   2. EVM read (Sepolia, last finalized block when the trigger waits for finality) - getClaimCustody (already recorded? does this registry know
 *              report kind 4?), claimAnchoredAt (is the anchor final?), getCase (level, trail head, collapse,
 *              token), getClaimVerification (did canary-claims confirm the purchase?).
 *   3. EVM read (Ethereum mainnet, last finalized block, pinned by number) - the block header, the Uniswap V2
 *              factory's getPair(token, quote) to find the pool, token0 + getReserves, and the Chainlink USD
 *              feed for the quote token. Missing pieces are logged as gaps and written as 0, never guessed.
 *   4. EVM write (Sepolia) - a DON-signed claim-custody report (kind 4) to CanaryRegistry.onReport.
 *
 * Reads per run: at most 4 on Sepolia + 1 header + 4 getPair + 2 pair + 1 feed = 12, under CRE's 15.
 * The report never contains personal data: only the hashes the registry already holds, plus public numbers.
 */
import {
	bytesToHex,
	cre,
	encodeCallMsg,
	type EVMLog,
	getNetwork,
	LAST_FINALIZED_BLOCK_NUMBER,
	LATEST_BLOCK_NUMBER,
	logTriggerConfig,
	prepareReportRequest,
	protoBigIntToBigint,
	type Runtime,
	TxStatus,
	blockNumber as toBlockNumber,
} from '@chainlink/cre-sdk'
import {
	type Address,
	decodeAbiParameters,
	decodeFunctionResult,
	encodeAbiParameters,
	encodeFunctionData,
	type Hex,
	zeroAddress,
	zeroHash,
} from 'viem'
import { z } from 'zod'
import {
	AggregatorV3,
	CanaryRegistry,
	CLAIM_ANCHORED_TOPIC,
	ClaimAnchoredDataParams,
	ClaimCustodyBodyParams,
	REPORT_CLAIM_CUSTODY,
	ReportEnvelopeParams,
	UniswapV2Factory,
	UniswapV2Pair,
} from './abi'

// ───────────────────────────── Config ─────────────────────────────

const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 0x EVM address')

const quoteTokenSchema = z.object({
	symbol: z.string(),
	address: evmAddress,
	decimals: z.number().int().min(0).max(36),
	// Chainlink USD feed for this token on the liquidity chain; "" means the token is a $1 stablecoin.
	usdFeed: z.union([evmAddress, z.literal('')]),
	feedDecimals: z.number().int().min(0).max(36),
})

export const configSchema = z.object({
	registry: z.object({
		chainName: z.string(), // "ethereum-testnet-sepolia"
		// The CanaryRegistry whose ClaimAnchored events start this workflow (and that receives the reports).
		address: evmAddress.refine((a) => a.toLowerCase() !== zeroAddress, 'the log trigger needs a real registry address'),
		gasLimit: z.string(),
		// How final a log must be before the trigger fires. FINALIZED is right for evidence: no reorg can undo it.
		confidence: z.enum(['SAFE', 'LATEST', 'FINALIZED']),
	}),
	liquidity: z.object({
		chainName: z.string(), // "ethereum-mainnet"
		uniswapV2Factory: evmAddress, // finds the token's pool: getPair(token, quote)
		quoteTokens: z.array(quoteTokenSchema).min(1).max(4), // tried in order: WETH, USDC, USDT, DAI
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
type BlockRef = typeof LAST_FINALIZED_BLOCK_NUMBER | ReturnType<typeof toBlockNumber>

/** Sepolia reads use the same finality as the trigger: a FINALIZED log is read at the finalized block. */
const registryBlock = (cfg: Config): BlockRef =>
	cfg.registry.confidence === 'FINALIZED' ? LAST_FINALIZED_BLOCK_NUMBER : LATEST_BLOCK_NUMBER

function readView(runtime: Runtime<Config>, client: EvmClient, to: Address, data: Hex, block: BlockRef): Hex {
	const reply = client
		.callContract(runtime, { call: encodeCallMsg({ from: zeroAddress, to, data }), blockNumber: block })
		.result()
	return bytesToHex(reply.data)
}

// ───────────────────── Step 1: the trigger's log ─────────────────────

export type AnchoredClaim = {
	caseId: Hex
	evidenceHash: Hex
	claimantRef: Hex
	anchoredAt: bigint // the registry's timestamp in the event
	anchorTx: Hex
	anchorBlock: bigint
}

/** Decode and check a ClaimAnchored log. Throws on anything that isn't one from the configured registry. */
export function decodeAnchorLog(log: EVMLog, registry: string): AnchoredClaim {
	const from = bytesToHex(log.address).toLowerCase()
	if (from !== registry.toLowerCase()) throw new Error(`Log came from ${from}, not the registry ${registry}`)
	const topics = log.topics.map((t) => bytesToHex(t).toLowerCase())
	if (topics.length !== 3 || topics[0] !== CLAIM_ANCHORED_TOPIC.toLowerCase())
		throw new Error('Log is not ClaimAnchored(bytes32,bytes32,bytes32,uint64)')
	const [claimantRef, anchoredAt] = decodeAbiParameters(ClaimAnchoredDataParams, bytesToHex(log.data))
	if (!log.blockNumber) throw new Error('Log has no block number')
	return {
		caseId: topics[1] as Hex,
		evidenceHash: topics[2] as Hex,
		claimantRef: claimantRef.toLowerCase() as Hex,
		anchoredAt,
		anchorTx: bytesToHex(log.txHash).toLowerCase() as Hex,
		anchorBlock: protoBigIntToBigint(log.blockNumber),
	}
}

// ───────────────────── Step 2: what the registry says (Sepolia) ─────────────────────

export type CaseAtFiling = {
	symbol: string
	token: Address
	level: number
	trailHash: Hex
	collapsed: boolean
	verifiedPurchases: number
}

/** null = this registry has no getClaimCustody (deployed before report kind 4). */
function readCustodyAt(runtime: Runtime<Config>, client: EvmClient, c: AnchoredClaim): bigint | null {
	try {
		const data = readView(
			runtime,
			client,
			runtime.config.registry.address as Address,
			encodeFunctionData({ abi: CanaryRegistry, functionName: 'getClaimCustody', args: [c.caseId, c.evidenceHash] }),
			registryBlock(runtime.config),
		)
		if (data === '0x') return null
		const k = decodeFunctionResult({ abi: CanaryRegistry, functionName: 'getClaimCustody', data }) as { at: bigint }
		return k.at
	} catch {
		return null
	}
}

function readCaseAtFiling(runtime: Runtime<Config>, client: EvmClient, c: AnchoredClaim): CaseAtFiling {
	const reg = runtime.config.registry.address as Address
	const at = registryBlock(runtime.config)
	const kase = decodeFunctionResult({
		abi: CanaryRegistry,
		functionName: 'getCase',
		data: readView(runtime, client, reg, encodeFunctionData({ abi: CanaryRegistry, functionName: 'getCase', args: [c.caseId] }), at),
	}) as { symbol: string; token: Address; level: number; trailHash: Hex; collapsedAt: bigint }
	const v = decodeFunctionResult({
		abi: CanaryRegistry,
		functionName: 'getClaimVerification',
		data: readView(
			runtime,
			client,
			reg,
			encodeFunctionData({ abi: CanaryRegistry, functionName: 'getClaimVerification', args: [c.caseId, c.evidenceHash] }),
			at,
		),
	}) as { purchases: number }
	return {
		symbol: kase.symbol,
		token: kase.token,
		level: Number(kase.level),
		trailHash: kase.trailHash.toLowerCase() as Hex,
		collapsed: kase.collapsedAt !== 0n,
		verifiedPurchases: Number(v.purchases),
	}
}

// ───────────────────── Step 3: the pool on Ethereum mainnet ─────────────────────

export type PoolReading = {
	mainnetBlock: bigint
	pair: Address
	quoteSymbol: string
	quoteReserve: bigint
	quoteUsdPrice: bigint // scaled by feedDecimals
	liquidityCents: bigint // 2 x quote side, in US cents (a V2 pool holds equal value on both sides)
}

/** Reads the token's pool at mainnet's last finalized block (pinned by number, so every read is the same block). */
export function readPoolAtFiling(runtime: Runtime<Config>, token: Address, gaps: string[]): PoolReading | null {
	const cfg = runtime.config.liquidity
	const client = evmClientFor(cfg.chainName)
	const header = client.headerByNumber(runtime, { blockNumber: LAST_FINALIZED_BLOCK_NUMBER }).result().header
	if (!header?.blockNumber) {
		gaps.push(`${cfg.chainName} returned no finalized block header`)
		return null
	}
	const mainnetBlock = protoBigIntToBigint(header.blockNumber)
	const at = toBlockNumber(mainnetBlock)

	for (const quote of cfg.quoteTokens) {
		const pair = decodeFunctionResult({
			abi: UniswapV2Factory,
			functionName: 'getPair',
			data: readView(
				runtime,
				client,
				cfg.uniswapV2Factory as Address,
				encodeFunctionData({ abi: UniswapV2Factory, functionName: 'getPair', args: [token, quote.address as Address] }),
				at,
			),
		}) as Address
		if (pair.toLowerCase() === zeroAddress) continue

		const token0 = decodeFunctionResult({
			abi: UniswapV2Pair,
			functionName: 'token0',
			data: readView(runtime, client, pair, encodeFunctionData({ abi: UniswapV2Pair, functionName: 'token0' }), at),
		}) as Address
		const [reserve0, reserve1] = decodeFunctionResult({
			abi: UniswapV2Pair,
			functionName: 'getReserves',
			data: readView(runtime, client, pair, encodeFunctionData({ abi: UniswapV2Pair, functionName: 'getReserves' }), at),
		}) as readonly [bigint, bigint, number]
		const quoteReserve = token0.toLowerCase() === quote.address.toLowerCase() ? reserve0 : reserve1

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
					at,
				),
			}) as readonly [bigint, bigint, bigint, bigint, bigint]
			price = round[1]
			if (price <= 0n) {
				gaps.push(`Chainlink feed ${quote.usdFeed} returned a non-positive price`)
				return null
			}
		}
		const liquidityCents =
			(2n * quoteReserve * price * 100n) / (10n ** BigInt(quote.decimals) * 10n ** BigInt(quote.feedDecimals))
		return { mainnetBlock, pair, quoteSymbol: quote.symbol, quoteReserve, quoteUsdPrice: price, liquidityCents }
	}
	gaps.push(`no Uniswap V2 pool for ${token} against ${cfg.quoteTokens.map((q) => q.symbol).join(', ')} on ${cfg.chainName}`)
	return null
}

// ───────────────────── Step 4: the report ─────────────────────

export function encodeCustodyReport(c: AnchoredClaim, k: CaseAtFiling, pool: PoolReading | null): Hex {
	const body = encodeAbiParameters(ClaimCustodyBodyParams, [
		c.caseId,
		c.evidenceHash,
		c.anchorTx,
		c.anchorBlock,
		k.level,
		k.trailHash,
		k.collapsed,
		k.verifiedPurchases,
		pool ? pool.liquidityCents : 0n,
		pool ? pool.mainnetBlock : 0n,
	])
	return encodeAbiParameters(ReportEnvelopeParams, [REPORT_CLAIM_CUSTODY, body])
}

// ───────────────────────────── Handler ─────────────────────────────

export type CustodyResult = {
	caseId: string
	evidenceHash: string
	anchorTx: string
	anchorBlock: string
	status: 'written' | 'already-recorded' | 'not-final' | 'observe-only' | 'ignored-removed-log'
	level: number | null
	trailHash: string | null
	collapsed: boolean | null
	verifiedPurchases: number | null
	pool: { pair: string; quote: string; liquidityCents: string; mainnetBlock: string } | null
	gaps: string[]
	txs: string[]
}

export function onClaimAnchored(runtime: Runtime<Config>, log: EVMLog): string {
	const cfg = runtime.config
	const claim = decodeAnchorLog(log, cfg.registry.address)
	const result: CustodyResult = {
		caseId: claim.caseId,
		evidenceHash: claim.evidenceHash,
		anchorTx: claim.anchorTx,
		anchorBlock: claim.anchorBlock.toString(),
		status: 'observe-only',
		level: null,
		trailHash: null,
		collapsed: null,
		verifiedPurchases: null,
		pool: null,
		gaps: [],
		txs: [],
	}
	runtime.log(
		`ClaimAnchored case=${claim.caseId} evidence=${claim.evidenceHash} tx=${claim.anchorTx} block=${claim.anchorBlock}`,
	)
	if (log.removed) {
		runtime.log('The log was removed by a chain reorganisation; nothing to record')
		result.status = 'ignored-removed-log'
		return safeJson(result)
	}

	// 2. Sepolia: already recorded? anchor final? the case as it stands.
	const sepolia = evmClientFor(cfg.registry.chainName)
	const custodyAt = readCustodyAt(runtime, sepolia, claim)
	if (custodyAt !== null && custodyAt !== 0n) {
		runtime.log(`Custody already recorded for this claim at ${custodyAt}; nothing new to write`)
		result.status = 'already-recorded'
		return safeJson(result)
	}
	const anchoredAt = decodeFunctionResult({
		abi: CanaryRegistry,
		functionName: 'claimAnchoredAt',
		data: readView(
			runtime,
			sepolia,
			cfg.registry.address as Address,
			encodeFunctionData({ abi: CanaryRegistry, functionName: 'claimAnchoredAt', args: [claim.caseId, claim.evidenceHash] }),
			registryBlock(cfg),
		),
	}) as bigint
	if (anchoredAt === 0n) {
		// The registry would refuse the report (ClaimNotAnchored). With confidence FINALIZED this should not happen.
		runtime.log('The registry does not show this anchor at the block read; not recording custody for a claim that is not final')
		result.status = 'not-final'
		return safeJson(result)
	}
	const k = readCaseAtFiling(runtime, sepolia, claim)
	result.level = k.level
	result.trailHash = k.trailHash
	result.collapsed = k.collapsed
	result.verifiedPurchases = k.verifiedPurchases
	if (k.level === 0) result.gaps.push('the case had no alert on record when this claim was filed')
	if (k.trailHash === zeroHash) result.gaps.push('no reasoning-trail head on record for this case')
	runtime.log(
		`Case at filing: ${k.symbol || '(no symbol)'} caseLevel=${k.level} trail=${k.trailHash} collapsed=${k.collapsed} verifiedPurchases=${k.verifiedPurchases}`,
	)

	// 3. Ethereum mainnet: the pool at a named, finalized block.
	let pool: PoolReading | null = null
	if (k.token.toLowerCase() === zeroAddress) {
		result.gaps.push('the case has no EVM token on record, so no pool was read')
	} else {
		pool = readPoolAtFiling(runtime, k.token, result.gaps)
	}
	if (pool) {
		result.pool = {
			pair: pool.pair,
			quote: pool.quoteSymbol,
			liquidityCents: pool.liquidityCents.toString(),
			mainnetBlock: pool.mainnetBlock.toString(),
		}
		runtime.log(
			`Pool at filing: ${cfg.liquidity.chainName} block ${pool.mainnetBlock} pair ${pool.pair}: ${pool.quoteSymbol} reserve=${pool.quoteReserve} ` +
				`price=${pool.quoteUsdPrice} => liquidity=$${Number(pool.liquidityCents) / 100}`,
		)
	}
	for (const g of result.gaps) runtime.log(`Gap: ${g}`)

	// 4. The report.
	const report = encodeCustodyReport(claim, k, pool)
	if (custodyAt === null) {
		runtime.log(
			'This registry has no getClaimCustody (deployed before report kind 4): observe-only, nothing written. Redeploy it with npm run chain:setup to record custody.',
		)
		result.status = 'observe-only'
		return safeJson(result)
	}
	const signed = runtime.report(prepareReportRequest(report)).result()
	const w = sepolia
		.writeReport(runtime, { receiver: cfg.registry.address, report: signed, gasConfig: { gasLimit: cfg.registry.gasLimit } })
		.result()
	if (w.txStatus !== TxStatus.SUCCESS) throw new Error(`Claim custody write failed: ${w.errorMessage || `txStatus ${w.txStatus}`}`)
	const txHash = bytesToHex(w.txHash ?? new Uint8Array(32))
	runtime.log(`Claim custody written to CanaryRegistry, tx ${txHash}`)
	result.status = 'written'
	result.txs.push(txHash)
	return safeJson(result)
}

// ───────────────────────────── Init ─────────────────────────────

export function initWorkflow(config: Config) {
	const network = getNetwork({ chainFamily: 'evm', chainSelectorName: config.registry.chainName })
	if (!network) throw new Error(`Unknown chain name: ${config.registry.chainName}`)
	const evm = new cre.capabilities.EVMClient(network.chainSelector.selector)
	const trigger = evm.logTrigger(
		logTriggerConfig({
			addresses: [config.registry.address as Hex],
			topics: [[CLAIM_ANCHORED_TOPIC]],
			confidence: config.registry.confidence,
		}),
	)
	return [cre.handler(trigger, onClaimAnchored)]
}
