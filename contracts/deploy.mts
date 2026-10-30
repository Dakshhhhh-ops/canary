// Deploy CanaryRegistry to Ethereum Sepolia with viem.
//
//   cd contracts
//   npm run compile
//   SEPOLIA_RPC_URL=https://... DEPLOYER_PRIVATE_KEY=0x... node deploy.mts
//
// Optional env:
//   CANARY_FORWARDERS = simulation (default) | production | both
//   CANARY_RELAYER    = address allowed to call anchorClaim (default: the deployer)
//   DRY_RUN=1         = print what would be deployed, send nothing
//
// Forwarder addresses come from the Chainlink CRE Forwarder Directory
// https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts
//   Ethereum Sepolia (chain name "ethereum-testnet-sepolia"):
//     MockKeystoneForwarder (used by `cre workflow simulate --broadcast`) 0x15fC6ae953E024d975e77382eEeC56A9101f9F88
//     KeystoneForwarder     (used by deployed workflows)                0xF8344CFd5c43616a4366C34E3EEE75af79a74482
//
// Security note: the simulation MockForwarder does not verify DON signatures, so anyone could relay a
// report through it. It is fine for the hackathon demo; once the workflow is deployed for real, run
// setForwarder(<mock>, false) (or redeploy with CANARY_FORWARDERS=production) and setExpectedWorkflow(...).
//
// Node 24 runs this .mts file directly (built-in type stripping), no build step needed.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Address, createPublicClient, createWalletClient, getAddress, type Hex, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'

const SEPOLIA_MOCK_FORWARDER: Address = '0x15fC6ae953E024d975e77382eEeC56A9101f9F88'
const SEPOLIA_KEYSTONE_FORWARDER: Address = '0xF8344CFd5c43616a4366C34E3EEE75af79a74482'

const here = dirname(fileURLToPath(import.meta.url))
const artifactPath = join(here, 'out', 'CanaryRegistry.json')
let artifact: { abi: unknown[]; bytecode: Hex }
try {
	artifact = JSON.parse(readFileSync(artifactPath, 'utf8'))
} catch {
	console.error(`Missing ${artifactPath}. Run "npm run compile" first.`)
	process.exit(1)
}

const mode = (process.env.CANARY_FORWARDERS ?? 'simulation').toLowerCase()
const forwarders: Address[] =
	mode === 'production'
		? [SEPOLIA_KEYSTONE_FORWARDER]
		: mode === 'both'
			? [SEPOLIA_MOCK_FORWARDER, SEPOLIA_KEYSTONE_FORWARDER]
			: mode === 'simulation'
				? [SEPOLIA_MOCK_FORWARDER]
				: (() => {
						console.error(`CANARY_FORWARDERS must be simulation | production | both (got "${mode}")`)
						process.exit(1)
					})()

const rpcUrl = process.env.SEPOLIA_RPC_URL
const rawKey = process.env.DEPLOYER_PRIVATE_KEY
const dryRun = process.env.DRY_RUN === '1'

if (!rawKey || !rpcUrl) {
	if (!dryRun) {
		console.error('Set SEPOLIA_RPC_URL and DEPLOYER_PRIVATE_KEY (or DRY_RUN=1 to preview).')
		process.exit(1)
	}
}

const account = rawKey ? privateKeyToAccount((rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as Hex) : undefined
const relayer: Address = process.env.CANARY_RELAYER
	? getAddress(process.env.CANARY_RELAYER)
	: (account?.address ?? '0x0000000000000000000000000000000000000000')

console.log('CanaryRegistry deployment')
console.log(`  network     : Ethereum Sepolia (chainId ${sepolia.id})`)
console.log(`  deployer    : ${account?.address ?? '(no key set)'}`)
console.log(`  forwarders  : ${forwarders.join(', ')}  [mode=${mode}]`)
console.log(`  relayer     : ${relayer}`)

if (dryRun) {
	console.log('DRY_RUN=1: nothing sent.')
	process.exit(0)
}

const transport = http(rpcUrl)
const publicClient = createPublicClient({ chain: sepolia, transport })
const walletClient = createWalletClient({ account: account!, chain: sepolia, transport })

const chainId = await publicClient.getChainId()
if (chainId !== sepolia.id) {
	console.error(`SEPOLIA_RPC_URL points at chainId ${chainId}, expected ${sepolia.id}`)
	process.exit(1)
}
const balance = await publicClient.getBalance({ address: account!.address })
console.log(`  balance     : ${Number(balance) / 1e18} ETH`)
if (balance === 0n) {
	console.error('Deployer has no Sepolia ETH. Get some at https://faucets.chain.link/sepolia')
	process.exit(1)
}

const hash = await walletClient.deployContract({
	abi: artifact.abi,
	bytecode: artifact.bytecode,
	args: [forwarders, relayer],
})
console.log(`  tx          : ${hash}`)
const receipt = await publicClient.waitForTransactionReceipt({ hash })
if (receipt.status !== 'success' || !receipt.contractAddress) {
	console.error('Deployment failed', receipt)
	process.exit(1)
}

const record = {
	network: 'ethereum-testnet-sepolia',
	chainId,
	address: receipt.contractAddress,
	txHash: hash,
	blockNumber: receipt.blockNumber.toString(),
	deployer: account!.address,
	forwarders,
	relayer,
	deployedAt: new Date().toISOString(),
}
mkdirSync(join(here, 'out'), { recursive: true })
writeFileSync(join(here, 'out', 'deployment.sepolia.json'), `${JSON.stringify(record, null, 2)}\n`)
console.log(`\nDeployed CanaryRegistry at ${receipt.contractAddress}`)
console.log(`  https://sepolia.etherscan.io/address/${receipt.contractAddress}`)
console.log('Next: put this address in cre/canary-watch/config.*.json -> registry.address')
