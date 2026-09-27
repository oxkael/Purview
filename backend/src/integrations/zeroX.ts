import { getAddress, type Address } from 'viem'
import { configuredContracts, robinhoodMainnet, serverConfig } from '../config.js'

const ZEROX_QUOTE_URL = 'https://api.0x.org/swap/allowance-holder/quote'
const ZEROX_PRICE_URL = 'https://api.0x.org/swap/allowance-holder/price'
const ZEROX_TIMEOUT_MS = 15_000

export class ZeroXError extends Error {
  constructor(message: string, readonly statusCode = 502) {
    super(message)
    this.name = 'ZeroXError'
  }
}

async function requestNvdaToUsdg(sellAmountRaw: string, taker: Address | undefined, mode: 'price' | 'quote') {
  if (!serverConfig.zeroXApiKey) {
    throw new ZeroXError('ZEROX_API_KEY is not configured.', 503)
  }
  if (!/^\d+$/.test(sellAmountRaw) || BigInt(sellAmountRaw) <= 0n) {
    throw new ZeroXError('sellAmountRaw must be a positive integer token amount in base units.', 400)
  }

  const params = new URLSearchParams({
    chainId: String(robinhoodMainnet.id),
    sellToken: configuredContracts.nvda,
    buyToken: configuredContracts.usdg,
    sellAmount: sellAmountRaw,
  })
  if (taker) params.set('taker', taker)

  let response: Response
  try {
    const endpoint = mode === 'price' ? ZEROX_PRICE_URL : ZEROX_QUOTE_URL
    response = await fetch(`${endpoint}?${params}`, {
      headers: {
        '0x-api-key': serverConfig.zeroXApiKey,
        '0x-version': 'v2',
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(ZEROX_TIMEOUT_MS),
    })
  } catch (error) {
    const detail = error instanceof Error && error.name === 'TimeoutError'
      ? '0x quote request timed out.'
      : 'Could not reach the 0x Swap API.'
    throw new ZeroXError(detail, 502)
  }

  const payload: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const apiMessage = payload && typeof payload === 'object' && 'reason' in payload && typeof payload.reason === 'string'
      ? payload.reason
      : payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
        ? payload.message
        : `0x returned HTTP ${response.status}.`
    const restricted = response.status === 403 || /not authorized for trade|legal restriction/i.test(apiMessage)
    throw new ZeroXError(`0x ${mode} failed: ${apiMessage}`, restricted ? 403 : 502)
  }
  if (!payload || typeof payload !== 'object') {
    throw new ZeroXError('0x returned an invalid response.', 502)
  }
  if (mode === 'quote' && (!('buyAmount' in payload) || typeof payload.buyAmount !== 'string')) {
    throw new ZeroXError('0x returned a successful firm-quote response without a valid buyAmount.', 502)
  }

  // Return the provider response as received. This is pricing/quote data, not
  // evidence that the transaction is safe, simulated, signed, or executed.
  return {
    status: mode === 'price' ? 'priced' as const : 'quoted' as const,
    source: `0x Swap API v2 ${mode}`,
    chainId: robinhoodMainnet.id,
    sellToken: configuredContracts.nvda,
    buyToken: configuredContracts.usdg,
    sellAmountRaw,
    ...(taker ? { taker } : {}),
    retrievedAt: new Date().toISOString(),
    executionValidated: false as const,
    result: payload,
  }
}

export function getNvdaToUsdgPrice(sellAmountRaw: string, taker?: Address) {
  return requestNvdaToUsdg(sellAmountRaw, taker, 'price')
}

export function getNvdaToUsdgQuote(sellAmountRaw: string, taker: Address) {
  return requestNvdaToUsdg(sellAmountRaw, taker, 'quote')
}

export function parseTakerAddress(rawAddress: string): Address | undefined {
  if (!/^0x[0-9a-fA-F]{40}$/.test(rawAddress)) return undefined
  try {
    return getAddress(rawAddress)
  } catch {
    return undefined
  }
}
