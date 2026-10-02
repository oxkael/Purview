import type { Address } from 'viem'
import type { StructuredIntent } from './intent.js'
import { getIntegrationStatus } from './integrations/status.js'
import { getPortfolio } from './integrations/portfolio.js'
import { getMinimumHybridNvdaSaleQuotes, getMinimumUniswapNvdaInputForUsdg, getUniswapNvdaToUsdgQuotes } from './integrations/uniswap.js'
import { getNasdaqMarketSessionStatus } from './integrations/nasdaqCalendar.js'
import { serverConfig } from './config.js'
import { getJurisdictionGate } from './jurisdiction.js'
import { calculateSwapExecutionCost, generateCandidates, maxPermittedSaleRaw, selectPlans, type SellQuoteOption } from './plannerMath.js'

type Blocker = { code: string; detail: string }

function usdAmountToRawCeil(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Target amount must be a positive finite number.')
  const [mantissa = '', exponentText] = amount.toString().toLowerCase().split('e')
  const exponent = exponentText === undefined ? 0 : Number(exponentText)
  const [whole = '0', fraction = ''] = mantissa.split('.')
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, '')
  const shiftedDecimalPosition = whole.length + exponent + decimals
  if (!Number.isSafeInteger(shiftedDecimalPosition) || shiftedDecimalPosition > 78) throw new Error('Target amount exceeds supported USDG precision.')
  if (shiftedDecimalPosition <= 0) return digits.length > 0 && /[1-9]/.test(digits) ? 1n : 0n
  const rawDigits = shiftedDecimalPosition >= digits.length
    ? digits + '0'.repeat(shiftedDecimalPosition - digits.length)
    : digits.slice(0, shiftedDecimalPosition)
  const discarded = shiftedDecimalPosition < digits.length ? digits.slice(shiftedDecimalPosition) : ''
  const raw = BigInt(rawDigits || '0')
  return raw + (/[1-9]/.test(discarded) ? 1n : 0n)
}

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
  const walletNvdaRaw = BigInt(portfolio.balances.nvda.raw)
  const depositedNvdaRaw = BigInt(portfolio.longbowNvdaUsdg.collateralRaw)
  const maxSellAmountRaw = maxPermittedSaleRaw(walletNvdaRaw, depositedNvdaRaw, BigInt(sellBps))
  // Use the approved small reference size for the global oracle comparison.
  // A maximum-wallet-size quote can fail from price impact even when the
  // smaller exact candidate quote is valid; SELL/HYBRID sizing checks their
  // own exact amounts independently below.
  const quoteAmountRaw = 10_000_000_000_000_000n
  const uniswapQuote = await getUniswapNvdaToUsdgQuotes(quoteAmountRaw.toString()).catch((error: unknown) => ({
    status: 'blocked' as const,
    executable: false as const,
    detail: error instanceof Error ? error.message : 'Uniswap V3 quote unavailable.',
  }))
  const targetUsdgRaw = usdAmountToRawCeil(intent.targetAmount, portfolio.balances.usdg.decimals)
  const minimumSaleQuote = maxSellAmountRaw > 0n
    ? await getMinimumUniswapNvdaInputForUsdg(
        targetUsdgRaw.toString(), maxSellAmountRaw.toString(), BigInt(portfolio.blockNumber),
      ).catch((error: unknown) => ({
        status: 'unavailable' as const,
        reason: 'QUOTE_OR_RPC_ERROR' as const,
        detail: error instanceof Error ? error.message : 'Exact-input quote search failed.',
        blockNumber: portfolio.blockNumber,
      }))
    : {
        status: 'unavailable' as const,
        reason: 'NO_WALLET_NVDA' as const,
        targetOutRaw: targetUsdgRaw.toString(),
        maximumInRaw: '0',
        selected: null,
        pools: [],
      }

  if (integrationStatus.network.rpc.status !== 'available') {
    throw new Error(integrationStatus.network.rpc.detail ?? 'Robinhood Chain RPC is unavailable.')
  }

  const blockers: Blocker[] = []
  const borrowBlockers: Blocker[] = []
  const sellBlockers: Blocker[] = []

  const jurisdictionGate = getJurisdictionGate()
  const jurisdictionBlocker = {
    code: 'JURISDICTION_UNVERIFIED',
    detail: jurisdictionGate.detail,
  }
  if (jurisdictionGate.status === 'blocked') {
    blockers.push(jurisdictionBlocker)
    borrowBlockers.push(jurisdictionBlocker)
    sellBlockers.push(jurisdictionBlocker)
  }

  const stockTokenRegistry = integrationStatus.integrations.robinhoodStockToken
  if (stockTokenRegistry.status !== 'available') {
    const registryBlocker = {
      code: 'STOCK_TOKEN_REGISTRY_UNVERIFIED',
      detail: stockTokenRegistry.detail ?? "Robinhood's official Stock Token registry did not verify the configured NVDA deployment as active.",
    }
    blockers.push(registryBlocker)
    borrowBlockers.push(registryBlocker)
    sellBlockers.push(registryBlocker)
  }

  const sellCapabilityStatus = stockTokenRegistry.status === 'available'
    ? stockTokenRegistry.sellCapability.status
    : 'unverified'
  if (sellCapabilityStatus !== 'available') {
    const tokenSessionGateBlocker = {
      code: 'TOKEN_SESSION_CAPABILITY_UNVERIFIED',
      detail: stockTokenRegistry.status === 'available'
        ? stockTokenRegistry.sellCapability.detail
        : 'Official NVDA session trading capabilities are not verified; SELL and HYBRID remain blocked.',
    }
    sellBlockers.push(tokenSessionGateBlocker)
    blockers.push(tokenSessionGateBlocker)
  }

  if (marketSession.status === 'unknown') {
    const marketSessionBlocker = {
      code: 'MARKET_SESSION_UNVERIFIED',
      detail: `Official market calendar/session data could not verify this Robinhood trading session. ${marketSession.detail}`,
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

  const chainLiveness = integrationStatus.integrations.chainLiveness
  if (chainLiveness.status !== 'available') {
    const chainLivenessBlocker = {
      code: 'CHAIN_LIVENESS_UNVERIFIED',
      detail: chainLiveness.detail ?? 'Independent Robinhood Chain RPC liveness check did not pass.',
    }
    blockers.push(chainLivenessBlocker)
    borrowBlockers.push(chainLivenessBlocker)
    sellBlockers.push(chainLivenessBlocker)
  }

  const market = integrationStatus.integrations.longbowMarket
  // Never fall back to the repo's expected value when live market identity or
  // parameters failed verification. A mismatch must stay unavailable to risk math.
  const verifiedMarketLltvWad = market.status === 'available' && market.actual
    ? BigInt(market.actual.lltvWad)
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
  // Morpho Blue oracle prices use 1e36 scaling. Loan assets are USDG raw units
  // and collateral is NVDA raw units; the market oracle converts between them.
  // These are current-position diagnostics, not a proposed plan.
  const snapshotMarketOraclePriceRaw = BigInt(portfolio.longbowNvdaUsdg.marketOraclePriceRaw)
  const marketOraclePriceRaw = market.status === 'available' && oracle.status === 'available'
    && snapshotMarketOraclePriceRaw > 0n
    ? snapshotMarketOraclePriceRaw
    : undefined
  const collateralRaw = BigInt(portfolio.longbowNvdaUsdg.collateralRaw)
  const debtRaw = BigInt(portfolio.longbowNvdaUsdg.debtAssetsRaw)
  const collateralValueUsdgRaw = marketOraclePriceRaw !== undefined
    ? collateralRaw * marketOraclePriceRaw / 10n ** 36n
    : undefined
  const currentLtvWad = collateralValueUsdgRaw !== undefined && collateralValueUsdgRaw > 0n
    ? debtRaw * 10n ** 18n / collateralValueUsdgRaw
    : undefined
  const liquidationBufferBps = currentLtvWad !== undefined && verifiedMarketLltvWad !== undefined
    ? currentLtvWad >= verifiedMarketLltvWad
      ? 0n
      : (verifiedMarketLltvWad - currentLtvWad) * 10_000n / verifiedMarketLltvWad
    : undefined
  const currentPositionRisk = {
    status: currentLtvWad !== undefined && liquidationBufferBps !== undefined ? 'calculated' as const : 'unavailable' as const,
    source: 'Live Morpho position, accrued debt, verified market LLTV, and Morpho oracle price read at the portfolio block snapshot.',
    collateralValueUsdgRaw: collateralValueUsdgRaw?.toString() ?? null,
    debtUsdgRaw: debtRaw.toString(),
    currentLtvWad: currentLtvWad?.toString() ?? null,
    liquidationBufferBps: liquidationBufferBps?.toString() ?? null,
    meetsOperationalLtvCap: currentLtvWad !== undefined && maxOperationalLtvWad !== undefined
      ? currentLtvWad <= maxOperationalLtvWad
      : null,
    meetsMinimumLiquidationBuffer: liquidationBufferBps !== undefined
      ? liquidationBufferBps >= 4_000n
      : null,
    detail: currentLtvWad === undefined
      ? 'Cannot calculate current position LTV: positive collateral value and verified live market/oracle price are required.'
      : 'Current-position diagnostics only. New collateral, swaps, and borrowing are not assumed or simulated.',
  }
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
      status: borrowBlockers.length === 0 && sellBlockers.every((blocker) => blocker.code === 'SELL_ROUTE_UNAVAILABLE')
        ? 'not_assessed' as const : 'blocked' as const,
      blockers: [...borrowBlockers, ...sellBlockers.filter((blocker) => blocker.code !== 'SELL_ROUTE_UNAVAILABLE')],
    },
  }

  // Candidate math uses only portfolio/market data from one block and exact
  // QuoterV2 results. It deliberately does not make jurisdiction or execution
  // gates disappear; those remain in `blockers` and `executable` stays false.
  let planAnalysis: Record<string, unknown>
  try {
    if (verifiedMarketLltvWad === undefined) throw new Error('Verified on-chain Morpho LLTV is unavailable.')
    const morphoOraclePriceRaw = BigInt(portfolio.longbowNvdaUsdg.marketOraclePriceRaw)
    const existingDebtRaw = BigInt(portfolio.longbowNvdaUsdg.debtAssetsRaw)
    const availableBorrowLiquidityRaw = BigInt(portfolio.longbowNvdaUsdg.marketSupplyAssetsRaw)
      - BigInt(portfolio.longbowNvdaUsdg.marketBorrowAssetsRaw)
      - BigInt(portfolio.longbowNvdaUsdg.accruedInterestRaw)
    const conservativeLiquidityRaw = availableBorrowLiquidityRaw > 0n ? availableBorrowLiquidityRaw : 0n
    // A verified active Robinhood 24/5 session is required before borrow-based candidates
    // can be considered. Closed/unknown sessions retain SELL diagnostics only.
    const borrowingPermittedBySession = marketSession.status === 'open'
    const borrowLiquidityForCandidates = borrowingPermittedBySession ? conservativeLiquidityRaw : 0n
    const sellOptions: SellQuoteOption[] = []
    if (minimumSaleQuote.status === 'quoted') {
      for (const pool of minimumSaleQuote.pools) {
        if (!('status' in pool) || pool.status !== 'quoted' || !('amountInRaw' in pool) || !('amountOutRaw' in pool)) continue
        const amountInRaw = BigInt(pool.amountInRaw)
        const amountOutRaw = BigInt(pool.amountOutRaw)
        const feeTierPpm = BigInt(pool.fee)
        const cost = calculateSwapExecutionCost({ amountInNvdaRaw: amountInRaw, quotedOutUsdgRaw: amountOutRaw, morphoOraclePriceRaw, feeTierPpm })
        sellOptions.push({
          amountInRaw, amountOutRaw, fee: pool.fee, pool: pool.pool,
          swapFeeUsdgRaw: cost.swapFeeUsdgRaw,
          priceImpactUsdgRaw: cost.priceImpactUsdgRaw, priceImpactBps: cost.priceImpactBps,
          oracleDeviationBps: BigInt(pool.oracleDeviationBps), slippageBps: 100n, gasEstimateEth: null,
        })
      }
    }

    let hybridSizing: Awaited<ReturnType<typeof getMinimumHybridNvdaSaleQuotes>> | { status: 'not_assessed'; reason: string; pools: [] }
    if (!borrowingPermittedBySession) {
      hybridSizing = { status: 'not_assessed', reason: `Borrowing is disabled while the Robinhood equity session is ${marketSession.status}.`, pools: [] }
    } else if (maxSellAmountRaw === 0n || conservativeLiquidityRaw === 0n) {
      hybridSizing = { status: 'not_assessed', reason: maxSellAmountRaw === 0n ? 'No permitted wallet sale is available for hybrid sizing.' : 'Live Morpho market has no conservatively available loan-token liquidity.', pools: [] }
    } else {
      hybridSizing = await getMinimumHybridNvdaSaleQuotes({
        targetOutRaw: targetUsdgRaw,
        maximumSaleRaw: maxSellAmountRaw,
        walletNvdaRaw,
        existingCollateralNvdaRaw: depositedNvdaRaw,
        existingDebtUsdgRaw: existingDebtRaw,
        availableBorrowLiquidityRaw: conservativeLiquidityRaw,
        marketLltvWad: verifiedMarketLltvWad,
        marketOraclePriceRaw: morphoOraclePriceRaw,
        snapshotBlockNumber: BigInt(portfolio.blockNumber),
      }).catch((error: unknown) => ({
        status: 'unavailable' as const,
        reason: error instanceof Error ? error.message : 'Live hybrid quote sizing failed.',
        pools: [],
      }))
    }

    if ('pools' in hybridSizing) {
      for (const pool of hybridSizing.pools) {
        if (pool.status !== 'quoted' || !('amountInRaw' in pool) || !('amountOutRaw' in pool)) continue
        const amountInRaw = BigInt(pool.amountInRaw)
        const amountOutRaw = BigInt(pool.amountOutRaw)
        const cost = calculateSwapExecutionCost({ amountInNvdaRaw: amountInRaw, quotedOutUsdgRaw: amountOutRaw, morphoOraclePriceRaw, feeTierPpm: BigInt(pool.fee) })
        sellOptions.push({
          amountInRaw, amountOutRaw, fee: pool.fee, pool: pool.pool,
          swapFeeUsdgRaw: cost.swapFeeUsdgRaw,
          priceImpactUsdgRaw: cost.priceImpactUsdgRaw, priceImpactBps: cost.priceImpactBps,
          oracleDeviationBps: BigInt(pool.oracleDeviationBps), slippageBps: 100n, gasEstimateEth: null,
        })
      }
    }

    const candidates = generateCandidates({
      targetUsdgRaw, walletNvdaRaw, existingCollateralNvdaRaw: depositedNvdaRaw,
      existingDebtUsdgRaw: existingDebtRaw, maxSaleRaw: maxSellAmountRaw,
      availableBorrowLiquidityRaw: borrowLiquidityForCandidates,
      marketLltvWad: verifiedMarketLltvWad, morphoOraclePriceRaw, sellQuotes: sellOptions,
    })
    const selection = selectPlans(candidates)
    const serializeCandidate = (candidate: (typeof candidates)[number]) => ({
      ...candidate,
      targetUsdgRaw: candidate.targetUsdgRaw.toString(),
      swapQuotedOutUsdgRaw: candidate.swapQuotedOutUsdgRaw.toString(),
      soldNvdaRaw: candidate.soldNvdaRaw.toString(),
      soldPercentageBps: candidate.soldPercentageBps.toString(),
      remainingNvdaRaw: candidate.remainingNvdaRaw.toString(),
      suppliedNvdaRaw: candidate.suppliedNvdaRaw.toString(),
      borrowedUsdgRaw: candidate.borrowedUsdgRaw.toString(),
      receivedUsdgRaw: candidate.receivedUsdgRaw.toString(),
      collateralNvdaRaw: candidate.collateralNvdaRaw.toString(),
      debtUsdgRaw: candidate.debtUsdgRaw.toString(),
      collateralValueUsdgRaw: candidate.collateralValueUsdgRaw.toString(),
      ltvWad: candidate.ltvWad.toString(),
      liquidationBufferBps: candidate.liquidationBufferBps.toString(),
      swapFeeUsdgRaw: candidate.swapFeeUsdgRaw.toString(),
      priceImpactUsdgRaw: candidate.priceImpactUsdgRaw.toString(),
      priceImpactBps: candidate.priceImpactBps.toString(),
      slippageBps: candidate.slippageBps.toString(),
      oracleDeviationBps: candidate.oracleDeviationBps?.toString() ?? null,
      executionCostUsdgRaw: candidate.executionCostUsdgRaw.toString(),
      totalCostUsdgRaw: candidate.totalCostUsdgRaw.toString(),
    })
    const planGateBlockers = (kind: 'SELL' | 'BORROW' | 'HYBRID') => kind === 'SELL'
      ? sellBlockers
      : kind === 'BORROW' ? borrowBlockers : [
          ...borrowBlockers,
          ...sellBlockers.filter((blocker) => blocker.code !== 'SELL_ROUTE_UNAVAILABLE'),
          ...(hybridSizing.status === 'available' ? [] : [{
            code: 'HYBRID_ROUTE_UNAVAILABLE',
            detail: 'No allowlisted pool produced a hybrid quote that passed the configured amount, oracle, and reference checks.',
          }]),
        ]
    const noCandidateReasons: Blocker[] = []
    if (walletNvdaRaw === 0n) noCandidateReasons.push({
      code: 'NO_WALLET_NVDA',
      detail: 'The wallet has no NVDA available for a SELL leg. Deposited collateral is not treated as saleable wallet NVDA.',
    })
    if (marketSession.status !== 'open') noCandidateReasons.push({
      code: 'BORROWING_DISABLED_FOR_SESSION',
      detail: `BORROW and HYBRID require a verified active Robinhood equity session; current status is ${marketSession.status}.`,
    })
    if (depositedNvdaRaw === 0n && walletNvdaRaw === 0n) noCandidateReasons.push({
      code: 'NO_NVDA_COLLATERAL',
      detail: 'The wallet has no NVDA balance or existing Morpho NVDA collateral to support a borrow.',
    })
    planAnalysis = {
      status: selection.selected ? 'candidate_selected_but_gated' : candidates.length === 0 ? 'no_candidates_to_evaluate' : 'no_feasible_candidate',
      reasons: selection.selected ? [] : noCandidateReasons,
      selected: selection.selected ? serializeCandidate(selection.selected) : null,
      saferAlternative: selection.saferAlternative ? serializeCandidate(selection.saferAlternative) : null,
      candidates: candidates.map((candidate) => ({
        ...serializeCandidate(candidate),
        locallyFeasible: Object.values(candidate.constraints).every(Boolean),
        blockers: planGateBlockers(candidate.kind),
      })),
      rejectedCount: selection.rejectedCount,
      quoteSizing: { sell: minimumSaleQuote, hybrid: hybridSizing },
      liquidity: {
        marketSupplyAssetsRaw: portfolio.longbowNvdaUsdg.marketSupplyAssetsRaw,
        marketBorrowAssetsRaw: portfolio.longbowNvdaUsdg.marketBorrowAssetsRaw,
        accruedInterestRaw: portfolio.longbowNvdaUsdg.accruedInterestRaw,
        conservativeAvailableRaw: conservativeLiquidityRaw.toString(),
        detail: 'This is aggregate market liquidity, not this wallet’s borrowing capacity. Conservative raw USDG liquidity is total supply less total borrow assets and accrued market interest, all read at the portfolio block; collateral risk and market-session policy still limit any borrow.',
      },
      snapshot: { blockNumber: portfolio.blockNumber, marketOraclePriceRaw: morphoOraclePriceRaw.toString() },
      detail: 'Candidate ranking is diagnostic. Every candidate remains blocked by its listed gates; no calldata, simulation, signing, or execution is performed.',
    }
  } catch (error) {
    planAnalysis = {
      status: 'unavailable', selected: null, candidates: [],
      detail: error instanceof Error ? error.message : 'Live candidate analysis could not be completed.',
      executable: false,
    }
  }

  return {
    status: blockers.length === 0 ? 'preflight_clear' as const : 'blocked' as const,
    executable: false as const,
    intent,
    riskPolicy,
    marketSession,
    robinhoodStockToken: stockTokenRegistry,
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
    sellOnlyMinimum: {
      status: minimumSaleQuote.status,
      targetUsdgRaw: targetUsdgRaw.toString(),
      maximumSaleRaw: maxSellAmountRaw.toString(),
      quote: minimumSaleQuote,
      detail: minimumSaleQuote.status === 'quoted'
        ? 'Minimum wallet NVDA input reaching the requested USDG output, searched per allowlisted pool at the portfolio read block and rechecked against the oracle and 0.01 NVDA reference. This is a sell-only diagnostic; plan ranking and execution are separate.'
        : 'No validated minimum sell quote is available. Borrow and hybrid assessment are not represented by this sell-only result.',
    },
    planAnalysis,
    jurisdictionGate,
    chainLiveness,
    readAt: portfolio.readAt,
    chainId: portfolio.chainId,
    blockNumber: portfolio.blockNumber,
    wallet: {
      address: portfolio.address,
      balances: portfolio.balances,
      totalNvdaHoldingsRaw: (walletNvdaRaw + depositedNvdaRaw).toString(),
      maximumPermittedWalletSaleRaw: maxSellAmountRaw.toString(),
      longbowPosition: portfolio.longbowNvdaUsdg,
      approvals: portfolio.approvals,
    },
    market: {
      verification: market,
      oracle,
      liquidationLtvWad: verifiedMarketLltvWad?.toString() ?? null,
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
      currentPositionRisk,
      borrowLiquidity: {
        status: 'not_assessed',
        detail: 'Raw market totals are shown; borrowable capacity is not asserted because liquidity and risk-policy checks are incomplete.',
      },
    },
    strategies,
    blockers,
    note: 'This read-only preflight ranks SELL/BORROW/HYBRID candidates from live wallet, Morpho, oracle, and exact Uniswap quotes at the reported block snapshot. Jurisdiction and other strategy blockers remain enforced; transaction calldata, simulation, signing, and execution are not exposed.',
  }
}
