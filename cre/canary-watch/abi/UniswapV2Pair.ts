// Minimal Uniswap V2 pair ABI: just what canary-watch reads to confirm liquidity on-chain.
export const UniswapV2Pair = [
	{
		type: 'function',
		name: 'token0',
		inputs: [],
		outputs: [{ name: '', type: 'address' }],
		stateMutability: 'view',
	},
	{
		type: 'function',
		name: 'token1',
		inputs: [],
		outputs: [{ name: '', type: 'address' }],
		stateMutability: 'view',
	},
	{
		type: 'function',
		name: 'getReserves',
		inputs: [],
		outputs: [
			{ name: 'reserve0', type: 'uint112' },
			{ name: 'reserve1', type: 'uint112' },
			{ name: 'blockTimestampLast', type: 'uint32' },
		],
		stateMutability: 'view',
	},
] as const
