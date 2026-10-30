// Compile CanaryRegistry.sol with solc-js and write ABI + bytecode to contracts/out/.
//   node compile.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import solc from 'solc'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'CanaryRegistry.sol'), 'utf8')

const input = {
	language: 'Solidity',
	sources: { 'CanaryRegistry.sol': { content: source } },
	settings: {
		optimizer: { enabled: true, runs: 200 },
		// "shanghai" runs on Sepolia/mainnet and on the local ganache test chain.
		evmVersion: 'shanghai',
		outputSelection: { '*': { CanaryRegistry: ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
	},
}

const output = JSON.parse(solc.compile(JSON.stringify(input)))
const problems = output.errors ?? []
for (const e of problems) console[e.severity === 'error' ? 'error' : 'warn'](e.formattedMessage)
if (problems.some((e) => e.severity === 'error')) process.exit(1)

const c = output.contracts['CanaryRegistry.sol'].CanaryRegistry
const outDir = join(here, 'out')
mkdirSync(outDir, { recursive: true })
const artifact = {
	contractName: 'CanaryRegistry',
	compiler: `solc ${solc.version()}`,
	evmVersion: input.settings.evmVersion,
	optimizer: input.settings.optimizer,
	abi: c.abi,
	bytecode: `0x${c.evm.bytecode.object}`,
	deployedBytecode: `0x${c.evm.deployedBytecode.object}`,
}
writeFileSync(join(outDir, 'CanaryRegistry.json'), `${JSON.stringify(artifact, null, 2)}\n`)
writeFileSync(join(outDir, 'CanaryRegistry.abi.json'), `${JSON.stringify(c.abi, null, 2)}\n`)
writeFileSync(join(outDir, 'CanaryRegistry.bin'), `0x${c.evm.bytecode.object}\n`)
console.log(
	`Compiled CanaryRegistry with solc ${solc.version()} -> out/ (runtime ${c.evm.deployedBytecode.object.length / 2} bytes)`,
)
