import { createPublicClient, http, type Address } from 'viem'
import { configuredContracts, longbowNvdaUsdgFeed, longbowNvdaUsdgMarket, robinhoodMainnet, serverConfig } from '../config.js'

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
    const age = latestBlock.timestamp >= round.updatedAt ? latestBlock.timestamp - round.updatedAt : null
    const ageSeconds = age?.toString() ?? null
    const feedIdentityValid = expectedFeed.toLowerCase() === longbowNvdaUsdgFeed.toLowerCase() && description === 'RHNVDA / USD' && decimals === 8
    const roundDataValid = oraclePrice > 0n && round.answer > 0n && round.updatedAt > 0n && round.answeredInRound >= round.roundId && age !== null
    const maxAgeSeconds = serverConfig.riskPolicy.nvdaOracleMaxAgeSeconds
    const freshnessStatus = maxAgeSeconds === undefined || age === null
      ? 'unassessed' as const
      : age <= BigInt(maxAgeSeconds) ? 'fresh' as const : 'stale' as const
    const oracleUsable = feedIdentityValid && roundDataValid && freshnessStatus === 'fresh'

    return {
      status: !feedIdentityValid || !roundDataValid ? 'unavailable' as const : oracleUsable ? 'available' as const : 'blocked' as const,
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
        status: freshnessStatus,
        heartbeatSeconds: serverConfig.riskPolicy.nvdaOracleHeartbeatSeconds,
        provisional: serverConfig.riskPolicy.nvdaOracleHeartbeatProvisional,
        source: serverConfig.riskPolicy.nvdaOracleHeartbeatProvisional
          ? 'Product-owner-approved online-reported value; not Chainlink-confirmed for Robinhood Chain.'
          : 'Configured Chainlink-confirmed feed heartbeat.',
        maxAgeSeconds: maxAgeSeconds ?? null,
        closedMarketSellOnly: {
          status: age === null ? 'invalid' as const
            : age <= BigInt(serverConfig.riskPolicy.nvdaOracleClosedSellMaxAgeSeconds) ? 'within_limit' as const : 'stale' as const,
          maxAgeSeconds: serverConfig.riskPolicy.nvdaOracleClosedSellMaxAgeSeconds,
          maxAgeForThreeDayHolidayWeekendSeconds: serverConfig.riskPolicy.nvdaOracleHolidaySellMaxAgeSeconds,
          provisional: serverConfig.riskPolicy.nvdaOracleClosedSellMaxAgeProvisional
            || serverConfig.riskPolicy.nvdaOracleHolidaySellMaxAgeProvisional,
          detail: 'These closed-market sell-only age bounds are provisional product policy. The session-aware planner applies the relevant bound only after Nasdaq confirms a closed session; closed status never permits borrow or hybrid.',
        },
        detail: maxAgeSeconds === undefined
          ? 'Feed-specific maximum age is not configured; a valid-looking round is not treated as fresh.'
          : age === null
            ? 'Feed timestamp is later than the latest chain block timestamp.'
            : freshnessStatus === 'fresh'
              ? `Round age ${ageSeconds}s is within heartbeat ${serverConfig.riskPolicy.nvdaOracleHeartbeatSeconds}s plus 60s (${maxAgeSeconds}s maximum).${serverConfig.riskPolicy.nvdaOracleHeartbeatProvisional ? ' This heartbeat is provisional.' : ''}`
              : `Round age ${ageSeconds}s exceeds heartbeat ${serverConfig.riskPolicy.nvdaOracleHeartbeatSeconds}s plus 60s (${maxAgeSeconds}s maximum).${serverConfig.riskPolicy.nvdaOracleHeartbeatProvisional ? ' This heartbeat is provisional.' : ''}`,
      },
      detail: !feedIdentityValid
        ? 'Oracle feed address, description, or decimals do not match the verified RHNVDA / USD feed.'
        : !roundDataValid
          ? 'Oracle round data failed basic validity checks.'
          : oracleUsable
            ? 'Verified feed identity and round satisfy the configured freshness policy.'
            : 'Feed identity and round are valid, but freshness policy is unconfigured or the round is stale.',
    }
  } catch (error) {
    return {
      status: 'unavailable' as const,
      detail: error instanceof Error ? error.message : 'Unknown RPC error while reading the market oracle.',
    }
  }
}
