/**
 * canary-claims: the Chainlink network confirms a victim's purchase before Canary records their claim.
 *
 * HTTP trigger: the Canary app (or the hotline) sends one claim:
 *   { caseId, wallet, evidenceHash, claimantRef, walletSalt?, purchaseBlocks: [mainnet block numbers] }
 * `purchaseBlocks` are hints: the blocks where the app's own archive-node search (src/lib/hotline/purchases.ts)
 * found the wallet's buys. The hints are not trusted. They only tell the DON where to look, because a CRE log
 * query may span at most 100 blocks (ChainRead.LogQueryBlockLimit) and the class period spans ~290,000.
 *
 *   1. EVM read (Ethereum mainnet): pair.token0(), to know which side of a Swap is the case's token.
 *   2. EVM read (Ethereum mainnet): filterLogs over each hinted window (<= 100 blocks, inside the class period),
 *      on the token and its pool, keeping only logs addressed to the wallet:
 *        Transfer(from = pool, to = wallet) on the token contract
 *        Swap(..., to = wallet) on the pool, in the same transaction, paying out the token
 *      A Transfer with a matching Swap is a purchase from the pool (a Transfer without a Swap would be, e.g.,
 *      liquidity being withdrawn, and does not count). Every node runs the same reads; the EVM capability's
 *      results are agreed by the DON before the workflow sees them.
 *   3. EVM read (Sepolia): CanaryRegistry.claimVerifiedAt(caseId, evidenceHash), so a claim is verified once.
 *   4. EVM write (Sepolia): a DON-signed report, kind 3 (claim verified) -> forwarder -> CanaryRegistry.onReport.
 *      The wallet never goes on-chain: only walletRef = keccak256(abi.encodePacked(walletSalt, wallet)).
 */
import {
	bytesToHex,
	cre,
	decodeJson,
	encodeCallMsg,
	getNetwork,
	hexToBase64,
	type HTTPPayload,
	LAST_FINALIZED_BLOCK_NUMBER,
	prepareReportRequest,
	protoBigIntToBigint,
	blockNumber as protoBlockNumber,
	type Runtime,
	TxStatus,
} from '@chainlink/cre-sdk'
import {
	type Address,
	decodeAbiParameters,
	decodeFunctionResult,
	encodeAbiParameters,
	encodeFunctionData,
	encodePacked,
	type Hex,
	keccak256,
	pad,
	zeroAddress,
	zeroHash,
} from 'viem'
import { z } from 'zod'
import {
	CanaryRegistry,
	ClaimVerifiedBodyParams,
	REPORT_CLAIM_VERIFIED,
	ReportEnvelopeParams,
	SWAP_TOPIC,
	SwapDataParams,
	TRANSFER_TOPIC,
	UniswapV2Pair,
} from './abi'

// ───────────────────────────── Config ─────────────────────────────

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'must be 0x + 32 bytes hex')
const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 0x EVM address')
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
const block = z.number().int().min(0)

/** One case whose victims can be verified: the token, its pool, and the class period as mainnet blocks. */
export const caseSchema = z.object({
	slug: z.string(),
	caseId: hex32, // keccak256("canary:<slug>"), as in src/lib/snapshot.ts
	symbol: z.string(),
	chainName: z.string(), // "ethereum-mainnet"
	token: evmAddress,
	pair: evmAddress, // Uniswap V2 pool the buys come from
	classPeriod: z.object({ from: day, to: day }), // UTC days, inclusive (for people)
	classStartBlock: block, // first block at/after classPeriod.from 00:00:00 UTC
	classEndBlock: block, // last block before (classPeriod.to + 1 day) 00:00:00 UTC
	pairCreatedBlock: block, // no buys from the pool can exist before this
})
export type CaseConfig = z.infer<typeof caseSchema>

export const configSchema = z.object({
	// EVM addresses whose signed requests may fire the HTTP trigger. Empty = open (only allowed in simulation;
	// `cre workflow deploy` needs at least one).
	authorizedEvmAddresses: z.array(evmAddress),
	cases: z.array(caseSchema).min(1),
	// CRE quota PerWorkflow.ChainRead.LogQueryBlockLimit: a log query may span at most 100 blocks.
	logQueryBlockLimit: z.number().int().min(1).max(100),
	// Log queries per claim. CRE allows 15 EVM reads per execution: 1 token0 + N log queries + 1 registry read.
	maxLogQueries: z.number().int().min(1).max(13),
	registry: z.object({
		chainName: z.string(), // "ethereum-testnet-sepolia"
		// CanaryRegistry address. Zero address => "observe only": verify and log, but write nothing.
		address: evmAddress,
		gasLimit: z.string(),
	}),
})
export type Config = z.infer<typeof configSchema>

/** The JSON body the app sends to the HTTP trigger (also what `--http-payload` takes). */
export const claimSchema = z.object({
	caseId: hex32,
	wallet: evmAddress,
	evidenceHash: hex32, // SHA-256 of the claim pack
	claimantRef: hex32, // salted claimant hash (no personal data)
	walletSalt: hex32.optional(), // salt for walletRef; omitted = zero salt (linkable to the wallet by anyone who guesses it)
	purchaseBlocks: z.array(block).max(200), // hints: mainnet blocks of the wallet's buys
})
export type Claim = z.infer<typeof claimSchema>

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

/** walletRef = keccak256(abi.encodePacked(bytes32 walletSalt, address wallet)). */
export const walletRefOf = (wallet: string, salt: string = zeroHash): Hex =>
	keccak256(encodePacked(['bytes32', 'address'], [salt as Hex, wallet as Address]))

/** The blocks a case's buys can be in: the class period, but not before the pool existed. */
export const scanRange = (c: CaseConfig) => ({
	from: Math.max(c.classStartBlock, c.pairCreatedBlock),
	to: c.classEndBlock,
})

export type Window = { fromBlock: number; toBlock: number; hints: number[] }

/**
 * Groups hinted blocks into log-query windows of at most `limit` blocks (inclusive), keeping only hints inside
 * [from, to]. At most `maxWindows` windows; hints that would need more are dropped (reported, never silently).
 */
export function planWindows(hints: number[], range: { from: number; to: number }, limit: number, maxWindows: number) {
	const unique = [...new Set(hints)].sort((a, b) => a - b)
	const inside = unique.filter((b) => b >= range.from && b <= range.to)
	const windows: Window[] = []
	let dropped = 0
	for (const b of inside) {
		const last = windows[windows.length - 1]
		if (last && b - last.fromBlock + 1 <= limit) {
			last.toBlock = b
			last.hints.push(b)
		} else if (windows.length < maxWindows) {
			windows.push({ fromBlock: b, toBlock: b, hints: [b] })
		} else {
			dropped++
		}
	}
	return { windows, given: hints.length, unique: unique.length, outside: unique.length - inside.length, dropped }
}

type RawLog = { address: string; topics: string[]; data: Hex; txHash: string; block: number; index: number }

/** Reads one window's logs: Transfers and Swaps addressed to the wallet, on the token and its pool. */
function readWindow(runtime: Runtime<Config>, client: EvmClient, c: CaseConfig, wallet: string, w: Window): RawLog[] {
	const reply = client
		.filterLogs(runtime, {
			filterQuery: {
				fromBlock: protoBlockNumber(w.fromBlock),
				toBlock: protoBlockNumber(w.toBlock),
				addresses: [hexToBase64(c.token), hexToBase64(c.pair)],
				topics: [
					{ topic: [hexToBase64(TRANSFER_TOPIC), hexToBase64(SWAP_TOPIC)] }, // event
					{ topic: [] }, // Transfer.from / Swap.sender: any (checked below)
					{ topic: [hexToBase64(pad(wallet as Hex))] }, // Transfer.to / Swap.to: the wallet
				],
			},
		})
		.result()
	return reply.logs
		.filter((l) => !l.removed)
		.map((l) => ({
			address: bytesToHex(l.address).toLowerCase(),
			topics: l.topics.map((t) => bytesToHex(t).toLowerCase()),
			data: bytesToHex(l.data),
			txHash: bytesToHex(l.txHash).toLowerCase(),
			block: l.blockNumber ? Number(protoBigIntToBigint(l.blockNumber)) : -1,
			index: l.index,
		}))
}

export type VerifiedBuy = { block: number; txHash: string; logIndex: number; amount: string }

/**
 * The verification rule, as a pure function: a purchase is a token Transfer(from = pool, to = wallet) with a
 * pool Swap(to = wallet) in the same transaction that pays out the token, inside the scanned window.
 */
export function matchBuys(
	logs: RawLog[],
	c: CaseConfig,
	wallet: string,
	tokenIsToken0: boolean,
	window: { fromBlock: number; toBlock: number },
): VerifiedBuy[] {
	const token = c.token.toLowerCase()
	const pair = c.pair.toLowerCase()
	const W = pad(wallet.toLowerCase() as Hex)
	const P = pad(pair as Hex)
	const swapTxs = new Set(
		logs
			.filter((l) => l.address === pair && l.topics[0] === SWAP_TOPIC && l.topics[2] === W)
			.filter((l) => {
				const [, , amount0Out, amount1Out] = decodeAbiParameters(SwapDataParams, l.data)
				return (tokenIsToken0 ? amount0Out : amount1Out) > 0n
			})
			.map((l) => l.txHash),
	)
	return logs
		.filter(
			(l) =>
				l.address === token &&
				l.topics[0] === TRANSFER_TOPIC &&
				l.topics[1] === P &&
				l.topics[2] === W &&
				l.block >= window.fromBlock &&
				l.block <= window.toBlock &&
				swapTxs.has(l.txHash),
		)
		.map((l) => ({ block: l.block, txHash: l.txHash, logIndex: l.index, amount: BigInt(l.data).toString() }))
}

export function encodeClaimVerifiedReport(
	claim: Pick<Claim, 'caseId' | 'evidenceHash' | 'claimantRef'>,
	walletRef: Hex,
	purchases: number,
	firstBuyBlock: number,
): Hex {
	const body = encodeAbiParameters(ClaimVerifiedBodyParams, [
		claim.caseId as Hex,
		claim.evidenceHash as Hex,
		claim.claimantRef as Hex,
		walletRef,
		purchases,
		BigInt(firstBuyBlock),
	])
	return encodeAbiParameters(ReportEnvelopeParams, [REPORT_CLAIM_VERIFIED, body])
}

// ───────────────────────────── Handler ─────────────────────────────

export type ClaimResult = {
	status: 'verified' | 'not-verified' | 'rejected'
	reason?: string
	caseId?: string
	case?: string
	evidenceHash?: string
	walletRef?: string
	purchases: number
	firstBuyBlock: number | null
	buys: VerifiedBuy[]
	scanned: { fromBlock: number; toBlock: number }[]
	hints: { given: number; unique: number; outside: number; dropped: number } | null
	write: 'written' | 'already-recorded' | 'observe-only' | 'not-needed'
	txHash?: string
}

const rejected = (reason: string): ClaimResult => ({
	status: 'rejected',
	reason,
	purchases: 0,
	firstBuyBlock: null,
	buys: [],
	scanned: [],
	hints: null,
	write: 'not-needed',
})

export function verifyClaim(runtime: Runtime<Config>, raw: unknown): ClaimResult {
	const cfg = runtime.config
	const parsed = claimSchema.safeParse(raw)
	if (!parsed.success) return rejected(`Claim JSON is not in the expected shape: ${parsed.error.issues[0]?.message}`)
	const claim = {
		...parsed.data,
		caseId: parsed.data.caseId.toLowerCase(),
		wallet: parsed.data.wallet.toLowerCase(),
		evidenceHash: parsed.data.evidenceHash.toLowerCase(),
		claimantRef: parsed.data.claimantRef.toLowerCase(),
	}
	if (/^0x0+$/.test(claim.caseId) || /^0x0+$/.test(claim.evidenceHash)) return rejected('caseId and evidenceHash must be non-zero')
	const c = cfg.cases.find((k) => k.caseId.toLowerCase() === claim.caseId)
	if (!c) return rejected(`Unknown caseId ${claim.caseId}`)

	const walletRef = walletRefOf(claim.wallet, claim.walletSalt ?? zeroHash)
	const range = scanRange(c)
	const plan = planWindows(claim.purchaseBlocks, range, cfg.logQueryBlockLimit, cfg.maxLogQueries)
	runtime.log(
		`Claim for ${c.symbol} (${c.slug}) walletRef=${walletRef} hints=${plan.given} inside=${plan.unique - plan.outside} ` +
			`outside=${plan.outside} dropped=${plan.dropped}; class period ${c.classPeriod.from}..${c.classPeriod.to} = blocks ${range.from}..${range.to}`,
	)

	const result: ClaimResult = {
		status: 'not-verified',
		caseId: claim.caseId,
		case: c.slug,
		evidenceHash: claim.evidenceHash,
		walletRef,
		purchases: 0,
		firstBuyBlock: null,
		buys: [],
		scanned: plan.windows.map((w) => ({ fromBlock: w.fromBlock, toBlock: w.toBlock })),
		hints: { given: plan.given, unique: plan.unique, outside: plan.outside, dropped: plan.dropped },
		write: 'not-needed',
	}
	if (plan.windows.length === 0) {
		result.reason = 'No purchase block inside the class period was given, so there was nothing to check'
		runtime.log(result.reason)
		return result
	}

	// 1 + 2. Mainnet reads
	const mainnet = evmClientFor(c.chainName)
	const token0 = decodeFunctionResult({
		abi: UniswapV2Pair,
		functionName: 'token0',
		data: readView(runtime, mainnet, c.pair as Address, encodeFunctionData({ abi: UniswapV2Pair, functionName: 'token0' })),
	}) as Address
	const tokenIsToken0 = token0.toLowerCase() === c.token.toLowerCase()
	const seen = new Set<string>()
	for (const w of plan.windows) {
		const logs = readWindow(runtime, mainnet, c, claim.wallet, w)
		const buys = matchBuys(logs, c, claim.wallet, tokenIsToken0, w)
		runtime.log(`Blocks ${w.fromBlock}..${w.toBlock}: ${logs.length} logs to the wallet, ${buys.length} confirmed buys`)
		for (const b of buys) {
			const key = `${b.txHash}:${b.logIndex}`
			if (!seen.has(key)) {
				seen.add(key)
				result.buys.push(b)
			}
		}
	}
	result.buys.sort((a, b) => a.block - b.block || a.logIndex - b.logIndex)
	result.purchases = result.buys.length
	result.firstBuyBlock = result.buys[0]?.block ?? null
	if (result.purchases === 0) {
		result.reason = 'None of the given blocks has a buy of the token from its pool by this wallet'
		runtime.log(result.reason)
		return result
	}
	result.status = 'verified'
	runtime.log(`Verified: ${result.purchases} buys from the pool in the class period, first at block ${result.firstBuyBlock}`)

	// 3 + 4. Registry
	if (cfg.registry.address.toLowerCase() === zeroAddress) {
		result.write = 'observe-only'
		runtime.log('registry.address is the zero address: observe-only mode, nothing written')
		return result
	}
	const registry = evmClientFor(cfg.registry.chainName)
	const at = decodeFunctionResult({
		abi: CanaryRegistry,
		functionName: 'claimVerifiedAt',
		data: readView(
			runtime,
			registry,
			cfg.registry.address as Address,
			encodeFunctionData({
				abi: CanaryRegistry,
				functionName: 'claimVerifiedAt',
				args: [claim.caseId as Hex, claim.evidenceHash as Hex],
			}),
		),
	}) as bigint
	if (at > 0n) {
		result.write = 'already-recorded'
		runtime.log(`CanaryRegistry already has this claim verified (at ${at})`)
		return result
	}
	const reportHex = encodeClaimVerifiedReport(claim, walletRef, result.purchases, result.firstBuyBlock as number)
	// Consensus: the DON signs the report; the forwarder verifies the signatures on-chain.
	const report = runtime.report(prepareReportRequest(reportHex)).result()
	const tx = registry
		.writeReport(runtime, {
			receiver: cfg.registry.address,
			report,
			gasConfig: { gasLimit: cfg.registry.gasLimit },
		})
		.result()
	if (tx.txStatus !== TxStatus.SUCCESS) {
		throw new Error(`Claim-verified write failed: ${tx.errorMessage || `txStatus ${tx.txStatus}`}`)
	}
	result.txHash = bytesToHex(tx.txHash ?? new Uint8Array(32))
	result.write = 'written'
	runtime.log(`Claim verification written to CanaryRegistry, tx ${result.txHash}`)
	return result
}

export function onHttpTrigger(runtime: Runtime<Config>, payload: HTTPPayload): string {
	if (!payload.input || payload.input.length === 0) return safeJson(rejected('Empty request body'))
	let raw: unknown
	try {
		raw = decodeJson(payload.input)
	} catch {
		return safeJson(rejected('Request body is not JSON'))
	}
	return safeJson(verifyClaim(runtime, raw))
}

// ───────────────────────────── Init ─────────────────────────────

export function initWorkflow(config: Config) {
	const http = new cre.capabilities.HTTPCapability()
	const trigger = http.trigger({
		authorizedKeys: config.authorizedEvmAddresses.map((publicKey) => ({
			type: 'KEY_TYPE_ECDSA_EVM' as const,
			publicKey,
		})),
	})
	return [cre.handler(trigger, onHttpTrigger)]
}
