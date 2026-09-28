import type { Address } from 'viem'
import type { StructuredIntent } from './intent.js'
import { getIntegrationStatus } from './integrations/status.js'
import { getPortfolio } from './integrations/portfolio.js'
import { getUniswapNvdaToUsdgQuotes } from './integrations/uniswap.js'
import { getNasdaqMarketSessionStatus } from './integrations/nasdaqCalendar.js'
import { serverConfig } from './config.js'

type Blocker = { code: string; detail: string }

export async function getReadOnlyPlanPreflight(address: Address, intent: StructuredIntent) {
  const [portfolio, integrationStatus, marketSession] = await Promise.all([
    getPortfolio(address),
    getIntegrationStatus(),
    getNasdaqMarketSessionStatus().catch((error: unknown) => ({
      status: 'unknown' as const,
      source: 'https://www.nasdaq.com/market-activity/stock-market-holiday-schedule',
      detail: error instanceof Error ? error.message : 'Nasdaq market calendar is unavailable.',
    })),
  ])

  const sellBps = Math.floor(intent.maxSellPercentage * 100)
  const maxSellAmountRaw = BigInt(portfolio.balances.nvda.raw) * BigInt(sellBps) / 10_000n
  const quoteAmountRaw = maxSellAmountRaw > 0n ? maxSellAmountRaw : 10_000_000_000_000_000n
  const uniswapQuote = await getUniswapNvdaToUsdgQuotes(quoteAmountRaw.toString()).catch((error: unknown) => ({
    status: 'blocked' as const,
    executable: false as const,
    detail: error instanceof Error ? error.message : 'Uniswap V3 quote unavailable.',
  }))

  if (integrationStatus.network.rpc.status !== 'available') {
    throw new Error(integrationStatus.network.rpc.detail ?? 'Robinhood Chain RPC is unavailable.')
  }

  const blockers: Blocker[] = []
  const borrowBlockers: Blocker[] = []
  const sellBlockers: Blocker[] = []

  const jurisdictionGate = {
    status: 'blocked' as const,
    enforced: true as const,
    detail: 'No approved jurisdiction policy or trusted location-verification source is configured. All plans remain blocked until eligibility can be checked.',
    disclaimer: 'Product availability and use may be restricted by your jurisdiction. This plan does not determine your legal eligibility; do not use the service where it is prohibited.',
  }
  const jurisdictionBlocker = {
    code: 'JURISDICTION_UNVERIFIED',
    detail: jurisdictionGate.detail,
  }
  blockers.push(jurisdictionBlocker)
  borrowBlockers.push(jurisdictionBlocker)
  sellBlockers.push(jurisdictionBlocker)

  if (marketSession.status === 'unknown') {
    const marketSessionBlocker = {
      code: 'MARKET_SESSION_UNVERIFIED',
      detail: `Nasdaq's official market calendar could not verify this session. ${marketSession.detail}`,
    }
    blockers.push(marketSessionBlocker)
    borrowBlockers.push(marketSessionBlocker)
    sellBlockers.push(marketSessionBlocker)
  } else if (marketSession.status === 'closed') {
    const marketClosedBlocker = {
      code: 'MARKET_CLOSED',
      detail: 'The Nasdaq calendar reports the regular US equity market closed. Borrow and hybrid plans are prohibited while closed.',
    }
    blockers.push(marketClosedBlocker)
    borrowBlockers.push(marketClosedBlocker)
  }

  const chainLivenessBlocker = {
    code: 'CHAIN_LIVENESS_UNVERIFIED',
    detail: 'No Chainlink sequencer uptime feed has been identified, and an independent liveness substitute has not been approved/configured.',
  }
  blockers.push(chainLivenessBlocker)
  borrowBlockers.push(chainLivenessBlocker)
  sellBlockers.push(chainLivenessBlocker)

  const market = integrationStatus.integrations.longbowMarket
  const verifiedMarketLltvWad = market.status === 'available'
    ? BigInt(market.actual?.lltvWad ?? market.expectedLltvWad)
    : undefined
  const maxOperationalLtvWad = verifiedMarketLltvWad === undefined
    ? undefined
    : verifiedMarketLltvWad * 6_000n / 10_000n
  const riskPolicy = {
    status: maxOperationalLtvWad !== undefined ? 'configured' as const : 'unavailable' as const,
    marketLltvSource: 'verified on-chain Morpho market parameters',
    marketLltvWad: verifiedMarketLltvWad?.toString() ?? null,
    maxOperationalLtvWad: maxOperationalLtvWad?.toString() ?? null,
    maxOperationalLtvBps: maxOperationalLtvWad === undefined ? null : (maxOperationalLtvWad / 10n ** 14n).toString(),
    maxOperationalLtvFractionOfLltvBps: 6_000,
    minLiquidationPriceDropBps: 4_000,
    maxSlippageBps: 100,
    maxExecutionCostBpsOfTarget: 150,
    maxOracleToLiveQuoteDeviationBps: 200,
    liquidationBufferDefinition: 'Minimum proportional collateral price decline tolerated before reaching market LLTV, expressed in basis points.',
    requiredFields: maxOperationalLtvWad === undefined ? ['verified on-chain market LLTV'] : [],
  }
  if (maxOperationalLtvWad === undefined) {
    const riskBlocker = {
      code: 'RISK_POLICY_UNCONFIGURED',
      detail: 'The verified on-chain market LLTV is unavailable; operational max LTV cannot be derived.',
    }
    blockers.push(riskBlocker)
    borrowBlockers.push(riskBlocker)
  }

  if (market.status !== 'available') {
    const blocker = { code: 'BORROW_MARKET_UNVERIFIED', detail: market.detail }
    blockers.push(blocker)
    borrowBlockers.push(blocker)
  }

  const oracle = integrationStatus.integrations.chainlink
  const oracleFreshness = 'freshness' in oracle ? oracle.freshness : undefined
  const oracleAgeSeconds = 'feed' in oracle && oracle.feed?.ageSeconds
    ? BigInt(oracle.feed.ageSeconds)
    : undefined
  const closedSellMaxAge = marketSession.status === 'closed'
    ? marketSession.extendedHolidayWeekend
      ? serverConfig.riskPolicy.nvdaOracleHolidaySellMaxAgeSeconds
      : serverConfig.riskPolicy.nvdaOracleClosedSellMaxAgeSeconds
    : undefined
  const oracleFreshForMode = marketSession.status === 'open'
    ? oracleFreshness?.status === 'fresh'
    : marketSession.status === 'closed'
      ? oracleAgeSeconds !== undefined && oracleAgeSeconds <= BigInt(closedSellMaxAge ?? 0)
      : false
  if (!oracleFreshForMode) {
    const blocker = {
      code: 'ORACLE_FRESHNESS_UNVERIFIED',
      detail: marketSession.status === 'closed'
        ? `Closed-market sell-only feed age must be within ${closedSellMaxAge ?? 0}s; current age is ${oracleAgeSeconds?.toString() ?? 'unavailable'}s.`
        : oracleFreshness?.detail ?? oracle.detail ?? 'Oracle freshness is not verified.',
    }
    blockers.push(blocker)
    borrowBlockers.push(blocker)
    sellBlockers.push(blocker)
  }
  if (marketSession.status === 'closed') {
    // A closed-market sell uses its dedicated age bound; the 1h open-market
    // heartbeat check does not apply to that permitted sell-only case.
    const openAgeBlockerIndex = borrowBlockers.findIndex((blocker) => blocker.code === 'ORACLE_FRESHNESS_UNVERIFIED')
    if (openAgeBlockerIndex >= 0 && oracleFreshForMode) borrowBlockers.splice(openAgeBlockerIndex, 1)
  }

  const nvdaTokenOracle = integrationStatus.integrations.nvdaTokenOracle
  if (nvdaTokenOracle.status !== 'available' || nvdaTokenOracle.paused !== false) {
    const blocker = {
      code: 'ORACLE_PAUSED_OR_UNVERIFIED',
      detail: nvdaTokenOracle.detail ?? 'NVDA token oraclePaused() did not confirm that oracle use is enabled.',
    }
    blockers.push(blocker)
    borrowBlockers.push(blocker)
    sellBlockers.push(blocker)
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
  const quoteComparisonBlocker = {
    code: 'ORACLE_UNSAFE',
    detail: uniswapQuote.status === 'quoted'
      ? 'Live Uniswap V3 quote passed the 2% Chainlink deviation gate for the selected allowlisted pool.'
      : `No allowlisted Uniswap V3 quote passed the 2% Chainlink comparison. ${'detail' in uniswapQuote ? uniswapQuote.detail : ''}`,
  }
  if (uniswapQuote.status !== 'quoted') {
    blockers.push(quoteComparisonBlocker)
    borrowBlockers.push(quoteComparisonBlocker)
    sellBlockers.push(quoteComparisonBlocker)
  }

  if (intent.maxSellPercentage > 0) {
    if (maxSellAmountRaw === 0n) {
      const blocker = { code: 'SELL_ROUTE_UNAVAILABLE', detail: 'The wallet has no permitted NVDA amount to quote at the requested sale percentage.' }
      blockers.push(blocker)
      sellBlockers.push(blocker)
    } else if (uniswapQuote?.status !== 'quoted') {
      const blocker = { code: 'SELL_ROUTE_UNAVAILABLE', detail: 'No eligible Uniswap V3 quote is available for the permitted NVDA sale amount.' }
      blockers.push(blocker)
      sellBlockers.push(blocker)
    }
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
    marketSession,
    oracleFreshnessForPlan: {
      mode: marketSession.status === 'closed' ? 'closed_market_sell_only' : marketSession.status,
      status: oracleFreshForMode ? 'within_limit' : 'blocked',
      maxAgeSeconds: marketSession.status === 'closed'
        ? closedSellMaxAge ?? null
        : serverConfig.riskPolicy.nvdaOracleMaxAgeSeconds,
      provisional: marketSession.status === 'closed'
        ? marketSession.extendedHolidayWeekend
          ? serverConfig.riskPolicy.nvdaOracleHolidaySellMaxAgeProvisional
          : serverConfig.riskPolicy.nvdaOracleClosedSellMaxAgeProvisional
        : serverConfig.riskPolicy.nvdaOracleHeartbeatProvisional,
    },
    swapVenue: {
      primary: 'Uniswap V3',
      zeroXStatus: zeroX,
      uniswapQuote,
      allowlistedFees: [100, 500, 3000],
      detail: 'Quotes are read-only. This preflight does not create router calldata or authorize a transaction.',
    },
    jurisdictionGate,
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
