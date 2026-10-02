import 'dotenv/config'
import { defineChain, getAddress } from 'viem'

export const mainnetRpcUrl = process.env.ROBINHOOD_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
export const livenessRpcUrl = process.env.ROBINHOOD_LIVENESS_RPC_URL?.trim() ?? ''

export function isLoopbackRpcUrl(rawUrl: string): boolean {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '')
    return hostname === 'localhost' || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(hostname)
  } catch {
    return false
  }
}

export const robinhoodMainnet = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [mainnetRpcUrl] } },
  blockExplorers: {
    default: { name: 'Robinhood Chain Explorer', url: 'https://robinhoodchain.blockscout.com' },
  },
})

// Address presence is configuration, not proof that contracts or markets are usable.
export const configuredContracts = {
  usdg: getAddress('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'),
  nvda: getAddress('0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC'),
  morphoBlue: getAddress('0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010'),
  morphoBlueBundlesV1: getAddress('0x53A1eB6589861F686af7c531211E35Aefe30210f'),
  morphoBluePublicAllocator: getAddress('0xCe5c1aFa115fF8b1D6913509bfc79D9AE08CC857'),
  adaptiveCurveIrm: getAddress('0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1'),
} as const

// Identified by Longbow's official /api/markets record for NVDA / USDG,
// cross-checked against Morpho's official Blue markets API on 2026-09-27.
// The read-only integration-status endpoint verifies these immutable params
// against the deployed Morpho Blue contract before reporting the market live.
export const longbowNvdaUsdgMarket = {
  id: '0x66306c087add8907752320b309934abcc354d21626de8115c79df49d9c214edc',
  loanToken: configuredContracts.usdg,
  collateralToken: configuredContracts.nvda,
  oracle: getAddress('0xC5b8A6C5fDF14f9744dB1C8595f49E42Ce23031a'),
  irm: configuredContracts.adaptiveCurveIrm,
  lltvWad: 625_000_000_000_000_000n,
} as const

export const longbowNvdaUsdgFeed = getAddress('0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15')

// Robinhood Chain Uniswap V3 deployment and pools verified by pinned-block
// RPC reads on 2026-09-28. Keep the fee allowlist explicit; do not accept
// arbitrary fee tiers or V4 routes from callers.
export const uniswapV3 = {
  factory: getAddress('0x1f7d7550b1b028f7571e69a784071f0205fd2efa'),
  quoterV2: getAddress('0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7'),
  swapRouter02: getAddress('0xcaf681a66d020601342297493863e78c959e5cb2'),
  nvdaUsdgPools: [
    { fee: 100, address: getAddress('0xb75d2d02b0ec3de50d32e40a4f1a8dae8acc4333') },
    { fee: 500, address: getAddress('0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3') },
    { fee: 3000, address: getAddress('0xb944cec30bd4175855215d767adc81f39e5f7e2b') },
  ],
} as const

// Temporary quote-quality tolerance approved by the product owner on
// 2026-09-29: allow up to 2% worse effective price than the best eligible
// 0.01 NVDA reference quote. Oracle deviation and execution slippage limits
// remain unchanged.
export const uniswapReferenceToleranceBps = 200n

function optionalInteger(name: string, min: number, max = Number.MAX_SAFE_INTEGER): number | undefined {
  const raw = process.env[name]?.trim()
  if (!raw) return undefined
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`)
  }
  return value
}

const configuredNvdaHeartbeatSeconds = optionalInteger(
  'NVDA_ORACLE_HEARTBEAT_SECONDS', 1, Number.MAX_SAFE_INTEGER - 60,
)
const configuredClosedSellMaxAgeSeconds = optionalInteger('NVDA_ORACLE_CLOSED_SELL_MAX_AGE_SECONDS', 1)
const configuredHolidaySellMaxAgeSeconds = optionalInteger('NVDA_ORACLE_HOLIDAY_SELL_MAX_AGE_SECONDS', 1)
// Product owner approved temporary use of the online-reported 1-hour value
// on 2026-09-28. This is not Chainlink-confirmed for Robinhood Chain.
const provisionalNvdaHeartbeatSeconds = 3_600
// Product owner approved these provisional policy bounds from supplied research.
// They are not numeric recommendations published by Chainlink.
const provisionalNvdaClosedSellMaxAgeSeconds = 259_200
const provisionalNvdaHolidaySellMaxAgeSeconds = 345_600

export const serverConfig = {
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 3001),
  rpcTimeoutMs: 5_000,
  livenessPolicy: {
    maxBlockAgeSeconds: optionalInteger('ROBINHOOD_MAX_BLOCK_AGE_SECONDS', 1) ?? 60,
    maxHeadTimestampSkewSeconds: optionalInteger('ROBINHOOD_MAX_HEAD_SKEW_SECONDS', 1) ?? 30,
  },
  zeroXApiKey: process.env.ZEROX_API_KEY?.trim() ?? '',
  riskPolicy: {
    // Set only to the exact feed-specific heartbeat confirmed by Chainlink.
    // The approved freshness window is that heartbeat plus 60 seconds.
    nvdaOracleHeartbeatSeconds: configuredNvdaHeartbeatSeconds ?? provisionalNvdaHeartbeatSeconds,
    nvdaOracleHeartbeatProvisional: configuredNvdaHeartbeatSeconds === undefined,
    nvdaOracleClosedSellMaxAgeSeconds: configuredClosedSellMaxAgeSeconds ?? provisionalNvdaClosedSellMaxAgeSeconds,
    nvdaOracleClosedSellMaxAgeProvisional: configuredClosedSellMaxAgeSeconds === undefined,
    nvdaOracleHolidaySellMaxAgeSeconds: configuredHolidaySellMaxAgeSeconds ?? provisionalNvdaHolidaySellMaxAgeSeconds,
    nvdaOracleHolidaySellMaxAgeProvisional: configuredHolidaySellMaxAgeSeconds === undefined,
    nvdaOracleMaxAgeSeconds: undefined as number | undefined,
  },
}
serverConfig.riskPolicy.nvdaOracleMaxAgeSeconds = serverConfig.riskPolicy.nvdaOracleHeartbeatSeconds + 60

if (!Number.isInteger(serverConfig.port) || serverConfig.port < 1 || serverConfig.port > 65_535) {
  throw new Error('PORT must be an integer between 1 and 65535')
}
