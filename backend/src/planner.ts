import type { Address } from 'viem'
import type { StructuredIntent } from './intent.js'
import { getIntegrationStatus } from './integrations/status.js'
import { getPortfolio } from './integrations/portfolio.js'

type Blocker = { code: string; detail: string }

export async function getReadOnlyPlanPreflight(address: Address, intent: StructuredIntent) {
  const [portfolio, integrationStatus] = await Promise.all([
    getPortfolio(address),
    getIntegrationStatus(),
  ])

  if (integrationStatus.network.rpc.status !== 'available') {
    throw new Error(integrationStatus.network.rpc.detail ?? 'Robinhood Chain RPC is unavailable.')
  }

  const blockers: Blocker[] = []
  const borrowBlockers: Blocker[] = []
  const sellBlockers: Blocker[] = []

  // These values are deliberately unset. LLTV is the liquidation boundary,
  // not an operational risk limit for this product.
  const riskPolicy = {
    status: 'unconfigured' as const,
    requiredFields: ['maxLtv', 'minLiquidationBuffer'],
  }
  const riskBlocker = {
    code: 'RISK_POLICY_UNCONFIGURED',
    detail: 'Operational max LTV and minimum liquidation buffer have not been set; no borrow amount is calculated.',
  }
  blockers.push(riskBlocker)
  borrowBlockers.push(riskBlocker)

  const market = integrationStatus.integrations.longbowMarket
  if (market.status !== 'available') {
    const blocker = { code: 'BORROW_MARKET_UNVERIFIED', detail: market.detail }
    blockers.push(blocker)
    borrowBlockers.push(blocker)
  }

  const oracle = integrationStatus.integrations.chainlink
  const oracleFreshness = 'freshness' in oracle ? oracle.freshness : undefined
  if (!oracleFreshness || oracleFreshness.status === 'unassessed') {
    const blocker = {
      code: 'ORACLE_FRESHNESS_UNVERIFIED',
      detail: oracleFreshness?.detail ?? oracle.detail ?? 'Oracle freshness is not verified.',
    }
    blockers.push(blocker)
    borrowBlockers.push(blocker)
  }

  if (BigInt(portfolio.balances.nvda.raw) === 0n && BigInt(portfolio.longbowNvdaUsdg.collateralRaw) === 0n) {
    const blocker = {
      code: 'NO_NVDA_COLLATERAL',
      detail: 'The supplied wallet has zero NVDA balance and zero existing Longbow NVDA collateral at the read block.',
    }
    blockers.push(blocker)
    borrowBlockers.push(blocker)
  }

  const zeroX = integrationStatus.integrations.zeroX
  if (intent.maxSellPercentage > 0) {
    const blocker = { code: 'SELL_ROUTE_UNAVAILABLE', detail: zeroX.detail }
    blockers.push(blocker)
    sellBlockers.push(blocker)
  }

  const strategies = {
    borrow: { status: borrowBlockers.length === 0 ? 'not_assessed' as const : 'blocked' as const, blockers: borrowBlockers },
    sell: { status: sellBlockers.length === 0 ? 'not_assessed' as const : 'blocked' as const, blockers: sellBlockers },
    hybrid: {
      status: borrowBlockers.length === 0 && sellBlockers.length === 0 ? 'not_assessed' as const : 'blocked' as const,
      blockers: [...borrowBlockers, ...sellBlockers],
    },
  }

  return {
    status: blockers.length === 0 ? 'preflight_clear' as const : 'blocked' as const,
    executable: false as const,
    intent,
    riskPolicy,
    readAt: portfolio.readAt,
    chainId: portfolio.chainId,
    blockNumber: portfolio.blockNumber,
    wallet: {
      address: portfolio.address,
      balances: portfolio.balances,
      longbowPosition: portfolio.longbowNvdaUsdg,
      approvals: portfolio.approvals,
    },
    market: {
      verification: market,
      oracle,
      liquidationLtvWad: market.status === 'available' ? market.expectedLltvWad : null,
      currentState: {
        totalSupplyAssetsRaw: portfolio.longbowNvdaUsdg.marketSupplyAssetsRaw,
        totalSupplySharesRaw: portfolio.longbowNvdaUsdg.marketSupplySharesRaw,
        totalBorrowAssetsRaw: portfolio.longbowNvdaUsdg.marketBorrowAssetsRaw,
        totalBorrowSharesRaw: portfolio.longbowNvdaUsdg.marketBorrowSharesRaw,
        lastAccrualTimestamp: portfolio.longbowNvdaUsdg.lastAccrualTimestamp,
        feeWad: portfolio.longbowNvdaUsdg.marketFeeWad,
        borrowRatePerSecondWad: portfolio.longbowNvdaUsdg.borrowRatePerSecondWad,
        accruedInterestRaw: portfolio.longbowNvdaUsdg.accruedInterestRaw,
      },
      borrowLiquidity: {
        status: 'not_assessed',
        detail: 'Raw market totals are shown; borrowable capacity is not asserted because liquidity and risk-policy checks are incomplete.',
      },
    },
    strategies,
    blockers,
    note: 'This read-only preflight does not calculate an amount, build transaction calldata, simulate, sign, or execute. A clear preflight would still require deterministic planning and transaction simulation.',
  }
}
