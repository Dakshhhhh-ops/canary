// Chainlink Data Feed (AggregatorV3Interface): used to price the pool's quote token (e.g. WETH) in USD.
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
