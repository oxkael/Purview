import { uniswapV3 } from './config.js'

type Candidate = {
  kind: 'SELL' | 'BORROW' | 'HYBRID'
  targetUsdgRaw: string
  soldNvdaRaw: string
  suppliedNvdaRaw: string
  borrowedUsdgRaw: string
  swapQuotedOutUsdgRaw: string
  swapFeeTier: number | null
  swapPool: string | null
  slippageBps: string
  constraints: Record<string, boolean>
}

const OPEN_MARKET_MAX_AGE_SECONDS = 3_660
const CLOSED_SELL_MAX_AGE_SECONDS = 72 * 60 * 60
const HOLIDAY_SELL_MAX_AGE_SECONDS = 96 * 60 * 60
const DEADLINE_WINDOW_SECONDS = 90
const BPS = 10_000n

function uint(value: string, label: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`Selected candidate has invalid ${label}.`)
  return BigInt(value)
}

function parseCandidate(value: unknown): Candidate {
  if (!value || typeof value !== 'object') throw new Error('No selected plan candidate is available.')
  const candidate = value as Partial<Candidate>
  if (!['SELL', 'BORROW', 'HYBRID'].includes(candidate.kind ?? '')) throw new Error('Selected candidate has an unsupported plan kind.')
  if (!candidate.constraints || Object.values(candidate.constraints).some((passed) => passed !== true)) {
    throw new Error('Selected candidate does not pass every deterministic numeric constraint.')
  }
  for (const field of ['targetUsdgRaw', 'soldNvdaRaw', 'suppliedNvdaRaw', 'borrowedUsdgRaw', 'swapQuotedOutUsdgRaw', 'slippageBps'] as const) {
    if (typeof candidate[field] !== 'string') throw new Error(`Selected candidate is missing ${field}.`)
    uint(candidate[field], field)
  }
  return candidate as Candidate
}

function assertAllowlistedRoute(candidate: Candidate): { fee: number; pool: string } {
  if (candidate.swapFeeTier === null || candidate.swapPool === null) throw new Error('Swap candidate is missing its quoted Uniswap route.')
  const pool = uniswapV3.nvdaUsdgPools.find((allowed) => allowed.fee === candidate.swapFeeTier)
  if (!pool || pool.address.toLowerCase() !== candidate.swapPool.toLowerCase()) {
    throw new Error('Quoted Uniswap pool and fee tier do not match the configured allowlist.')
  }
  return { fee: pool.fee, pool: pool.address }
}

function amountOutMinimum(candidate: Candidate): string {
  const quoted = uint(candidate.swapQuotedOutUsdgRaw, 'swapQuotedOutUsdgRaw')
  const slippageBps = uint(candidate.slippageBps, 'slippageBps')
  if (quoted <= 0n || slippageBps > 100n) throw new Error('Quote or slippage is outside the approved router bounds.')
  const borrowed = uint(candidate.borrowedUsdgRaw, 'borrowedUsdgRaw')
  const target = uint(candidate.targetUsdgRaw, 'targetUsdgRaw')
  const requiredSwapOutput = target > borrowed ? target - borrowed : 0n
  const slippageFloor = quoted * (BPS - slippageBps) / BPS
  const minimum = requiredSwapOutput > slippageFloor ? requiredSwapOutput : slippageFloor
  if (minimum > quoted) throw new Error('Candidate quote cannot meet the target after the planned borrow.')
  if (minimum <= 0n) throw new Error('Calculated on-chain minimum output is zero.')
  return minimum.toString()
}

/**
 * Build a fixed-method parameter template from the freshly rechecked candidate.
 * It deliberately omits authorization bytes and transaction calldata.
 */
export function buildExecutionCallTemplate(candidateInput: unknown, input: {
  blockTimestamp: bigint
  sellOracleMaxAgeSeconds: number | null
}) {
  const candidate = parseCandidate(candidateInput)
  const deadline = input.blockTimestamp + BigInt(DEADLINE_WINDOW_SECONDS)
  const common = { deadline: deadline.toString(), authorization: '<not signed>' as const }

  if (candidate.kind === 'BORROW') {
    const borrowAmount = uint(candidate.borrowedUsdgRaw, 'borrowedUsdgRaw')
    if (borrowAmount <= 0n || borrowAmount < uint(candidate.targetUsdgRaw, 'targetUsdgRaw')
      || uint(candidate.soldNvdaRaw, 'soldNvdaRaw') !== 0n
      || uint(candidate.swapQuotedOutUsdgRaw, 'swapQuotedOutUsdgRaw') !== 0n
      || candidate.swapFeeTier !== null || candidate.swapPool !== null) {
      throw new Error('BORROW candidate has inconsistent swap or borrow amounts.')
    }
    return {
      method: 'executeBorrow' as const,
      arguments: { borrowAmount: borrowAmount.toString(), maxBorrowAmount: borrowAmount.toString(), ...common },
      route: null,
    }
  }

  const amountIn = uint(candidate.soldNvdaRaw, 'soldNvdaRaw')
  if (amountIn <= 0n) {
    const borrowAmount = uint(candidate.borrowedUsdgRaw, 'borrowedUsdgRaw')
    const collateralToSupply = uint(candidate.suppliedNvdaRaw, 'suppliedNvdaRaw')
    if (candidate.kind !== 'HYBRID' || borrowAmount < uint(candidate.targetUsdgRaw, 'targetUsdgRaw')
      || collateralToSupply <= 0n || uint(candidate.swapQuotedOutUsdgRaw, 'swapQuotedOutUsdgRaw') !== 0n
      || candidate.swapFeeTier !== null || candidate.swapPool !== null) {
      throw new Error('Zero-sale candidate does not match the supported collateral-supply HYBRID route.')
    }
    return {
      method: 'executeHybrid' as const,
      arguments: {
        amountIn: '0', maxSellAmount: '0', collateralToSupply: collateralToSupply.toString(),
        borrowAmount: borrowAmount.toString(), maxBorrowAmount: borrowAmount.toString(),
        minOutput: '0', fee: 0, ...common,
      },
      route: null,
    }
  }
  const route = assertAllowlistedRoute(candidate)
  const minOutput = amountOutMinimum(candidate)
  if (candidate.kind === 'SELL') {
    if (uint(candidate.suppliedNvdaRaw, 'suppliedNvdaRaw') !== 0n || uint(candidate.borrowedUsdgRaw, 'borrowedUsdgRaw') !== 0n) {
      throw new Error('SELL candidate contains an unsupported collateral-supply or borrow leg.')
    }
    const oracleMaxAgeSeconds = input.sellOracleMaxAgeSeconds
    if (![OPEN_MARKET_MAX_AGE_SECONDS, CLOSED_SELL_MAX_AGE_SECONDS, HOLIDAY_SELL_MAX_AGE_SECONDS].includes(oracleMaxAgeSeconds ?? -1)) {
      throw new Error('SELL oracle-age policy does not match one of the router-supported bounds.')
    }
    return {
      method: 'executeSell' as const,
      arguments: {
        amountIn: amountIn.toString(), maxSellAmount: amountIn.toString(), minOutput,
        fee: route.fee, oracleMaxAgeSeconds, ...common,
      },
      route,
    }
  }

  const borrowAmount = uint(candidate.borrowedUsdgRaw, 'borrowedUsdgRaw')
  const collateralToSupply = uint(candidate.suppliedNvdaRaw, 'suppliedNvdaRaw')
  if (borrowAmount <= 0n) throw new Error('HYBRID candidate does not contain a borrow leg supported by executeHybrid.')
  return {
    method: 'executeHybrid' as const,
    arguments: {
      amountIn: amountIn.toString(), maxSellAmount: amountIn.toString(),
      collateralToSupply: collateralToSupply.toString(), borrowAmount: borrowAmount.toString(),
      maxBorrowAmount: borrowAmount.toString(), minOutput, fee: route.fee, ...common,
    },
    route,
  }
}
