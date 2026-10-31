// Unit tests for canary-watch, using the CRE SDK test runtime (no WASM, no login, no network).
//   bun test
// Also writes fixtures/reports.generated.json: the exact report bytes this workflow produced, which
// contracts/test/CanaryRegistry.test.mjs then feeds into the real contract (end-to-end ABI check).
import { describe, expect } from 'bun:test'
import { getNetwork } from '@chainlink/cre-sdk'
import { addContractMock, EvmMock, HttpActionsMock, newTestRuntime, test } from '@chainlink/cre-sdk/test'
import { type Address, bytesToHex, type Hex, zeroHash } from 'viem'
import { AggregatorV3, CanaryRegistry, UniswapV2Pair } from './abi'
import localConfig from './config.local.json'
import productionConfig from './config.production.json'
import stagingConfig from './config.staging.json'
import {
	CHAIN_READ_LIMIT,
	canonicalList,
	type Config,
	configSchema,
	dropBps,
	initWorkflow,
	onCron,
	parseCanonicalList,
	pickCases,
	runIndexOf,
	type Snapshot,
	type WatchListResult,
	type WatchResult,
} from './workflow'

const MAINNET = getNetwork({ chainFamily: 'evm', chainSelectorName: 'ethereum-mainnet' })!.chainSelector.selector
const SEPOLIA = getNetwork({ chainFamily: 'evm', chainSelectorName: 'ethereum-testnet-sepolia' })!.chainSelector
	.selector

const PAIR = '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc' as Address // USDC/WETH, token0 = USDC
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address
const ETH_USD = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419' as Address
const REGISTRY = '0x1111111111111111111111111111111111111111' as Address
const REPORT_HEADER = 109 // REPORT_METADATA_HEADER_LENGTH in the SDK test runtime

const SNAPSHOT: Snapshot = {
	caseId: `0x${'ab'.repeat(32)}`,
	symbol: 'MOONCAT',
	token: '0x000000000000000000000000000000000000dEaD',
	level: 2,
	promoters: 7,
	trailHash: `0x${'cd'.repeat(32)}`,
	liquidityBeforeUsd: 1_000_000,
	liquidityNowUsd: 900_000,
}

const makeConfig = (over: Partial<Config> = {}): Config => ({
	schedule: '0 */10 * * * *',
	snapshotUrl: 'https://canary.example/api/watch/snapshot',
	collapseDropBps: 8000,
	liquidity: {
		chainName: 'ethereum-mainnet',
		pairAddress: PAIR,
		quoteTokens: [
			{ symbol: 'WETH', address: WETH, decimals: 18, usdFeed: ETH_USD, feedDecimals: 8 },
			{ symbol: 'USDC', address: USDC, decimals: 6, usdFeed: '', feedDecimals: 8 },
		],
	},
	registry: { chainName: 'ethereum-testnet-sepolia', address: REGISTRY, gasLimit: '500000' },
	...over,
})

/** Wire up mocks. wethReserve in wei; ETH at $2,000. Returns the captured report payloads. */
function setup(opts: {
	snapshot?: unknown
	httpStatus?: number
	wethReserve: bigint
	known?: { level: number; trailHash: Hex; collapsed: boolean }
}) {
	const http = HttpActionsMock.testInstance()
	http.sendRequest = () => ({
		statusCode: opts.httpStatus ?? 200,
		body: Buffer.from(JSON.stringify(opts.snapshot ?? SNAPSHOT)).toString('base64'),
	})

	const mainnet = EvmMock.testInstance(MAINNET)
	const pair = addContractMock(mainnet, { address: PAIR, abi: UniswapV2Pair })
	pair.token0 = () => USDC
	pair.token1 = () => WETH
	pair.getReserves = () => [1_000_000_000_000n, opts.wethReserve, 1700000000]
	const feed = addContractMock(mainnet, { address: ETH_USD, abi: AggregatorV3 })
	feed.latestRoundData = () => [1n, 2000_00000000n, 0n, 0n, 1n]

	const sepolia = EvmMock.testInstance(SEPOLIA)
	const registry = addContractMock(sepolia, { address: REGISTRY, abi: CanaryRegistry })
	const known = opts.known ?? { level: 0, trailHash: zeroHash, collapsed: false }
	registry.statusOf = () => [known.level, known.trailHash, known.collapsed]
	const written: Hex[] = []
	registry.writeReport = (input) => {
		written.push(bytesToHex(input.report.rawReport.slice(REPORT_HEADER)))
		return { txStatus: 'TX_STATUS_SUCCESS', txHash: Buffer.alloc(32, written.length).toString('base64') }
	}
	return { written }
}

const run = (config: Config) => {
	const runtime = newTestRuntime<Config>(null, {}, config)
	return { result: JSON.parse(onCron(runtime as never)) as WatchResult, logs: runtime.getLogs() }
}

const generated: Record<string, Hex> = {}

describe('dropBps', () => {
	test('computes the drop in basis points', () => {
		expect(dropBps(100n, 20n)).toBe(8000)
		expect(dropBps(100n, 100n)).toBe(0)
		expect(dropBps(100n, 150n)).toBe(0)
		expect(dropBps(0n, 5n)).toBe(0)
	})
})

describe('onCron', () => {
	test('healthy pool: writes only an alert report', () => {
		// 250 WETH * $2000 * 2 = $1,000,000 -> no drop vs $1,000,000 before
		const { written } = setup({ wethReserve: 250n * 10n ** 18n })
		const { result } = run(makeConfig())
		expect(result.onchainLiquidityCents).toBe('100000000')
		expect(result.dropBps).toBe(0)
		expect(result.alert).toBe('written')
		expect(result.collapse).toBe('not-needed')
		expect(written).toHaveLength(1)
		generated.alert = written[0]
	})

	test('liquidity pulled (>= 80% drop on-chain): writes alert + collapse', () => {
		// 25 WETH -> $100,000 = 90% drop
		const { written } = setup({ wethReserve: 25n * 10n ** 18n })
		const { result } = run(makeConfig())
		expect(result.dropBps).toBe(9000)
		expect(result.alert).toBe('written')
		expect(result.collapse).toBe('written')
		expect(written).toHaveLength(2)
		generated.collapse = written[1]
	})

	test('nothing new: registry already has this trail and the collapse', () => {
		const { written } = setup({
			wethReserve: 25n * 10n ** 18n,
			known: { level: 3, trailHash: SNAPSHOT.trailHash as Hex, collapsed: true },
		})
		const { result } = run(makeConfig())
		expect(result.alert).toBe('already-recorded')
		expect(result.collapse).toBe('already-recorded')
		expect(written).toHaveLength(0)
	})

	test('level 0 and healthy pool: writes nothing', () => {
		const { written } = setup({ snapshot: { ...SNAPSHOT, level: 0 }, wethReserve: 250n * 10n ** 18n })
		const { result } = run(makeConfig())
		expect(result.alert).toBe('not-needed')
		expect(result.collapse).toBe('not-needed')
		expect(written).toHaveLength(0)
	})

	test('observe-only mode (registry = zero address) never writes', () => {
		const { written } = setup({ wethReserve: 25n * 10n ** 18n })
		const cfg = makeConfig()
		const { result } = run({ ...cfg, registry: { ...cfg.registry, address: '0x0000000000000000000000000000000000000000' } })
		expect(result.alert).toBe('observe-only')
		expect(result.collapse).toBe('observe-only')
		expect(written).toHaveLength(0)
	})

	test('inline fixture is used when snapshotUrl is empty', () => {
		const { written } = setup({ wethReserve: 250n * 10n ** 18n, httpStatus: 500 })
		const { result, logs } = run(makeConfig({ snapshotUrl: '', fixtureSnapshot: SNAPSHOT }))
		expect(result.caseId).toBe(SNAPSHOT.caseId)
		expect(logs.join('\n')).toContain('fixtureSnapshot')
		expect(written).toHaveLength(1)
	})

	test('rejects a malformed snapshot', () => {
		setup({ snapshot: { ...SNAPSHOT, caseId: 'not-a-hash' }, wethReserve: 1n })
		expect(() => run(makeConfig())).toThrow()
	})

	test('rejects an HTTP error from the snapshot API', () => {
		setup({ httpStatus: 503, wethReserve: 1n })
		expect(() => run(makeConfig())).toThrow()
	})

	test('saves the generated report bytes for the contract test', async () => {
		expect(generated.alert).toBeDefined()
		expect(generated.collapse).toBeDefined()
		await Bun.write(
			`${import.meta.dir}/fixtures/reports.generated.json`,
			`${JSON.stringify({ note: 'written by workflow.test.ts', snapshot: SNAPSHOT, ...generated }, null, 2)}\n`,
		)
	})
})

// ───────────── list mode: the EMAX case file plus coins the live radar flagged ─────────────

// TEST-ONLY cases and pools: made-up ids and reserves, each case with its own pair (token1 = WETH).
const listCase = (n: number, over: Partial<Snapshot> = {}): Snapshot => ({
	caseId: `0x${n.toString(16).padStart(2, '0').repeat(32)}`,
	symbol: `COIN${n}`,
	token: `0x${n.toString(16).padStart(40, '0')}`,
	level: 1,
	promoters: 0,
	trailHash: `0x${(n + 100).toString(16).padStart(2, '0').repeat(32)}`,
	liquidityBeforeUsd: 0, // radar coins: no same-pool "before" figure, so never a collapse
	liquidityNowUsd: 50_000,
	pair: `0x${(n + 0x1000).toString(16).padStart(40, '0')}`,
	...over,
})

/** HTTP serves `body` for the list URL; every pair holds `wethReserve`; counts chain reads per kind. */
function setupList(opts: { body: unknown; httpStatus?: number; wethReserve?: bigint; pairs: string[] }) {
	const http = HttpActionsMock.testInstance()
	const requests: { url: string; headers: Record<string, string> }[] = []
	http.sendRequest = (input) => {
		requests.push({ url: input.url, headers: { ...input.headers } })
		return { statusCode: opts.httpStatus ?? 200, body: Buffer.from(JSON.stringify(opts.body)).toString('base64') }
	}
	const reads = { pool: 0, feed: 0, registry: 0 }
	const mainnet = EvmMock.testInstance(MAINNET)
	for (const p of opts.pairs) {
		const pair = addContractMock(mainnet, { address: p as Address, abi: UniswapV2Pair })
		pair.token0 = () => (reads.pool++, '0x000000000000000000000000000000000000dEaD')
		pair.token1 = () => (reads.pool++, WETH)
		pair.getReserves = () => (reads.pool++, [10n ** 30n, opts.wethReserve ?? 25n * 10n ** 18n, 1700000000])
	}
	const feed = addContractMock(mainnet, { address: ETH_USD, abi: AggregatorV3 })
	feed.latestRoundData = () => (reads.feed++, [1n, 2000_00000000n, 0n, 0n, 1n])
	const sepolia = EvmMock.testInstance(SEPOLIA)
	const registry = addContractMock(sepolia, { address: REGISTRY, abi: CanaryRegistry })
	registry.statusOf = () => (reads.registry++, [0, zeroHash, false])
	const written: Hex[] = []
	registry.writeReport = (input) => {
		written.push(bytesToHex(input.report.rawReport.slice(REPORT_HEADER)))
		return { txStatus: 'TX_STATUS_SUCCESS', txHash: Buffer.alloc(32, written.length).toString('base64') }
	}
	return { requests, reads, written }
}

const listConfig = (over: Partial<Config> = {}): Config =>
	makeConfig({ snapshotUrl: '', snapshotListUrl: 'https://canary.example/api/watch/snapshot?list=1', ...over })

const runList = (config: Config, opts: { secrets?: Record<string, string>; scheduledSeconds?: bigint } = {}) => {
	const secrets = opts.secrets ? new Map([['main', new Map(Object.entries(opts.secrets))]]) : null
	const runtime = newTestRuntime<Config>(secrets, {}, config)
	const payload =
		opts.scheduledSeconds === undefined ? undefined : ({ scheduledExecutionTime: { seconds: opts.scheduledSeconds, nanos: 0 } } as never)
	return { result: JSON.parse(onCron(runtime as never, payload)) as WatchListResult, logs: runtime.getLogs().join('\n') }
}

describe('list mode', () => {
	test('watches every listed case: alert per flagged coin, collapse only where a same-pool "before" exists', () => {
		const emax = { ...SNAPSHOT, symbol: 'EMAXLIKE', pair: PAIR } // before $1M, pool now $100k (90% drop)
		const coin = listCase(1)
		const { written, reads, requests } = setupList({ body: { cases: [emax, coin] }, pairs: [PAIR, coin.pair!] })
		const { result } = runList(listConfig())
		expect(requests).toHaveLength(1)
		expect(requests[0].url).toContain('list=1')
		expect(result.mode).toBe('list')
		expect(result.listed).toBe(2)
		expect(result.cases.map((c) => [c.symbol, c.alert, c.collapse])).toEqual([
			['EMAXLIKE', 'written', 'written'],
			['COIN1', 'written', 'not-needed'],
		])
		expect(written).toHaveLength(3)
		expect(result.txs).toHaveLength(3)
		// the ETH/USD price is read once and shared: 2 x 3 pool reads + 1 feed + 2 statusOf
		expect(reads).toEqual({ pool: 6, feed: 1, registry: 2 })
		expect(result.chainReads).toBe(9)
	})

	test('a long list is worked through in turns, the same slice on every node (cron scheduled time)', () => {
		const cases = [1, 2, 3, 4, 5].map((n) => listCase(n))
		setupList({ body: { cases }, pairs: cases.map((c) => c.pair!) })
		// 10-minute slots: 1793333400 s / 600 = 2988889 -> start (2988889 * 3) % 5 = 2
		const { result, logs } = runList(listConfig(), { scheduledSeconds: 1793333400n })
		expect(result.runIndex).toBe(2988889)
		expect(result.cases.map((c) => c.symbol)).toEqual(['COIN3', 'COIN4', 'COIN5'])
		expect(result.deferred.map((d) => d.symbol)).toEqual(['COIN1', 'COIN2'])
		expect(result.deferred[0].reason).toMatch(/waits its turn/)
		expect(logs).toContain('Watch list: 5 case(s)')
	})

	test('never goes over CRE’s 15 chain reads: extra cases are deferred, not dropped', () => {
		const cases = [1, 2, 3, 4, 5].map((n) => listCase(n))
		const { reads } = setupList({ body: { cases }, pairs: cases.map((c) => c.pair!) })
		const { result } = runList(listConfig({ maxCasesPerRun: 5 }))
		// case 1: 3 pool + 1 feed + 1 registry = 5; then 4 each: 9, 13; a 4th would need 17
		expect(result.cases).toHaveLength(3)
		expect(result.deferred.map((d) => [d.symbol, d.reason])).toEqual([
			['COIN4', 'CRE chain-read limit for this run'],
			['COIN5', 'CRE chain-read limit for this run'],
		])
		expect(result.chainReads).toBe(13)
		expect(reads.pool + reads.feed + reads.registry).toBeLessThanOrEqual(CHAIN_READ_LIMIT)
	})

	test('sends the bearer token from the CRE secret, and fetches publicly when the secret is missing or empty', () => {
		const cases = [listCase(1)]
		let s = setupList({ body: { cases }, pairs: [cases[0].pair!] })
		let r = runList(listConfig({ authSecret: 'WATCH_TOKEN' }), { secrets: { WATCH_TOKEN: 'test-token-123' } })
		expect(s.requests[0].headers.authorization).toBe('Bearer test-token-123')
		expect(r.logs).toContain('Using the WATCH_TOKEN secret')
		expect(r.logs).not.toContain('test-token-123') // the value is never logged

		s = setupList({ body: { cases }, pairs: [cases[0].pair!] })
		r = runList(listConfig({ authSecret: 'WATCH_TOKEN' }))
		expect(s.requests[0].headers.authorization).toBeUndefined()
		expect(r.logs).toContain('Secret WATCH_TOKEN is not available')

		s = setupList({ body: { cases }, pairs: [cases[0].pair!] })
		r = runList(listConfig({ authSecret: 'WATCH_TOKEN' }), { secrets: { WATCH_TOKEN: '' } })
		expect(s.requests[0].headers.authorization).toBeUndefined()
		expect(r.result.cases).toHaveLength(1)
	})

	test('the single-case URL can use the secret too', () => {
		setup({ wethReserve: 250n * 10n ** 18n })
		let auth: string | undefined
		HttpActionsMock.testInstance().sendRequest = (input) => {
			auth = input.headers.authorization
			return { statusCode: 200, body: Buffer.from(JSON.stringify(SNAPSHOT)).toString('base64') }
		}
		const runtime = newTestRuntime<Config>(new Map([['main', new Map([['WATCH_TOKEN', 'abc-123']])]]), {}, makeConfig({ authSecret: 'WATCH_TOKEN' }))
		const result = JSON.parse(onCron(runtime as never)) as WatchResult
		expect(auth).toBe('Bearer abc-123')
		expect(result.caseId).toBe(SNAPSHOT.caseId) // single mode keeps its old result shape
	})

	test('offline: fixtureSnapshots is used when both URLs are empty', () => {
		const cases = [listCase(1), listCase(2)]
		const { requests } = setupList({ body: {}, httpStatus: 500, pairs: cases.map((c) => c.pair!) })
		const { result, logs } = runList(makeConfig({ snapshotUrl: '', fixtureSnapshots: cases }))
		expect(requests).toHaveLength(0)
		expect(logs).toContain('fixtureSnapshots')
		expect(result.cases.map((c) => c.symbol)).toEqual(['COIN1', 'COIN2'])
	})

	test('rejects a malformed list, an HTTP error, and a list that is too long', () => {
		setupList({ body: { cases: [{ ...listCase(1), level: 7 }] }, pairs: [] })
		expect(() => runList(listConfig())).toThrow()
		setupList({ body: { cases: [] }, httpStatus: 401, pairs: [] })
		expect(() => runList(listConfig())).toThrow()
		setupList({ body: { cases: Array.from({ length: 26 }, (_, i) => listCase(i + 1)) }, pairs: [] })
		expect(() => runList(listConfig())).toThrow()
	})

	test('an empty list is a quiet run', () => {
		const { written } = setupList({ body: { cases: [] }, pairs: [] })
		const { result } = runList(listConfig())
		expect(result.cases).toEqual([])
		expect(written).toHaveLength(0)
	})
})

describe('list helpers', () => {
	test('canonicalList: one canonical string per list, repeated case ids dropped, round-trips', () => {
		const a = listCase(1)
		const text = canonicalList([a, { ...a, symbol: 'DUPLICATE' }, listCase(2)])
		const back = parseCanonicalList(text)
		expect(back.map((c) => c.symbol)).toEqual(['COIN1', 'COIN2'])
		expect(back[0].liquidityNowCents).toBe(5_000_000n)
		expect(canonicalList([a, listCase(2)])).toBe(text) // same input -> byte-identical observation
	})

	test('pickCases and runIndexOf', () => {
		expect(pickCases([1, 2], 3, 7)).toEqual({ picked: [1, 2], deferred: [] })
		expect(pickCases([1, 2, 3, 4, 5], 3, 0).picked).toEqual([1, 2, 3])
		expect(pickCases([1, 2, 3, 4, 5], 3, 1).picked).toEqual([4, 5, 1])
		expect(pickCases([1, 2, 3, 4, 5], 3, 2).picked).toEqual([2, 3, 4])
		expect(runIndexOf(undefined, 10)).toBe(0)
		expect(runIndexOf({ scheduledExecutionTime: { seconds: 1200n } } as never, 10)).toBe(2)
	})

	test('the three targets parse: staging offline (one EMAX fixture), local and production read the list with the secret', () => {
		const s = configSchema.parse(stagingConfig)
		expect(s.snapshotUrl).toBe('')
		expect(s.fixtureSnapshot?.symbol).toBe('EMAX')
		for (const c of [localConfig, productionConfig]) {
			const p = configSchema.parse(c)
			expect(p.snapshotListUrl).toContain('/api/watch/snapshot?list=1')
			expect(p.authSecret).toBe('WATCH_TOKEN')
			expect(p.maxCasesPerRun).toBe(3)
		}
	})
})

describe('initWorkflow', () => {
	test('registers one cron handler with the configured schedule', () => {
		const handlers = initWorkflow(makeConfig())
		expect(handlers).toHaveLength(1)
		expect(handlers[0].fn).toBe(onCron)
		const trigger = handlers[0].trigger as { config?: { schedule?: string } }
		expect(trigger.config?.schedule).toBe('0 */10 * * * *')
	})
})
