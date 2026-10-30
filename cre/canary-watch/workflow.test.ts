// Unit tests for canary-watch, using the CRE SDK test runtime (no WASM, no login, no network).
//   bun test
// Also writes fixtures/reports.generated.json: the exact report bytes this workflow produced, which
// contracts/test/CanaryRegistry.test.mjs then feeds into the real contract (end-to-end ABI check).
import { describe, expect } from 'bun:test'
import { getNetwork } from '@chainlink/cre-sdk'
import { addContractMock, EvmMock, HttpActionsMock, newTestRuntime, test } from '@chainlink/cre-sdk/test'
import { type Address, bytesToHex, type Hex, zeroHash } from 'viem'
import { AggregatorV3, CanaryRegistry, UniswapV2Pair } from './abi'
import { type Config, dropBps, initWorkflow, onCron, type Snapshot, type WatchResult } from './workflow'

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

describe('initWorkflow', () => {
	test('registers one cron handler with the configured schedule', () => {
		const handlers = initWorkflow(makeConfig())
		expect(handlers).toHaveLength(1)
		expect(handlers[0].fn).toBe(onCron)
		const trigger = handlers[0].trigger as { config?: { schedule?: string } }
		expect(trigger.config?.schedule).toBe('0 */10 * * * *')
	})
})
