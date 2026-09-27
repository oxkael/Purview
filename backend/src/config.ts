import 'dotenv/config'
import { defineChain, getAddress } from 'viem'

const mainnetRpcUrl = process.env.ROBINHOOD_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'

export const robinhoodMainnet = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [mainnetRpcUrl] } },
  blockExplorers: {
    default: { name: 'Robinhood Chain Explorer', url: 'https://robinhoodchain.blockscout.com' },
  },
})

// Addresses below are transcribed from backend.md. Their presence here is
// configuration, not proof that the contracts or markets are usable.
export const configuredContracts = {
  usdg: getAddress('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'),
  nvda: getAddress('0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC'),
  morphoBlue: getAddress('0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010'),
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

export const serverConfig = {
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 3001),
  rpcTimeoutMs: 5_000,
}

if (!Number.isInteger(serverConfig.port) || serverConfig.port < 1 || serverConfig.port > 65_535) {
  throw new Error('PORT must be an integer between 1 and 65535')
}
