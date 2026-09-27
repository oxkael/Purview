import { createPublicClient, http, type Address, type Hex } from 'viem'
import { configuredContracts, longbowNvdaUsdgMarket, robinhoodMainnet, serverConfig } from '../config.js'

const client = createPublicClient({
  chain: robinhoodMainnet,
  transport: http(undefined, { timeout: serverConfig.rpcTimeoutMs, retryCount: 0 }),
})

const marketParamsAbi = [{
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
}] as const

type MarketStatus = 'available' | 'unavailable' | 'blocked' | 'not_checked'

function sameAddress(actual: Address, expected: Address): boolean {
  return actual.toLowerCase() === expected.toLowerCase()
}

export async function getLongbowMarketStatus(): Promise<{
  status: MarketStatus
  marketId: Hex
  expectedLltvWad: string
  actual?: {
    loanToken: Address
    collateralToken: Address
    oracle: Address
    irm: Address
    lltvWad: string
  }
  detail: string
}> {
  try {
    const actual = await client.readContract({
      address: configuredContracts.morphoBlue,
      abi: marketParamsAbi,
      functionName: 'idToMarketParams',
      args: [longbowNvdaUsdgMarket.id],
    })

    const matches =
      sameAddress(actual.loanToken, longbowNvdaUsdgMarket.loanToken) &&
      sameAddress(actual.collateralToken, longbowNvdaUsdgMarket.collateralToken) &&
      sameAddress(actual.oracle, longbowNvdaUsdgMarket.oracle) &&
      sameAddress(actual.irm, longbowNvdaUsdgMarket.irm) &&
      actual.lltv === longbowNvdaUsdgMarket.lltvWad

    return {
      status: matches ? 'available' : 'blocked',
      marketId: longbowNvdaUsdgMarket.id,
      expectedLltvWad: longbowNvdaUsdgMarket.lltvWad.toString(),
      actual: {
        loanToken: actual.loanToken,
        collateralToken: actual.collateralToken,
        oracle: actual.oracle,
        irm: actual.irm,
        lltvWad: actual.lltv.toString(),
      },
      detail: matches
        ? 'Official Longbow and Morpho market parameters match the deployed Morpho Blue contract.'
        : 'On-chain Morpho Blue parameters do not match the official Longbow/Morpho market record; use is blocked.',
    }
  } catch (error) {
    return {
      status: 'unavailable',
      marketId: longbowNvdaUsdgMarket.id,
      expectedLltvWad: longbowNvdaUsdgMarket.lltvWad.toString(),
      detail: error instanceof Error ? error.message : 'Unknown RPC error while reading market parameters.',
    }
  }
}
