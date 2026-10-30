// CanaryRegistry on a local in-process chain (ganache + viem). No network, no keys.
//   npm test        (compiles first)
// The forwarder is the real Sepolia MockKeystoneForwarder address, impersonated locally.
// If cre/canary-watch/fixtures/reports.generated.json exists (written by `bun test` in the workflow),
// the exact bytes the workflow produced are also pushed through onReport.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import ganache from 'ganache'
import {
	createPublicClient,
	createWalletClient,
	custom,
	decodeErrorResult,
	decodeEventLog,
	encodeFunctionData,
	encodeAbiParameters,
	keccak256,
	parseAbiParameters,
	toHex,
	zeroAddress,
} from 'viem'

const here = dirname(fileURLToPath(import.meta.url))
const { abi, bytecode } = JSON.parse(readFileSync(join(here, '..', 'out', 'CanaryRegistry.json'), 'utf8'))
const generatedPath = join(here, '..', '..', 'cre', 'canary-watch', 'fixtures', 'reports.generated.json')

const FORWARDER = '0x15fC6ae953E024d975e77382eEeC56A9101f9F88' // Sepolia MockKeystoneForwarder
const Envelope = parseAbiParameters('uint8 kind, bytes body')
const AlertBody = parseAbiParameters(
	'bytes32 caseId, string symbol, address token, uint8 level, uint32 promoters, bytes32 trailHash',
)
const CollapseBody = parseAbiParameters(
	'bytes32 caseId, address token, uint256 liquidityBefore, uint256 liquidityNow, uint16 dropBps',
)
const alertReport = (caseId, level, trail, symbol = 'MOONCAT', token = '0x000000000000000000000000000000000000dEaD', promoters = 7) =>
	encodeAbiParameters(Envelope, [1, encodeAbiParameters(AlertBody, [caseId, symbol, token, level, promoters, trail])])
const collapseReport = (caseId, before, now, drop, token = '0x000000000000000000000000000000000000dEaD') =>
	encodeAbiParameters(Envelope, [2, encodeAbiParameters(CollapseBody, [caseId, token, before, now, drop])])
const id = (s) => keccak256(toHex(s))

let provider, pub, wallet, owner, relayer, stranger, registry

// send(...) returns a thenable: `await send(...)` executes the tx and resolves to its decoded events;
// `reverts(send(...), 'Err')` only eth_calls it and checks the custom error.
function send(from, functionName, args) {
	return { from, functionName, args, then: (ok, ko) => sendTx(from, functionName, args).then(ok, ko) }
}
// Check it would not revert, then send for real and decode the events.
async function sendTx(from, functionName, args) {
	await expectNoRevert(from, functionName, args)
	const hash = await wallet.writeContract({
		account: from,
		address: registry,
		abi,
		functionName,
		args,
		chain: null,
		gas: 3_000_000n,
	})
	const receipt = await pub.waitForTransactionReceipt({ hash })
	assert.equal(receipt.status, 'success')
	if (process.env.GAS_REPORT) console.log(`gas ${functionName}: ${receipt.gasUsed}`)
	return receipt.logs
		.map((l) => {
			try {
				return decodeEventLog({ abi, data: l.data, topics: l.topics })
			} catch {
				return null
			}
		})
		.filter(Boolean)
}
const read = (functionName, args = []) => pub.readContract({ address: registry, abi, functionName, args })

// eth_call the transaction; returns the decoded custom error name, or null if it would succeed.
async function revertName(from, functionName, args) {
	const data = encodeFunctionData({ abi, functionName, args })
	try {
		await provider.request({ method: 'eth_call', params: [{ from, to: registry, data, gas: '0x2dc6c0' }, 'latest'] })
		return null
	} catch (e) {
		const raw = typeof e?.data === 'string' ? e.data : (e?.data?.result ?? e?.data?.data)
		if (typeof raw !== 'string' || raw.length < 10) throw e
		return decodeErrorResult({ abi, data: raw }).errorName
	}
}
async function expectNoRevert(from, functionName, args) {
	const name = await revertName(from, functionName, args)
	assert.equal(name, null, `${functionName} would revert with ${name}`)
}
// Usage: await reverts(send(from, fn, args), 'ErrorName'). Checks the decoded error, sends nothing.
async function reverts(pending, errorName) {
	const { from, functionName, args } = pending
	assert.equal(await revertName(from, functionName, args), errorName)
}

before(async () => {
	provider = ganache.provider({
		logging: { quiet: true },
		chain: { hardfork: 'shanghai', chainId: 1337 },
		wallet: { totalAccounts: 3, unlockedAccounts: [FORWARDER] },
		miner: { defaultTransactionGasLimit: 'estimate' },
	})
	await provider.request({ method: 'evm_setAccountBalance', params: [FORWARDER, '0x8AC7230489E80000'] })
	const transport = custom(provider)
	pub = createPublicClient({ transport })
	wallet = createWalletClient({ transport })
	;[owner, relayer, stranger] = await wallet.getAddresses()
	const hash = await wallet.deployContract({ account: owner, abi, bytecode, args: [[FORWARDER], relayer], chain: null })
	registry = (await pub.waitForTransactionReceipt({ hash })).contractAddress
})

describe('CanaryRegistry', () => {
	const caseA = id('case-A')
	const trail1 = id('trail-1')
	const trail2 = id('trail-2')

	it('deploys with the forwarder, relayer and owner set', async () => {
		assert.equal((await read('owner')).toLowerCase(), owner.toLowerCase())
		assert.equal(await read('isForwarder', [FORWARDER]), true)
		assert.equal(await read('isRelayer', [relayer]), true)
		assert.equal(await read('isForwarder', [stranger]), false)
	})

	it('supports IReceiver (0x805f2132) and IERC165 (0x01ffc9a7) via ERC-165', async () => {
		assert.equal(await read('supportsInterface', ['0x805f2132']), true)
		assert.equal(await read('supportsInterface', ['0x01ffc9a7']), true)
		assert.equal(await read('supportsInterface', ['0xffffffff']), false)
	})

	it('rejects onReport from anyone but an allowed forwarder', async () => {
		await reverts(send(stranger, 'onReport', ['0x', alertReport(caseA, 1, trail1)]), 'NotForwarder')
	})

	it('records an alert from the forwarder', async () => {
		const events = await send(FORWARDER, 'onReport', ['0x', alertReport(caseA, 1, trail1)])
		assert.equal(events.length, 1)
		assert.equal(events[0].eventName, 'AlertRecorded')
		assert.equal(events[0].args.caseId, caseA)
		assert.equal(events[0].args.symbol, 'MOONCAT')
		assert.equal(events[0].args.level, 1)
		assert.equal(events[0].args.promoters, 7)
		const c = await read('getCase', [caseA])
		assert.equal(c.level, 1)
		assert.equal(c.trailHash, trail1)
		assert.ok(c.alertAt > 0n)
		assert.equal(await read('caseCount'), 1n)
	})

	it('ignores a repeated alert (idempotent, no revert, no event)', async () => {
		const events = await send(FORWARDER, 'onReport', ['0x', alertReport(caseA, 1, trail1)])
		assert.equal(events.length, 0)
	})

	it('records an escalation and never lowers the level', async () => {
		let events = await send(FORWARDER, 'onReport', ['0x', alertReport(caseA, 2, trail2, 'MOONCAT', zeroAddress, 9)])
		assert.equal(events[0].eventName, 'AlertRecorded')
		events = await send(FORWARDER, 'onReport', ['0x', alertReport(caseA, 1, id('trail-3'))])
		assert.equal(events[0].eventName, 'AlertRecorded')
		const [level, trail, collapsed] = await read('statusOf', [caseA])
		assert.equal(level, 2)
		assert.equal(trail, id('trail-3'))
		assert.equal(collapsed, false)
		assert.equal(await read('caseCount'), 1n)
	})

	it('records a collapse once', async () => {
		let events = await send(FORWARDER, 'onReport', ['0x', collapseReport(caseA, 100_000_000n, 10_000_000n, 9000)])
		assert.equal(events.length, 1)
		assert.equal(events[0].eventName, 'CollapseRecorded')
		assert.equal(events[0].args.dropBps, 9000)
		assert.equal(events[0].args.liquidityBefore, 100_000_000n)
		const c = await read('getCase', [caseA])
		assert.equal(c.level, 3)
		assert.ok(c.collapsedAt > 0n)
		events = await send(FORWARDER, 'onReport', ['0x', collapseReport(caseA, 1n, 0n, 10_000)])
		assert.equal(events.length, 0)
	})

	it('rejects bad reports', async () => {
		await reverts(send(FORWARDER, 'onReport', ['0x', alertReport(caseA, 4, trail1)]), 'InvalidLevel')
		await reverts(send(FORWARDER, 'onReport', ['0x', alertReport(caseA, 0, trail1)]), 'InvalidLevel')
		await reverts(
			send(FORWARDER, 'onReport', ['0x', alertReport(`0x${'00'.repeat(32)}`, 1, trail1)]),
			'InvalidCaseId',
		)
		await reverts(send(FORWARDER, 'onReport', ['0x', collapseReport(caseA, 1n, 0n, 10_001)]), 'InvalidDrop')
		await reverts(
			send(FORWARDER, 'onReport', ['0x', encodeAbiParameters(Envelope, [9, '0x'])]),
			'UnknownReportKind',
		)
	})

	it('anchors a victim claim from the relayer, once per evidence file', async () => {
		const evidence = id('evidence-file-sha256')
		const claimant = id('salt|claimant-123')
		const events = await send(relayer, 'anchorClaim', [caseA, evidence, claimant])
		assert.equal(events[0].eventName, 'ClaimAnchored')
		assert.equal(events[0].args.evidenceHash, evidence)
		assert.equal(events[0].args.claimantRef, claimant)
		assert.equal(await read('isClaimAnchored', [caseA, evidence]), true)
		assert.equal((await read('getCase', [caseA])).claimCount, 1)
		await reverts(send(relayer, 'anchorClaim', [caseA, evidence, claimant]), 'ClaimAlreadyAnchored')
	})

	it('lets the owner anchor, and blocks strangers', async () => {
		const caseB = id('case-B')
		const events = await send(owner, 'anchorClaim', [caseB, id('ev-2'), id('ref-2')])
		assert.equal(events[0].eventName, 'ClaimAnchored')
		assert.equal(await read('caseCount'), 2n)
		await reverts(send(stranger, 'anchorClaim', [caseB, id('ev-3'), id('ref-3')]), 'NotRelayer')
		await reverts(send(relayer, 'anchorClaim', [caseB, `0x${'00'.repeat(32)}`, id('ref-3')]), 'InvalidEvidenceHash')
	})

	it('admin functions are owner-only; forwarder can be revoked', async () => {
		await reverts(send(stranger, 'setForwarder', [stranger, true]), 'NotOwner')
		await reverts(send(stranger, 'setRelayer', [stranger, true]), 'NotOwner')
		await send(owner, 'setForwarder', [FORWARDER, false])
		await reverts(send(FORWARDER, 'onReport', ['0x', alertReport(id('case-C'), 1, trail1)]), 'NotForwarder')
		await send(owner, 'setForwarder', [FORWARDER, true])
	})

	it('optionally pins reports to one workflow via metadata', async () => {
		const workflowId = id('workflow')
		const workflowOwner = '0x00000000000000000000000000000000000000AA'
		await send(owner, 'setExpectedWorkflow', [workflowId, workflowOwner])
		// 64-byte production layout: workflowId(32) | name(10) | owner(20) | reportId(2)
		const good = `${workflowId}${'11'.repeat(10)}${workflowOwner.slice(2).toLowerCase()}0001`
		const bad = `${id('other')}${'11'.repeat(10)}${workflowOwner.slice(2).toLowerCase()}0001`
		await reverts(send(FORWARDER, 'onReport', [bad, alertReport(id('case-D'), 1, trail1)]), 'WrongWorkflow')
		await reverts(send(FORWARDER, 'onReport', ['0x', alertReport(id('case-D'), 1, trail1)]), 'WrongWorkflow')
		const events = await send(FORWARDER, 'onReport', [good, alertReport(id('case-D'), 1, trail1)])
		assert.equal(events[0].eventName, 'AlertRecorded')
		await send(owner, 'setExpectedWorkflow', [`0x${'00'.repeat(32)}`, zeroAddress])
	})

	it('two-step ownership transfer', async () => {
		await send(owner, 'transferOwnership', [relayer])
		await reverts(send(stranger, 'acceptOwnership', []), 'NotPendingOwner')
		await send(relayer, 'acceptOwnership', [])
		assert.equal((await read('owner')).toLowerCase(), relayer.toLowerCase())
		await send(relayer, 'transferOwnership', [owner])
		await send(owner, 'acceptOwnership', [])
	})

	it('accepts the exact report bytes produced by the canary-watch workflow', { skip: !existsSync(generatedPath) }, async () => {
		const g = JSON.parse(readFileSync(generatedPath, 'utf8'))
		let events = await send(FORWARDER, 'onReport', ['0x', g.alert])
		assert.equal(events[0].eventName, 'AlertRecorded')
		assert.equal(events[0].args.caseId, g.snapshot.caseId)
		assert.equal(events[0].args.symbol, g.snapshot.symbol)
		assert.equal(events[0].args.level, g.snapshot.level)
		assert.equal(events[0].args.promoters, g.snapshot.promoters)
		assert.equal(events[0].args.trailHash, g.snapshot.trailHash)
		events = await send(FORWARDER, 'onReport', ['0x', g.collapse])
		assert.equal(events[0].eventName, 'CollapseRecorded')
		assert.equal(events[0].args.liquidityBefore, BigInt(Math.round(g.snapshot.liquidityBeforeUsd * 100)))
		assert.equal(events[0].args.dropBps, 9000)
		const [level, , collapsed] = await read('statusOf', [g.snapshot.caseId])
		assert.equal(level, 3)
		assert.equal(collapsed, true)
	})
})
