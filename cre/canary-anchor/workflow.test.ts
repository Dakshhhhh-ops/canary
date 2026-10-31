// Unit tests for canary-anchor, using the CRE SDK test runtime (no WASM, no login, no network).
//   bun test
// The data is real: fixtures/claim-anchored.emax-demo.json holds the ClaimAnchored log of the hotline's demo
// claim on Sepolia (eth_getTransactionReceipt), CanaryRegistry's state for it at Sepolia's finalized block, and
// the EMAX/WETH Uniswap V2 pool + Chainlink ETH/USD at Ethereum mainnet's finalized block (eth_call). The mocked
// EVM capability serves those replies.
// Also writes fixtures/reports.generated.json: the exact report bytes this workflow produced, which
// contracts/test/CanaryRegistry.test.mjs then feeds into the real contract (end-to-end ABI check).
import { describe, expect } from 'bun:test'
import { bigintToProtoBigInt, type EVMLog, getNetwork, hexToBase64 } from '@chainlink/cre-sdk'
import { addContractMock, EvmMock, newTestRuntime, test } from '@chainlink/cre-sdk/test'
import {
	type Address,
	bytesToHex,
	decodeAbiParameters,
	type Hex,
	hexToBytes,
	keccak256,
	toBytes,
	zeroAddress,
	zeroHash,
} from 'viem'
import {
	AggregatorV3,
	CanaryRegistry,
	CLAIM_ANCHORED_TOPIC,
	ClaimCustodyBodyParams,
	ReportEnvelopeParams,
	UniswapV2Factory,
	UniswapV2Pair,
} from './abi'
import localConfig from './config.local.json'
import productionConfig from './config.production.json'
import stagingConfig from './config.staging.json'
import fx from './fixtures/claim-anchored.emax-demo.json'
import { type Config, configSchema, type CustodyResult, decodeAnchorLog, initWorkflow, onClaimAnchored } from './workflow'

const MAINNET = getNetwork({ chainFamily: 'evm', chainSelectorName: 'ethereum-mainnet' })!.chainSelector.selector
const SEPOLIA = getNetwork({ chainFamily: 'evm', chainSelectorName: 'ethereum-testnet-sepolia' })!.chainSelector
	.selector
const REPORT_HEADER = 109 // REPORT_METADATA_HEADER_LENGTH in the SDK test runtime
const REGISTRY = fx.sepolia.registry as Address
const FACTORY = fx.mainnet.factory as Address
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address
const ETH_USD = fx.mainnet.ethUsdFeed as Address
const PAIR = fx.mainnet.pair as Address

const config: Config = configSchema.parse(stagingConfig)

/** The real log, in the shape the EVM log trigger delivers it. */
function realLog(over: Partial<{ address: string; topics: string[]; removed: boolean }> = {}): EVMLog {
	const l = fx.log
	return {
		address: hexToBytes((over.address ?? l.address) as Hex),
		topics: (over.topics ?? l.topics).map((t) => hexToBytes(t as Hex)),
		txHash: hexToBytes(l.transactionHash as Hex),
		blockHash: hexToBytes(l.blockHash as Hex),
		data: hexToBytes(l.data as Hex),
		eventSig: hexToBytes(l.topics[0] as Hex),
		blockNumber: { absVal: toBytes(BigInt(l.blockNumber)), sign: 1n },
		txIndex: l.transactionIndex,
		index: l.logIndex,
		removed: over.removed ?? l.removed,
	} as unknown as EVMLog
}

type CaseOver = Partial<{ token: Address; level: number; trailHash: Hex; collapsedAt: bigint }>

/** Wire up the mocks with the captured replies. Returns the captured report payloads and a read counter. */
function setup(
	opts: {
		custodyAt?: bigint | 'no-such-function'
		anchoredAt?: bigint
		kase?: CaseOver
		purchases?: number
		pairs?: Record<string, Address> // quote token -> pair the factory returns (default: the captured ones)
		writeFails?: boolean
	} = {},
) {
	let reads = 0
	const count =
		(f: (...a: readonly unknown[]) => unknown) =>
		(...a: readonly unknown[]) => {
			reads++
			return f(...a)
		}

	const sepolia = EvmMock.testInstance(SEPOLIA)
	const reg = addContractMock(sepolia, { address: REGISTRY, abi: CanaryRegistry })
	const s = fx.sepolia
	reg.getClaimCustody = count(() => {
		if (opts.custodyAt === 'no-such-function') throw new Error('execution reverted')
		return {
			anchorTx: zeroHash,
			anchorBlock: 0n,
			level: 0,
			trailHash: zeroHash,
			collapsed: false,
			verifiedPurchases: 0,
			poolLiquidityCents: 0n,
			mainnetBlock: 0n,
			at: opts.custodyAt ?? 0n,
		}
	})
	reg.claimAnchoredAt = count(() => opts.anchoredAt ?? BigInt(s.claimAnchoredAt))
	reg.getCase = count(() => ({
		symbol: s.getCase.symbol,
		token: (opts.kase?.token ?? s.getCase.token) as Address,
		level: opts.kase?.level ?? s.getCase.level,
		promoters: s.getCase.promoters,
		trailHash: (opts.kase?.trailHash ?? s.getCase.trailHash) as Hex,
		alertAt: BigInt(s.getCase.alertAt),
		liquidityBefore: BigInt(s.getCase.liquidityBefore),
		liquidityNow: BigInt(s.getCase.liquidityNow),
		dropBps: s.getCase.dropBps,
		collapsedAt: opts.kase?.collapsedAt ?? BigInt(s.getCase.collapsedAt),
		claimCount: s.getCase.claimCount,
	}))
	reg.getClaimVerification = count(() => ({
		claimantRef: s.getClaimVerification.claimantRef as Hex,
		walletRef: s.getClaimVerification.walletRef as Hex,
		purchases: opts.purchases ?? s.getClaimVerification.purchases,
		firstBuyBlock: BigInt(s.getClaimVerification.firstBuyBlock),
		at: BigInt(s.getClaimVerification.at),
	}))
	const written: Hex[] = []
	reg.writeReport = (input) => {
		written.push(bytesToHex(input.report.rawReport.slice(REPORT_HEADER)))
		if (opts.writeFails) return { txStatus: 'TX_STATUS_REVERTED', errorMessage: 'reverted' }
		return { txStatus: 'TX_STATUS_SUCCESS', txHash: Buffer.alloc(32, 7).toString('base64') }
	}

	const mainnet = EvmMock.testInstance(MAINNET)
	const m = fx.mainnet
	mainnet.headerByNumber = () => {
		reads++
		return {
			header: {
				timestamp: m.finalizedTimestamp,
				blockNumber: bigintToProtoBigInt(m.finalizedBlock),
				hash: hexToBase64(m.finalizedBlockHash),
			},
		}
	}
	const pairs = opts.pairs ?? (m.getPair as Record<string, Address>)
	const factory = addContractMock(mainnet, { address: FACTORY, abi: UniswapV2Factory })
	factory.getPair = count((_token, quote) => {
		const hit = Object.entries(pairs).find(([q]) => q.toLowerCase() === String(quote).toLowerCase())
		return hit ? hit[1] : zeroAddress
	})
	for (const p of new Set(Object.values(pairs).filter((x) => x.toLowerCase() !== zeroAddress))) {
		const pair = addContractMock(mainnet, { address: p, abi: UniswapV2Pair })
		pair.token0 = count(() => m.token0 as Address)
		pair.getReserves = count(() => [BigInt(m.reserves[0]), BigInt(m.reserves[1]), Number(m.reserves[2])])
	}
	const feed = addContractMock(mainnet, { address: ETH_USD, abi: AggregatorV3 })
	feed.latestRoundData = count(() => m.latestRoundData.map((x) => BigInt(x)) as never)
	return { written, reads: () => reads }
}

const run = (cfg: Config = config, log: EVMLog = realLog()) => {
	const runtime = newTestRuntime<Config>(null, {}, cfg)
	return { result: JSON.parse(onClaimAnchored(runtime as never, log)) as CustodyResult, logs: runtime.getLogs() }
}

const decodeReport = (hex: Hex) => {
	const [kind, body] = decodeAbiParameters(ReportEnvelopeParams, hex)
	const f = decodeAbiParameters(ClaimCustodyBodyParams, body)
	return {
		kind,
		caseId: f[0],
		evidenceHash: f[1],
		anchorTx: f[2],
		anchorBlock: f[3],
		level: f[4],
		trailHash: f[5],
		collapsed: f[6],
		verifiedPurchases: f[7],
		poolLiquidityCents: f[8],
		mainnetBlock: f[9],
	}
}

// 2 x WETH reserve x ETH/USD, in cents (the same formula canary-watch uses), from the captured replies
const EXPECTED_CENTS =
	(2n * BigInt(fx.mainnet.reserves[1]) * BigInt(fx.mainnet.latestRoundData[1]) * 100n) / (10n ** 18n * 10n ** 8n)

const generated: Record<string, unknown> = {}

describe('the ClaimAnchored log', () => {
	test('the event signature matches the topic the deployed registry really emitted', () => {
		expect(CLAIM_ANCHORED_TOPIC).toBe(fx.log.topics[0] as Hex)
	})

	test('decodes the real demo-claim log', () => {
		const c = decodeAnchorLog(realLog(), REGISTRY)
		expect(c.caseId).toBe(keccak256(toBytes('canary:emax')))
		expect(c.evidenceHash).toBe(fx.log.topics[2] as Hex)
		expect(c.claimantRef).toBe(fx.sepolia.getClaimVerification.claimantRef as Hex)
		expect(c.anchorTx).toBe(fx.log.transactionHash as Hex)
		expect(c.anchorBlock).toBe(BigInt(fx.log.blockNumber))
		expect(c.anchoredAt).toBe(BigInt(fx.sepolia.claimAnchoredAt))
	})

	test('refuses a log from another contract or of another event', () => {
		expect(() => decodeAnchorLog(realLog({ address: '0x000000000000000000000000000000000000dEaD' }), REGISTRY)).toThrow(
			/not the registry/,
		)
		const t = fx.log.topics
		expect(() => decodeAnchorLog(realLog({ topics: [keccak256(toBytes('Other()')), t[1], t[2]] }), REGISTRY)).toThrow(
			/not ClaimAnchored/,
		)
		expect(() => decodeAnchorLog(realLog({ topics: [t[0], t[1]] }), REGISTRY)).toThrow(/not ClaimAnchored/)
	})
})

describe('onClaimAnchored', () => {
	test('writes the chain-of-custody report: the case as filed + the mainnet pool at a named block', () => {
		const { written, reads } = setup()
		const { result, logs } = run()
		expect(result.status).toBe('written')
		expect(result.level).toBe(3)
		expect(result.trailHash).toBe(fx.sepolia.getCase.trailHash)
		expect(result.collapsed).toBe(true)
		expect(result.verifiedPurchases).toBe(5)
		expect(result.pool).toEqual({
			pair: PAIR,
			quote: 'WETH',
			liquidityCents: EXPECTED_CENTS.toString(),
			mainnetBlock: fx.mainnet.finalizedBlock,
		})
		expect(result.gaps).toEqual([])
		// about 13.17 WETH at ~$2,230: a little under $59,000 left in a pool that held $7.26M at the peak
		expect(Number(EXPECTED_CENTS) / 100).toBeGreaterThan(55_000)
		expect(Number(EXPECTED_CENTS) / 100).toBeLessThan(62_000)
		expect(written).toHaveLength(1)
		const r = decodeReport(written[0])
		expect(r.kind).toBe(4)
		expect(r.caseId).toBe(fx.log.topics[1] as Hex)
		expect(r.evidenceHash).toBe(fx.log.topics[2] as Hex)
		expect(r.anchorTx).toBe(fx.log.transactionHash as Hex)
		expect(r.anchorBlock).toBe(BigInt(fx.log.blockNumber))
		expect(r.trailHash).toBe(fx.sepolia.getCase.trailHash as Hex)
		expect(r.poolLiquidityCents).toBe(EXPECTED_CENTS)
		expect(r.mainnetBlock).toBe(BigInt(fx.mainnet.finalizedBlock))
		// 4 Sepolia reads + header + getPair(WETH) + token0 + getReserves + ETH/USD = 9, under CRE's 15
		expect(reads()).toBe(9)
		expect(logs.join('\n')).toContain('Claim custody written to CanaryRegistry, tx 0x')
		generated.custody = written[0]
		generated.expected = {
			caseId: r.caseId,
			evidenceHash: r.evidenceHash,
			claimantRef: fx.sepolia.getClaimVerification.claimantRef,
			anchorTx: r.anchorTx,
			anchorBlock: r.anchorBlock.toString(),
			level: r.level,
			trailHash: r.trailHash,
			collapsed: r.collapsed,
			verifiedPurchases: r.verifiedPurchases,
			poolLiquidityCents: r.poolLiquidityCents.toString(),
			mainnetBlock: r.mainnetBlock.toString(),
		}
	})

	test('a registry deployed before report kind 4 (the one on Sepolia today): observe-only, nothing written', () => {
		const { written } = setup({ custodyAt: 'no-such-function' })
		const { result, logs } = run()
		expect(result.status).toBe('observe-only')
		expect(result.pool?.liquidityCents).toBe(EXPECTED_CENTS.toString())
		expect(written).toHaveLength(0)
		expect(logs.join('\n')).toContain('deployed before report kind 4')
	})

	test('custody already recorded: stops after one read, writes nothing', () => {
		const { written, reads } = setup({ custodyAt: 1793330000n })
		const { result } = run()
		expect(result.status).toBe('already-recorded')
		expect(reads()).toBe(1)
		expect(written).toHaveLength(0)
	})

	test('an anchor the registry does not show yet is not recorded', () => {
		const { written } = setup({ anchoredAt: 0n })
		const { result } = run()
		expect(result.status).toBe('not-final')
		expect(written).toHaveLength(0)
	})

	test('a log removed by a reorg is ignored before any read', () => {
		const { written, reads } = setup()
		const { result } = run(config, realLog({ removed: true }))
		expect(result.status).toBe('ignored-removed-log')
		expect(reads()).toBe(0)
		expect(written).toHaveLength(0)
	})

	test('a case with no alert and no token: records the gaps and writes zeros, never a guess', () => {
		const { written, reads } = setup({ kase: { token: zeroAddress, level: 0, trailHash: zeroHash, collapsedAt: 0n }, purchases: 0 })
		const { result } = run()
		expect(result.status).toBe('written')
		expect(result.pool).toBeNull()
		expect(result.gaps).toEqual([
			'the case had no alert on record when this claim was filed',
			'no reasoning-trail head on record for this case',
			'the case has no EVM token on record, so no pool was read',
		])
		expect(reads()).toBe(4) // Sepolia only
		const r = decodeReport(written[0])
		expect([r.level, r.trailHash, r.collapsed, r.verifiedPurchases, r.poolLiquidityCents, r.mainnetBlock]).toEqual([
			0,
			zeroHash,
			false,
			0,
			0n,
			0n,
		])
	})

	test('no Uniswap V2 pool against any quote token: a gap after trying all four', () => {
		const { written, reads } = setup({ pairs: {} })
		const { result } = run()
		expect(result.pool).toBeNull()
		expect(result.gaps[0]).toMatch(/no Uniswap V2 pool .* against WETH, USDC, USDT, DAI/)
		expect(reads()).toBe(4 + 1 + 4) // Sepolia + header + four getPair
		expect(decodeReport(written[0]).poolLiquidityCents).toBe(0n)
	})

	test('a stablecoin pool is priced at $1 without a feed read', () => {
		// TEST-ONLY routing: pretend the factory knows a USDC pair (the captured reserves are reused as numbers)
		const usdcPair = '0x2222222222222222222222222222222222222222' as Address
		const { written, reads } = setup({ pairs: { [WETH]: zeroAddress, [USDC]: usdcPair } })
		const { result } = run()
		expect(result.pool?.quote).toBe('USDC')
		expect(result.pool?.pair).toBe(usdcPair)
		// token0 is EMAX in the captured pool, so the quote side is reserve1, priced at $1 with 6 decimals
		expect(result.pool?.liquidityCents).toBe(((2n * BigInt(fx.mainnet.reserves[1]) * 100n) / 10n ** 6n).toString())
		expect(reads()).toBe(4 + 1 + 2 + 2) // no feed read
		expect(written).toHaveLength(1)
	})

	test('a failed write is an error, not a silent success', () => {
		setup({ writeFails: true })
		expect(() => run()).toThrow(/Claim custody write failed/)
	})

	test('saves the generated report bytes for the contract test', async () => {
		expect(generated.custody).toBeDefined()
		await Bun.write(
			`${import.meta.dir}/fixtures/reports.generated.json`,
			`${JSON.stringify({ note: 'written by workflow.test.ts from fixtures/claim-anchored.emax-demo.json', ...generated }, null, 2)}\n`,
		)
	})
})

describe('initWorkflow and configs', () => {
	test('registers one EVM log trigger on the registry, for ClaimAnchored only', () => {
		const handlers = initWorkflow(config)
		expect(handlers).toHaveLength(1)
		expect(handlers[0].fn).toBe(onClaimAnchored)
		const t = handlers[0].trigger as unknown as {
			config: { addresses: Uint8Array[]; topics: { values: Uint8Array[] }[]; confidence: number }
		}
		expect(t.config.addresses.map((a) => bytesToHex(a).toLowerCase())).toEqual([REGISTRY.toLowerCase()])
		expect(t.config.topics).toHaveLength(1)
		expect(t.config.topics[0].values.map((v) => bytesToHex(v))).toEqual([CLAIM_ANCHORED_TOPIC])
	})

	test('all three targets parse; the log trigger needs a real registry address', () => {
		for (const c of [stagingConfig, localConfig, productionConfig]) expect(configSchema.safeParse(c).success).toBe(true)
		expect(configSchema.parse(stagingConfig).registry.confidence).toBe('FINALIZED')
		expect(configSchema.parse(productionConfig).registry.confidence).toBe('FINALIZED')
		const bad = { ...stagingConfig, registry: { ...stagingConfig.registry, address: zeroAddress } }
		expect(configSchema.safeParse(bad).success).toBe(false)
	})
})
