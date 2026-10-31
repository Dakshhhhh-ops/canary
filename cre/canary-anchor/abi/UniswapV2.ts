// Minimal Uniswap V2 ABIs: the factory finds the token's pool, the pair tells how much money is in it.
export const UniswapV2Factory = [
	{
		type: 'function',
		name: 'getPair',
		inputs: [
			{ name: 'tokenA', type: 'address' },
			{ name: 'tokenB', type: 'address' },
		],
		outputs: [{ name: 'pair', type: 'address' }],
		stateMutability: 'view',
	},
] as const

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

// Chainlink Data Feed (AggregatorV3Interface): prices the pool's quote token (e.g. WETH) in USD.
export const AggregatorV3 = [
	{
		type: 'function',
		name: 'latestRoundData',
		inputs: [],
		outputs: [
			{ name: 'roundId', type: 'uint80' },
			{ name: 'answer', type: 'int256' },
			{ name: 'startedAt', type: 'uint256' },
			{ name: 'updatedAt', type: 'uint256' },
			{ name: 'answeredInRound', type: 'uint80' },
		],
		stateMutability: 'view',
	},
] as const
