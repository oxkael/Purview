import { createPublicClient, http, type Address } from 'viem'
import { configuredContracts, longbowNvdaUsdgMarket, robinhoodMainnet, serverConfig } from '../config.js'

const client = createPublicClient({
  chain: robinhoodMainnet,
  transport: http(undefined, { timeout: serverConfig.rpcTimeoutMs, retryCount: 0 }),
})

const oracleAbi = [{
  type: 'function',
  name: 'BASE_FEED_1',
  stateMutability: 'view',
  inputs: [],
  outputs: [{ name: '', type: 'address' }],
}, {
  type: 'function',
  name: 'BASE_FEED_2',
  stateMutability: 'view',
  inputs: [],
  outputs: [{ name: '', type: 'address' }],
}, {
  type: 'function',
  name: 'price',
  stateMutability: 'view',
  inputs: [],
  outputs: [{ name: '', type: 'uint256' }],
}] as const

const aggregatorAbi = [{
  type: 'function',
  name: 'description',
  stateMutability: 'view',
  inputs: [],
  outputs: [{ name: '', type: 'string' }],
}, {
  type: 'function',
  name: 'decimals',
  stateMutability: 'view',
  inputs: [],
  outputs: [{ name: '', type: 'uint8' }],
}, {
  type: 'function',
  name: 'latestRoundData',
  stateMutability: 'view',
  inputs: [],
  outputs: [{
    name: '',
    type: 'tuple',
    components: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  }],
}] as const

const zeroAddress = '0x0000000000000000000000000000000000000000'

export async function getLongbowOracleStatus() {
  try {
    const [configuredOracle, expectedFeed, secondFeed, oraclePrice] = await Promise.all([
      client.readContract({
        address: configuredContracts.morphoBlue,
        abi: [{
          type: 'function',
          name: 'idToMarketParams',
          stateMutability: 'view',
          inputs: [{ name: 'id', type: 'bytes32' }],
          outputs: [{
            name: 'marketParams',
            type: 'tuple',
            components: [
              { name: 'loanToken', type: 'address' },
              { name: 'collateralToken', type: 'address' },
              { name: 'oracle', type: 'address' },
              { name: 'irm', type: 'address' },
              { name: 'lltv', type: 'uint256' },
            ],
          }],
        }] as const,
        functionName: 'idToMarketParams',
        args: [longbowNvdaUsdgMarket.id],
      }).then((params) => params.oracle),
      client.readContract({ address: longbowNvdaUsdgMarket.oracle, abi: oracleAbi, functionName: 'BASE_FEED_1' }),
      client.readContract({ address: longbowNvdaUsdgMarket.oracle, abi: oracleAbi, functionName: 'BASE_FEED_2' }),
      client.readContract({ address: longbowNvdaUsdgMarket.oracle, abi: oracleAbi, functionName: 'price' }),
    ])

    if (configuredOracle.toLowerCase() !== longbowNvdaUsdgMarket.oracle.toLowerCase()) {
      return {
        status: 'blocked' as const,
        oracle: configuredOracle,
        detail: 'Market oracle no longer matches the configured official market record.',
      }
    }

    if (expectedFeed.toLowerCase() === zeroAddress || secondFeed.toLowerCase() !== zeroAddress) {
      return {
        status: 'blocked' as const,
        oracle: configuredOracle,
        priceRaw: oraclePrice.toString(),
        detail: 'Oracle feed layout differs from the one-feed configuration this diagnostic expects.',
      }
    }

    const [description, decimals, round, latestBlockNumber] = await Promise.all([
      client.readContract({ address: expectedFeed, abi: aggregatorAbi, functionName: 'description' }),
      client.readContract({ address: expectedFeed, abi: aggregatorAbi, functionName: 'decimals' }),
      client.readContract({ address: expectedFeed, abi: aggregatorAbi, functionName: 'latestRoundData' }),
      client.getBlockNumber(),
    ])
    const latestBlock = await client.getBlock({ blockNumber: latestBlockNumber })
    const ageSeconds = latestBlock.timestamp >= round.updatedAt
      ? (latestBlock.timestamp - round.updatedAt).toString()
      : null
    const roundDataValid = round.answer > 0n && round.updatedAt > 0n && round.answeredInRound >= round.roundId

    return {
      status: roundDataValid ? 'blocked' as const : 'unavailable' as const,
      oracle: configuredOracle,
      priceRaw: oraclePrice.toString(),
      feed: {
        address: expectedFeed as Address,
        description,
        decimals,
        roundId: round.roundId.toString(),
        answer: round.answer.toString(),
        updatedAt: round.updatedAt.toString(),
        ageSeconds,
        answeredInRound: round.answeredInRound.toString(),
      },
      freshness: {
        status: 'unassessed' as const,
        detail: 'Feed-specific maximum age is not configured; a valid-looking round is not being treated as fresh.',
      },
      detail: roundDataValid
        ? 'Feed and oracle calls succeeded. Execution remains blocked until feed identity and maximum-age policy are validated.'
        : 'Oracle round data failed basic validity checks.',
    }
  } catch (error) {
    return {
      status: 'unavailable' as const,
      detail: error instanceof Error ? error.message : 'Unknown RPC error while reading the market oracle.',
    }
  }
}
