const WAD = 10n ** 18n
const MORPHO_PRICE_SCALE = 10n ** 36n
const BPS = 10_000n

export type PlanKind = 'SELL' | 'BORROW' | 'HYBRID'

export type PlanCandidate = {
  kind: PlanKind
  targetUsdgRaw: bigint
  /** Exact Uniswap V3 route used by the live quote; null when no swap leg exists. */
  swapFeeTier: number | null
  swapPool: string | null
  swapQuotedOutUsdgRaw: bigint
  soldNvdaRaw: bigint
  soldPercentageBps: bigint
  remainingNvdaRaw: bigint
  suppliedNvdaRaw: bigint
  borrowedUsdgRaw: bigint
  receivedUsdgRaw: bigint
  collateralNvdaRaw: bigint
  debtUsdgRaw: bigint
  collateralValueUsdgRaw: bigint
  ltvWad: bigint
  liquidationBufferBps: bigint
  swapFeeUsdgRaw: bigint
  priceImpactUsdgRaw: bigint
  priceImpactBps: bigint
  slippageBps: bigint
  oracleDeviationBps: bigint | null
  executionCostUsdgRaw: bigint
  gas: { status: 'unassessed'; estimateEth: string | null; detail: string }
  constraints: Record<string, boolean>
  totalCostUsdgRaw: bigint
}

export type PlanSelection = {
  status: 'selected' | 'NO_FEASIBLE_PLAN'
  selected: PlanCandidate | null
  saferAlternative: PlanCandidate | null
  rejectedCount: number
}

export type SellQuoteOption = {
  amountInRaw: bigint
  amountOutRaw: bigint
  /** Required on quotes created from live allowlisted pools. */
  fee?: number
  pool?: string
  swapFeeUsdgRaw: bigint
  priceImpactUsdgRaw: bigint
  priceImpactBps: bigint
  oracleDeviationBps: bigint | null
  slippageBps: bigint
  gasEstimateEth: string | null
}

export function maxPermittedSaleRaw(walletNvdaRaw: bigint, depositedNvdaRaw: bigint, percentageBps: bigint): bigint {
  if (walletNvdaRaw < 0n || depositedNvdaRaw < 0n || percentageBps < 0n || percentageBps > BPS) {
    throw new Error('Invalid NVDA balance or sale percentage.')
  }
  const total = walletNvdaRaw + depositedNvdaRaw
  const userLimit = total * percentageBps / BPS
  return userLimit < walletNvdaRaw ? userLimit : walletNvdaRaw
}

export function saleCapacityAfterSupply(walletNvdaRaw: bigint, newlySuppliedNvdaRaw: bigint, maxSaleRaw: bigint): bigint {
  if (newlySuppliedNvdaRaw < 0n || newlySuppliedNvdaRaw > walletNvdaRaw || maxSaleRaw < 0n) {
    throw new Error('New collateral must be within the wallet balance and sale cap must be non-negative.')
  }
  const walletRemainder = walletNvdaRaw - newlySuppliedNvdaRaw
  return walletRemainder < maxSaleRaw ? walletRemainder : maxSaleRaw
}

export function calculateSwapExecutionCost(input: { amountInNvdaRaw: bigint; quotedOutUsdgRaw: bigint; morphoOraclePriceRaw: bigint; feeTierPpm: bigint }) {
  if (input.amountInNvdaRaw < 0n || input.quotedOutUsdgRaw < 0n || input.morphoOraclePriceRaw <= 0n) {
    throw new Error('Swap cost inputs must be non-negative and oracle price must be positive.')
  }
  if (![100n, 500n, 3_000n].includes(input.feeTierPpm)) throw new Error('Uniswap V3 fee tier is not allowlisted.')
  const oracleGrossOutRaw = input.amountInNvdaRaw * input.morphoOraclePriceRaw / MORPHO_PRICE_SCALE
  const swapFeeUsdgRaw = oracleGrossOutRaw * input.feeTierPpm / 1_000_000n
  const oracleAfterFeeRaw = oracleGrossOutRaw - swapFeeUsdgRaw
  const priceImpactUsdgRaw = oracleAfterFeeRaw > input.quotedOutUsdgRaw ? oracleAfterFeeRaw - input.quotedOutUsdgRaw : 0n
  const priceImpactBps = oracleAfterFeeRaw === 0n
    ? 0n
    : priceImpactUsdgRaw * BPS / oracleAfterFeeRaw
  return {
    oracleGrossOutRaw,
    swapFeeUsdgRaw,
    priceImpactUsdgRaw,
    priceImpactBps,
    executionCostUsdgRaw: swapFeeUsdgRaw + priceImpactUsdgRaw,
  }
}

export function calculatePositionRisk(collateralNvdaRaw: bigint, debtUsdgRaw: bigint, morphoOraclePriceRaw: bigint, marketLltvWad: bigint) {
  if (collateralNvdaRaw < 0n || debtUsdgRaw < 0n || morphoOraclePriceRaw <= 0n || marketLltvWad <= 0n) {
    throw new Error('Position risk inputs must be non-negative and oracle price/LLTV must be positive.')
  }
  const collateralValueUsdgRaw = collateralNvdaRaw * morphoOraclePriceRaw / MORPHO_PRICE_SCALE
  if (collateralValueUsdgRaw === 0n && debtUsdgRaw > 0n) throw new Error('Cannot calculate LTV with debt and zero collateral value.')
  const ltvWad = collateralValueUsdgRaw === 0n ? 0n : debtUsdgRaw * WAD / collateralValueUsdgRaw
  const liquidationBufferBps = ltvWad >= marketLltvWad
    ? 0n
    : (marketLltvWad - ltvWad) * BPS / marketLltvWad
  return { collateralValueUsdgRaw, ltvWad, liquidationBufferBps }
}

export function maxPurviewLtvWad(verifiedMarketLltvWad: bigint): bigint {
  if (verifiedMarketLltvWad <= 0n) throw new Error('Verified market LLTV must be positive.')
  return verifiedMarketLltvWad * 6_000n / BPS
}

export function assessGasFunding(input: { sponsored: boolean; walletEthWei: bigint; gasLimit: bigint; maxFeePerGasWei: bigint }) {
  if (input.walletEthWei < 0n || input.gasLimit < 0n || input.maxFeePerGasWei < 0n) throw new Error('Gas funding inputs must be non-negative.')
  const requiredEthWei = input.gasLimit * input.maxFeePerGasWei
  return {
    ready: input.sponsored || input.walletEthWei >= requiredEthWei,
    method: input.sponsored ? 'sponsored' as const : input.walletEthWei >= requiredEthWei ? 'wallet' as const : 'unfunded' as const,
    requiredEthWei: requiredEthWei.toString(),
    estimatedEth: `${requiredEthWei / WAD}.${(requiredEthWei % WAD).toString().padStart(18, '0').replace(/0+$/, '') || '0'}`,
  }
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('Division denominator must be positive.')
  return numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator
}

/**
 * Constructs feasible plan candidates from already-validated live inputs.
 * The caller must obtain exact-input sell quotes; this function never estimates
 * pool output by linear scaling.
 */
export function generateCandidates(input: {
  targetUsdgRaw: bigint
  walletNvdaRaw: bigint
  existingCollateralNvdaRaw: bigint
  existingDebtUsdgRaw: bigint
  maxSaleRaw: bigint
  availableBorrowLiquidityRaw: bigint
  marketLltvWad: bigint
  morphoOraclePriceRaw: bigint
  sellQuotes: SellQuoteOption[]
}) {
  const candidates: PlanCandidate[] = []
  const ltvCapWad = maxPurviewLtvWad(input.marketLltvWad)
  const currentRisk = calculatePositionRisk(input.existingCollateralNvdaRaw, input.existingDebtUsdgRaw, input.morphoOraclePriceRaw, input.marketLltvWad)
  const maxDebtAtCapRaw = currentRisk.collateralValueUsdgRaw * ltvCapWad / WAD
  const existingBorrowHeadroomRaw = maxDebtAtCapRaw > input.existingDebtUsdgRaw
    ? maxDebtAtCapRaw - input.existingDebtUsdgRaw
    : 0n
  const borrowCapacityRaw = existingBorrowHeadroomRaw < input.availableBorrowLiquidityRaw
    ? existingBorrowHeadroomRaw
    : input.availableBorrowLiquidityRaw

  if (input.targetUsdgRaw <= borrowCapacityRaw) {
    candidates.push(makeCandidate({
      kind: 'BORROW', soldNvdaRaw: 0n, suppliedNvdaRaw: 0n, borrowedUsdgRaw: input.targetUsdgRaw,
      swapReceivedUsdgRaw: 0n, existingCollateralNvdaRaw: input.existingCollateralNvdaRaw,
      existingDebtUsdgRaw: input.existingDebtUsdgRaw, morphoOraclePriceRaw: input.morphoOraclePriceRaw,
      marketLltvWad: input.marketLltvWad, targetUsdgRaw: input.targetUsdgRaw, maxSaleRaw: input.maxSaleRaw,
      walletNvdaRaw: input.walletNvdaRaw, availableBorrowLiquidityRaw: input.availableBorrowLiquidityRaw,
    }))
  }

  // An all-borrow result that needs new wallet collateral is HYBRID under the
  // approved definition even when its sale leg is empty.
  const requiredTotalValue = ceilDiv((input.existingDebtUsdgRaw + input.targetUsdgRaw) * WAD, ltvCapWad)
  const requiredAdditionalValue = requiredTotalValue > currentRisk.collateralValueUsdgRaw
    ? requiredTotalValue - currentRisk.collateralValueUsdgRaw
    : 0n
  const requiredNewCollateralRaw = ceilDiv(requiredAdditionalValue * MORPHO_PRICE_SCALE, input.morphoOraclePriceRaw)
  if (requiredNewCollateralRaw > 0n && requiredNewCollateralRaw <= input.walletNvdaRaw
    && input.targetUsdgRaw <= input.availableBorrowLiquidityRaw) {
    candidates.push(makeCandidate({
      kind: 'HYBRID', soldNvdaRaw: 0n, suppliedNvdaRaw: requiredNewCollateralRaw,
      borrowedUsdgRaw: input.targetUsdgRaw, swapReceivedUsdgRaw: 0n,
      existingCollateralNvdaRaw: input.existingCollateralNvdaRaw,
      existingDebtUsdgRaw: input.existingDebtUsdgRaw, morphoOraclePriceRaw: input.morphoOraclePriceRaw,
      marketLltvWad: input.marketLltvWad, targetUsdgRaw: input.targetUsdgRaw,
      maxSaleRaw: input.maxSaleRaw, walletNvdaRaw: input.walletNvdaRaw,
      availableBorrowLiquidityRaw: input.availableBorrowLiquidityRaw,
    }))
  }

  for (const quote of input.sellQuotes) {
    if (quote.amountInRaw <= 0n || quote.amountOutRaw <= 0n || quote.amountInRaw > input.walletNvdaRaw) continue
    const common = {
      soldNvdaRaw: quote.amountInRaw,
      existingCollateralNvdaRaw: input.existingCollateralNvdaRaw,
      existingDebtUsdgRaw: input.existingDebtUsdgRaw,
      morphoOraclePriceRaw: input.morphoOraclePriceRaw,
      marketLltvWad: input.marketLltvWad,
      targetUsdgRaw: input.targetUsdgRaw,
      maxSaleRaw: input.maxSaleRaw,
      walletNvdaRaw: input.walletNvdaRaw,
      availableBorrowLiquidityRaw: input.availableBorrowLiquidityRaw,
      swapFeeUsdgRaw: quote.swapFeeUsdgRaw,
      priceImpactUsdgRaw: quote.priceImpactUsdgRaw,
      priceImpactBps: quote.priceImpactBps,
      oracleDeviationBps: quote.oracleDeviationBps,
      slippageBps: quote.slippageBps,
      gasEstimateEth: quote.gasEstimateEth,
      swapFeeTier: quote.fee ?? null,
      swapPool: quote.pool ?? null,
    }
    if (quote.amountOutRaw >= input.targetUsdgRaw) {
      candidates.push(makeCandidate({
        ...common, kind: 'SELL', suppliedNvdaRaw: 0n, borrowedUsdgRaw: 0n,
        swapReceivedUsdgRaw: quote.amountOutRaw,
      }))
    }
    const borrowNeededRaw = input.targetUsdgRaw > quote.amountOutRaw ? input.targetUsdgRaw - quote.amountOutRaw : 0n
    if (borrowNeededRaw === 0n || borrowNeededRaw > input.availableBorrowLiquidityRaw) continue
    const existingValue = currentRisk.collateralValueUsdgRaw
    const debtAfterBorrow = input.existingDebtUsdgRaw + borrowNeededRaw
    const requiredValue = ceilDiv(debtAfterBorrow * WAD, ltvCapWad)
    const additionalValue = requiredValue > existingValue ? requiredValue - existingValue : 0n
    const newCollateralRaw = ceilDiv(additionalValue * MORPHO_PRICE_SCALE, input.morphoOraclePriceRaw)
    const availableForSupply = input.walletNvdaRaw - quote.amountInRaw
    if (newCollateralRaw > availableForSupply) continue
    candidates.push(makeCandidate({
      ...common, kind: 'HYBRID', suppliedNvdaRaw: newCollateralRaw, borrowedUsdgRaw: borrowNeededRaw,
      swapReceivedUsdgRaw: quote.amountOutRaw,
    }))
  }

  return candidates
}

export function makeCandidate(input: {
  kind: PlanKind
  soldNvdaRaw: bigint
  suppliedNvdaRaw: bigint
  borrowedUsdgRaw: bigint
  swapReceivedUsdgRaw: bigint
  existingCollateralNvdaRaw: bigint
  existingDebtUsdgRaw: bigint
  morphoOraclePriceRaw: bigint
  marketLltvWad: bigint
  targetUsdgRaw: bigint
  maxSaleRaw: bigint
  walletNvdaRaw: bigint
  availableBorrowLiquidityRaw: bigint
  swapFeeUsdgRaw?: bigint
  priceImpactUsdgRaw?: bigint
  priceImpactBps?: bigint
  oracleDeviationBps?: bigint | null
  slippageBps?: bigint
  gasEstimateEth?: string | null
  swapFeeTier?: number | null
  swapPool?: string | null
  totalNvdaHoldingsRaw?: bigint
}): PlanCandidate {
  if (input.soldNvdaRaw + input.suppliedNvdaRaw > input.walletNvdaRaw) throw new Error('Wallet NVDA cannot be both sold and supplied as collateral.')
  const collateralNvdaRaw = input.existingCollateralNvdaRaw + input.suppliedNvdaRaw
  const debtUsdgRaw = input.existingDebtUsdgRaw + input.borrowedUsdgRaw
  const risk = calculatePositionRisk(collateralNvdaRaw, debtUsdgRaw, input.morphoOraclePriceRaw, input.marketLltvWad)
  const executionCostUsdgRaw = (input.swapFeeUsdgRaw ?? 0n) + (input.priceImpactUsdgRaw ?? 0n)
  const ltvCap = maxPurviewLtvWad(input.marketLltvWad)
  const borrowingCandidate = input.kind !== 'SELL'
  const gasEstimate = input.gasEstimateEth ?? null
  const totalNvdaHoldingsRaw = input.totalNvdaHoldingsRaw ?? (input.walletNvdaRaw + input.existingCollateralNvdaRaw)
  const slippageBps = input.slippageBps ?? 100n
  const oracleDeviationBps = input.oracleDeviationBps ?? null
  return {
    kind: input.kind,
    targetUsdgRaw: input.targetUsdgRaw,
    swapFeeTier: input.soldNvdaRaw > 0n ? input.swapFeeTier ?? null : null,
    swapPool: input.soldNvdaRaw > 0n ? input.swapPool ?? null : null,
    swapQuotedOutUsdgRaw: input.soldNvdaRaw > 0n ? input.swapReceivedUsdgRaw : 0n,
    soldNvdaRaw: input.soldNvdaRaw,
    soldPercentageBps: totalNvdaHoldingsRaw === 0n ? 0n : input.soldNvdaRaw * BPS / totalNvdaHoldingsRaw,
    remainingNvdaRaw: totalNvdaHoldingsRaw - input.soldNvdaRaw,
    suppliedNvdaRaw: input.suppliedNvdaRaw,
    borrowedUsdgRaw: input.borrowedUsdgRaw,
    receivedUsdgRaw: input.swapReceivedUsdgRaw + input.borrowedUsdgRaw,
    collateralNvdaRaw,
    debtUsdgRaw,
    collateralValueUsdgRaw: risk.collateralValueUsdgRaw,
    ltvWad: risk.ltvWad,
    liquidationBufferBps: risk.liquidationBufferBps,
    swapFeeUsdgRaw: input.swapFeeUsdgRaw ?? 0n,
    priceImpactUsdgRaw: input.priceImpactUsdgRaw ?? 0n,
    priceImpactBps: input.priceImpactBps ?? 0n,
    slippageBps,
    oracleDeviationBps,
    executionCostUsdgRaw,
    gas: { status: 'unassessed', estimateEth: gasEstimate, detail: 'ETH gas estimate is reported separately; it is not valued in USDG or counted as zero.' },
    constraints: {
      targetMet: input.swapReceivedUsdgRaw + input.borrowedUsdgRaw >= input.targetUsdgRaw,
      userSaleLimit: input.soldNvdaRaw <= saleCapacityAfterSupply(input.walletNvdaRaw, input.suppliedNvdaRaw, input.maxSaleRaw),
      walletNvdaNotDoubleCounted: input.soldNvdaRaw + input.suppliedNvdaRaw <= input.walletNvdaRaw,
      availableBorrowLiquidity: input.borrowedUsdgRaw <= input.availableBorrowLiquidityRaw,
      maxPurviewLtv: !borrowingCandidate || risk.ltvWad <= ltvCap,
      minLiquidationBuffer: !borrowingCandidate || risk.liquidationBufferBps >= 4_000n,
      maxSlippage: slippageBps <= 100n,
      maxExecutionCost: executionCostUsdgRaw * BPS <= input.targetUsdgRaw * 150n,
      oracleQuoteDeviation: input.soldNvdaRaw === 0n || (oracleDeviationBps !== null && (oracleDeviationBps < 0n ? -oracleDeviationBps : oracleDeviationBps) <= 200n),
    },
    totalCostUsdgRaw: executionCostUsdgRaw,
  }
}

function passes(candidate: PlanCandidate): boolean {
  return Object.values(candidate.constraints).every(Boolean)
}

export function selectPlans(candidates: PlanCandidate[]): PlanSelection {
  const valid = candidates.filter(passes).sort((a, b) => {
    if (a.soldNvdaRaw !== b.soldNvdaRaw) return a.soldNvdaRaw < b.soldNvdaRaw ? -1 : 1
    if (a.liquidationBufferBps !== b.liquidationBufferBps) return a.liquidationBufferBps > b.liquidationBufferBps ? -1 : 1
    if (a.totalCostUsdgRaw !== b.totalCostUsdgRaw) return a.totalCostUsdgRaw < b.totalCostUsdgRaw ? -1 : 1
    return a.kind.localeCompare(b.kind)
  })
  const selected = valid[0] ?? null
  const saferAlternative = selected
    ? valid.find((candidate) => candidate.liquidationBufferBps > selected.liquidationBufferBps) ?? null
    : null
  return { status: selected ? 'selected' : 'NO_FEASIBLE_PLAN', selected, saferAlternative, rejectedCount: candidates.length - valid.length }
}
