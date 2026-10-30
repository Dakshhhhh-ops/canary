// Unit tests for canary-claims, using the CRE SDK test runtime (no WASM, no login, no network).
//   bun test
// The mainnet logs are real: fixtures/mainnet-logs.emax-demo.json was captured with eth_getLogs from an archive
// node for the hotline's demo wallet, and the mocked filterLogs capability serves them by block range.
// Also writes fixtures/reports.generated.json: the exact report bytes this workflow produced, which
// contracts/test/CanaryRegistry.test.mjs then feeds into the real contract (end-to-end ABI check).
import { describe, expect } from 'bun:test'
import {
	bigintToProtoBigInt,
	bytesToHex as sdkBytesToHex,
	getNetwork,
	hexToBase64,
	protoBigIntToBigint,
} from '@chainlink/cre-sdk'
import { addContractMock, EvmMock, newTestRuntime, test } from '@chainlink/cre-sdk/test'
import {
	type Address,
	bytesToHex,
	decodeAbiParameters,
	type Hex,
	keccak256,
	pad,
	toBytes,
	zeroHash,
} from 'viem'
import {
	CanaryRegistry,
	ClaimVerifiedBodyParams,
	ReportEnvelopeParams,
	SWAP_TOPIC,
	TRANSFER_TOPIC,
	UniswapV2Pair,
} from './abi'
import fixture from './fixtures/mainnet-logs.emax-demo.json'
import demoPayload from './payloads/demo-emax.json'
import stagingConfig from './config.staging.json'
import localConfig from './config.local.json'
import productionConfig from './config.production.json'
import {
	type Claim,
	type ClaimResult,
	type Config,
	configSchema,
	initWorkflow,
	onHttpTrigger,
	planWindows,
	scanRange,
	walletRefOf,
} from './workflow'

const MAINNET = getNetwork({ chainFamily: 'evm', chainSelectorName: 'ethereum-mainnet' })!.chainSelector.selector
const SEPOLIA = getNetwork({ chainFamily: 'evm', chainSelectorName: 'ethereum-testnet-sepolia' })!.chainSelector
	.selector
const REGISTRY = '0x1111111111111111111111111111111111111111' as Address
const REPORT_HEADER = 109 // REPORT_METADATA_HEADER_LENGTH in the SDK test runtime
const EMAX = '0x15874d65e649880c2614e7a480cb7c9A55787FF6' as Address
const PAIR = '0xb6CA52c7916ad7960C12Dc489FD93E5Af7cA257f' as Address
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address
const DEMO_BLOCKS = [12556426, 12638738, 12660238, 12700204, 12700228]

const makeConfig = (over: Partial<Config> = {}): Config => ({
	...configSchema.parse(stagingConfig),
	registry: { chainName: 'ethereum-testnet-sepolia', address: REGISTRY, gasLimit: '400000' },
	...over,
})

type FixtureLog = (typeof fixture.logs)[number]
const toLogJson = (l: FixtureLog) => ({
	address: hexToBase64(l.address),
	topics: l.topics.map(hexToBase64),
	txHash: hexToBase64(l.transactionHash),
	blockHash: hexToBase64(l.blockHash),
	data: hexToBase64(l.data),
	eventSig: hexToBase64(l.topics[0]),
	blockNumber: bigintToProtoBigInt(l.blockNumber),
	txIndex: l.transactionIndex,
	index: l.logIndex,
	removed: l.removed,
})

/** Wire up mocks. Returns the captured report payloads and every filterLogs query the workflow made. */
function setup(opts: { logs?: FixtureLog[]; verifiedAt?: bigint; token0?: Address } = {}) {
	const logs = opts.logs ?? fixture.logs
	const mainnet = EvmMock.testInstance(MAINNET)
	const pair = addContractMock(mainnet, { address: PAIR, abi: UniswapV2Pair })
	pair.token0 = () => opts.token0 ?? EMAX
	const queries: { from: number; to: number; addresses: string[]; topics: string[][] }[] = []
	mainnet.filterLogs = (input) => {
		const q = input.filterQuery!
		const from = Number(protoBigIntToBigint(q.fromBlock!))
		const to = Number(protoBigIntToBigint(q.toBlock!))
		const addresses = q.addresses.map((a) => sdkBytesToHex(a).toLowerCase())
		const topics = q.topics.map((t) => t.topic.map((x) => sdkBytesToHex(x).toLowerCase()))
		queries.push({ from, to, addresses, topics })
		// Behave like a node: apply the same filter to the fixture logs.
		const match = (l: FixtureLog) =>
			l.blockNumber >= from &&
			l.blockNumber <= to &&
			addresses.includes(l.address.toLowerCase()) &&
			topics.every((slot, i) => slot.length === 0 || slot.includes(l.topics[i]?.toLowerCase() ?? ''))
		return { logs: logs.filter(match).map(toLogJson) }
	}

	const sepolia = EvmMock.testInstance(SEPOLIA)
	const registry = addContractMock(sepolia, { address: REGISTRY, abi: CanaryRegistry })
	registry.claimVerifiedAt = () => opts.verifiedAt ?? 0n
	const written: Hex[] = []
	registry.writeReport = (input) => {
		written.push(bytesToHex(input.report.rawReport.slice(REPORT_HEADER)))
		return { txStatus: 'TX_STATUS_SUCCESS', txHash: Buffer.alloc(32, 7).toString('base64') }
	}
	return { written, queries }
}

const run = (config: Config, body: unknown) => {
	const runtime = newTestRuntime<Config>(null, {}, config)
	const input = typeof body === 'string' ? body : JSON.stringify(body)
	const out = onHttpTrigger(runtime as never, { input: new TextEncoder().encode(input) } as never)
	return { result: JSON.parse(out) as ClaimResult, logs: runtime.getLogs() }
}

const DEMO: Claim = demoPayload
const generated: Record<string, unknown> = {}

describe('configs and payload', () => {
	test('every config parses, and the case id is keccak256("canary:emax") like the app', () => {
		for (const c of [stagingConfig, localConfig, productionConfig]) {
			const cfg = configSchema.parse(c)
			expect(cfg.cases[0].caseId).toBe(keccak256(toBytes(`canary:${cfg.cases[0].slug}`)))
			expect(cfg.cases[0].classStartBlock).toBe(12429199) // first block of 2021-05-14 UTC
			expect(cfg.cases[0].classEndBlock).toBe(12719181) // last block of 2021-06-27 UTC
			expect(cfg.cases[0].pairCreatedBlock).toBe(12503000)
		}
		expect(DEMO.caseId).toBe(stagingConfig.cases[0].caseId)
	})

	test('walletRef is keccak256(abi.encodePacked(salt, wallet))', () => {
		const salt = DEMO.walletSalt as Hex
		const packed = `${salt}${DEMO.wallet.slice(2).toLowerCase()}` as Hex
		expect(walletRefOf(DEMO.wallet, salt)).toBe(keccak256(packed))
		expect(walletRefOf(DEMO.wallet)).toBe(keccak256(`${zeroHash}${DEMO.wallet.slice(2)}` as Hex))
	})
})

describe('planWindows', () => {
	const range = { from: 12503000, to: 12719181 }
	test('groups hints into <= 100-block windows and keeps only the class period', () => {
		const p = planWindows([...DEMO_BLOCKS, 12400000, 12800000, 12556426], range, 100, 10)
		expect(p.windows.map((w) => [w.fromBlock, w.toBlock])).toEqual([
			[12556426, 12556426],
			[12638738, 12638738],
			[12660238, 12660238],
			[12700204, 12700228],
		])
		expect(p.outside).toBe(2)
		expect(p.dropped).toBe(0)
		expect(p.unique).toBe(7)
	})
	test('a window never spans more than the limit', () => {
		const p = planWindows([13000000 - 1, 12600000, 12600099, 12600100], { from: 0, to: 20000000 }, 100, 10)
		expect(p.windows.map((w) => [w.fromBlock, w.toBlock])).toEqual([
			[12600000, 12600099],
			[12600100, 12600100],
			[12999999, 12999999],
		])
	})
	test('reports the hints it could not check', () => {
		const p = planWindows([1, 1000, 2000, 3000], { from: 0, to: 10000 }, 100, 2)
		expect(p.windows).toHaveLength(2)
		expect(p.dropped).toBe(2)
	})
})

describe('onHttpTrigger', () => {
	test('demo wallet: 5 real buys confirmed on mainnet, claim-verified report written', () => {
		const { written, queries } = setup()
		const { result } = run(makeConfig(), DEMO)
		expect(result.status).toBe('verified')
		expect(result.purchases).toBe(5)
		expect(result.firstBuyBlock).toBe(12556426)
		expect(result.buys.map((b) => b.block)).toEqual(DEMO_BLOCKS)
		expect(result.buys[0].txHash).toBe('0xdd3ae813c62eb3f57ca97eddaee0f2e6d456f8ab795243f855e042c186b52ba0')
		expect(result.buys[0].amount).toBe('1924122545506946367218507928') // 1,924,122,545.5 EMAX (18 decimals)
		expect(result.write).toBe('written')
		expect(result.walletRef).toBe(walletRefOf(DEMO.wallet, DEMO.walletSalt))

		// 4 log queries, all within CRE's 100-block limit, all with the same filter
		expect(queries.map((q) => [q.from, q.to])).toEqual(result.scanned.map((s) => [s.fromBlock, s.toBlock]))
		expect(queries).toHaveLength(4)
		for (const q of queries) {
			expect(q.to - q.from + 1).toBeLessThanOrEqual(100)
			expect(q.addresses).toEqual([EMAX.toLowerCase(), PAIR.toLowerCase()])
			expect(q.topics).toEqual([[TRANSFER_TOPIC, SWAP_TOPIC], [], [pad(DEMO.wallet as Hex).toLowerCase()]])
		}

		// The report: envelope kind 3, body as CanaryRegistry decodes it. No wallet address in it.
		expect(written).toHaveLength(1)
		const [kind, body] = decodeAbiParameters(ReportEnvelopeParams, written[0])
		expect(kind).toBe(3)
		const [caseId, evidenceHash, claimantRef, walletRef, purchases, firstBuyBlock] = decodeAbiParameters(
			ClaimVerifiedBodyParams,
			body,
		)
		expect(caseId).toBe(DEMO.caseId as Hex)
		expect(evidenceHash).toBe(DEMO.evidenceHash as Hex)
		expect(claimantRef).toBe(DEMO.claimantRef as Hex)
		expect(walletRef).toBe(walletRefOf(DEMO.wallet, DEMO.walletSalt))
		expect(purchases).toBe(5)
		expect(firstBuyBlock).toBe(12556426n)
		expect(written[0].toLowerCase()).not.toContain(DEMO.wallet.slice(2).toLowerCase())
		generated.claimVerified = written[0]
		generated.expected = { purchases: 5, firstBuyBlock: 12556426, walletRef }
	})

	test('already verified on the registry: nothing written', () => {
		const { written } = setup({ verifiedAt: 1_760_000_000n })
		const { result } = run(makeConfig(), DEMO)
		expect(result.status).toBe('verified')
		expect(result.write).toBe('already-recorded')
		expect(written).toHaveLength(0)
	})

	test('observe-only mode (registry = zero address) verifies but never writes', () => {
		const { written } = setup()
		const cfg = makeConfig()
		const { result } = run({ ...cfg, registry: { ...cfg.registry, address: '0x0000000000000000000000000000000000000000' } }, DEMO)
		expect(result.status).toBe('verified')
		expect(result.write).toBe('observe-only')
		expect(written).toHaveLength(0)
	})

	test('a different wallet at the same blocks: not verified, nothing written', () => {
		const { written } = setup()
		const { result } = run(makeConfig(), { ...DEMO, wallet: '0x000000000000000000000000000000000000bEEF' })
		expect(result.status).toBe('not-verified')
		expect(result.purchases).toBe(0)
		expect(written).toHaveLength(0)
	})

	test('wrong hint blocks find nothing (the hints are checked, not trusted)', () => {
		const { written } = setup()
		const { result } = run(makeConfig(), { ...DEMO, purchaseBlocks: [12556427, 12600000] })
		expect(result.status).toBe('not-verified')
		expect(written).toHaveLength(0)
	})

	test('only the hinted buys count: 2 of 5 hinted -> 2 purchases', () => {
		const { written } = setup()
		const { result } = run(makeConfig(), { ...DEMO, purchaseBlocks: [12700228, 12638738] })
		expect(result.purchases).toBe(2)
		expect(result.firstBuyBlock).toBe(12638738)
		expect(written).toHaveLength(1)
	})

	test('hints outside the class period are not queried at all', () => {
		const { written, queries } = setup()
		const { result, logs } = run(makeConfig(), { ...DEMO, purchaseBlocks: [12429198, 12719182, 13000000] })
		expect(result.status).toBe('not-verified')
		expect(result.hints?.outside).toBe(3)
		expect(queries).toHaveLength(0)
		expect(written).toHaveLength(0)
		expect(logs.join('\n')).toContain('nothing to check')
	})

	test('a Transfer from the pool without a Swap (e.g. liquidity withdrawn) is not a purchase', () => {
		const { written } = setup({ logs: fixture.logs.filter((l) => l.topics[0] !== SWAP_TOPIC) })
		const { result } = run(makeConfig(), DEMO)
		expect(result.status).toBe('not-verified')
		expect(written).toHaveLength(0)
	})

	test('a Swap that pays out the other token (WETH) does not confirm a token buy', () => {
		// Pretend token0 is WETH: the real swaps paid out amount0 (EMAX), so with the sides flipped none match.
		const { written } = setup({ token0: WETH })
		const { result } = run(makeConfig(), DEMO)
		expect(result.status).toBe('not-verified')
		expect(written).toHaveLength(0)
	})

	test('a Transfer to the wallet from someone other than the pool is ignored', () => {
		const moved = fixture.logs.map((l) =>
			l.topics[0] === TRANSFER_TOPIC ? { ...l, topics: [l.topics[0], pad('0x000000000000000000000000000000000000dEaD'), l.topics[2]] } : l,
		)
		const { written } = setup({ logs: moved })
		const { result } = run(makeConfig(), DEMO)
		expect(result.status).toBe('not-verified')
		expect(written).toHaveLength(0)
	})

	test('rejects malformed claims without reading the chain', () => {
		const { written, queries } = setup()
		expect(run(makeConfig(), { ...DEMO, wallet: 'not-an-address' }).result.status).toBe('rejected')
		expect(run(makeConfig(), { ...DEMO, caseId: `0x${'12'.repeat(32)}` }).result.reason).toContain('Unknown caseId')
		expect(run(makeConfig(), { ...DEMO, evidenceHash: zeroHash }).result.status).toBe('rejected')
		expect(run(makeConfig(), 'not json').result.reason).toContain('not JSON')
		expect(run(makeConfig(), '').result.reason).toContain('Empty')
		expect(queries).toHaveLength(0)
		expect(written).toHaveLength(0)
	})

	test('saves the generated report bytes for the contract test', async () => {
		expect(generated.claimVerified).toBeDefined()
		const { walletSalt: _salt, wallet: _wallet, ...publicClaim } = DEMO
		await Bun.write(
			`${import.meta.dir}/fixtures/reports.generated.json`,
			`${JSON.stringify({ note: 'written by workflow.test.ts', claim: publicClaim, ...generated }, null, 2)}\n`,
		)
	})
})

describe('initWorkflow', () => {
	test('registers one HTTP-trigger handler; authorized keys come from config', () => {
		const handlers = initWorkflow(makeConfig({ authorizedEvmAddresses: ['0x00000000000000000000000000000000000000AA'] }))
		expect(handlers).toHaveLength(1)
		expect(handlers[0].fn).toBe(onHttpTrigger)
		const trigger = handlers[0].trigger as { config?: { authorizedKeys?: { publicKey: string }[] }; capabilityId(): string }
		expect(trigger.capabilityId()).toBe('http-trigger@1.0.0-alpha')
		expect(trigger.config?.authorizedKeys?.map((k) => k.publicKey)).toEqual(['0x00000000000000000000000000000000000000AA'])
	})

	test('the scan range is the class period, starting no earlier than the pool', () => {
		expect(scanRange(makeConfig().cases[0])).toEqual({ from: 12503000, to: 12719181 })
	})
})

