import test from 'node:test'
import assert from 'node:assert/strict'
import { assessGasFunding, calculatePositionRisk, calculateSwapExecutionCost, generateCandidates, makeCandidate, maxPermittedSaleRaw, maxPurviewLtvWad, saleCapacityAfterSupply, selectPlans } from '../dist/plannerMath.js'

const WAD = 10n ** 18n
const USDG = 10n ** 6n
const NVDA = 10n ** 18n
const LLTV = 625n * 10n ** 15n
const PRICE = 200n * 10n ** 24n // $200/NVDA, Morpho's 1e36 token-decimal scaling

function candidate(overrides = {}) {
  return makeCandidate({
    kind: 'SELL', soldNvdaRaw: 0n, suppliedNvdaRaw: 0n, borrowedUsdgRaw: 0n,
    swapReceivedUsdgRaw: 100n * USDG, existingCollateralNvdaRaw: 0n,
    existingDebtUsdgRaw: 0n, morphoOraclePriceRaw: PRICE, marketLltvWad: LLTV,
    targetUsdgRaw: 100n * USDG, maxSaleRaw: NVDA, walletNvdaRaw: NVDA,
    availableBorrowLiquidityRaw: 10_000n * USDG, oracleDeviationBps: 0n,
    ...overrides,
  })
}

test('generates SELL, BORROW, and HYBRID candidates from exact quote inputs', () => {
  const plans = generateCandidates({
    targetUsdgRaw: 100n * USDG, walletNvdaRaw: 2n * NVDA, existingCollateralNvdaRaw: 2n * NVDA,
    existingDebtUsdgRaw: 0n, maxSaleRaw: NVDA, availableBorrowLiquidityRaw: 1_000n * USDG,
    marketLltvWad: LLTV, morphoOraclePriceRaw: PRICE,
    sellQuotes: [{ amountInRaw: NVDA, amountOutRaw: 200n * USDG, swapFeeUsdgRaw: 200_000n,
      priceImpactUsdgRaw: 100_000n, priceImpactBps: 5n, oracleDeviationBps: 0n,
      slippageBps: 100n, gasEstimateEth: '0.0004' },
    { amountInRaw: NVDA / 4n, amountOutRaw: 50n * USDG, swapFeeUsdgRaw: 50_000n,
      priceImpactUsdgRaw: 25_000n, priceImpactBps: 5n, oracleDeviationBps: 0n,
      slippageBps: 100n, gasEstimateEth: '0.0002' }],
  })
  assert.deepEqual([...new Set(plans.map((x) => x.kind))].sort(), ['BORROW', 'HYBRID', 'SELL'])
})

test('generates a zero-sale HYBRID when wallet NVDA must first be supplied', () => {
  const plans = generateCandidates({ targetUsdgRaw: 100n * USDG, walletNvdaRaw: 2n * NVDA,
    existingCollateralNvdaRaw: 0n, existingDebtUsdgRaw: 0n, maxSaleRaw: NVDA,
    availableBorrowLiquidityRaw: 1_000n * USDG, marketLltvWad: LLTV,
    morphoOraclePriceRaw: PRICE, sellQuotes: [] })
  assert.equal(plans.length, 1)
  assert.equal(plans[0].kind, 'HYBRID')
  assert.equal(plans[0].soldNvdaRaw, 0n)
  assert.ok(plans[0].suppliedNvdaRaw > 0n)
  assert.equal(plans[0].soldPercentageBps, 0n)
  assert.equal(plans[0].remainingNvdaRaw, 2n * NVDA)
  assert.equal(plans[0].constraints.minLiquidationBuffer, true)
})

test('rejects candidates on any hard constraint and returns NO_FEASIBLE_PLAN', () => {
  const result = selectPlans([candidate({ swapReceivedUsdgRaw: 1n })])
  assert.equal(result.status, 'NO_FEASIBLE_PLAN')
  assert.equal(result.rejectedCount, 1)
})

test('ranks by least NVDA sold, then liquidation buffer, then total cost', () => {
  const leastSold = candidate({ kind: 'BORROW', borrowedUsdgRaw: 100n * USDG, soldNvdaRaw: 0n, existingCollateralNvdaRaw: 2n * NVDA })
  const moreBuffer = candidate({ kind: 'HYBRID', borrowedUsdgRaw: 100n * USDG, soldNvdaRaw: 0n, suppliedNvdaRaw: NVDA, walletNvdaRaw: NVDA, existingCollateralNvdaRaw: 2n * NVDA })
  const tieCheap = candidate({ kind: 'SELL', soldNvdaRaw: 1n, swapFeeUsdgRaw: 2n })
  const tieCostlier = candidate({ kind: 'HYBRID', soldNvdaRaw: 1n, swapFeeUsdgRaw: 3n })
  assert.equal(selectPlans([candidate({ soldNvdaRaw: 2n }), leastSold, tieCheap, tieCostlier]).selected, leastSold)
  assert.equal(selectPlans([leastSold, moreBuffer]).selected, moreBuffer)
  assert.equal(selectPlans([tieCostlier, tieCheap]).selected, tieCheap)
  assert.ok(moreBuffer.liquidationBufferBps > leastSold.liquidationBufferBps)
})

test('returns a safer alternative with strictly larger buffer', () => {
  const base = candidate({ kind: 'BORROW', borrowedUsdgRaw: 100n * USDG, existingCollateralNvdaRaw: 2n * NVDA })
  const safer = candidate({ kind: 'HYBRID', borrowedUsdgRaw: 100n * USDG, soldNvdaRaw: NVDA, suppliedNvdaRaw: 2n * NVDA, walletNvdaRaw: 3n * NVDA, maxSaleRaw: 3n * NVDA, existingCollateralNvdaRaw: 2n * NVDA })
  const result = selectPlans([base, safer])
  assert.equal(result.selected, base) // the no-sale preference outranks extra buffer
  assert.ok(result.saferAlternative.liquidationBufferBps > result.selected.liquidationBufferBps)
  const selectedWithAlternative = selectPlans([candidate({ soldNvdaRaw: 1n, existingCollateralNvdaRaw: 4n * NVDA, existingDebtUsdgRaw: 100n * USDG }), base, safer])
  assert.equal(selectedWithAlternative.selected, base)
  assert.ok(selectedWithAlternative.saferAlternative.liquidationBufferBps > selectedWithAlternative.selected.liquidationBufferBps)
})

test('sale percentage uses wallet plus deposited holdings and caps sale at wallet balance', () => {
  assert.equal(maxPermittedSaleRaw(10n * NVDA, 90n * NVDA, 2_000n), 10n * NVDA)
  assert.equal(maxPermittedSaleRaw(10n * NVDA, 0n, 2_000n), 2n * NVDA)
})

test('deposited NVDA cannot be sold and new collateral cannot also be sold', () => {
  assert.equal(maxPermittedSaleRaw(10n * NVDA, 90n * NVDA, 2_000n), 10n * NVDA)
  assert.equal(saleCapacityAfterSupply(10n * NVDA, 8n * NVDA, 10n * NVDA), 2n * NVDA)
  assert.throws(() => candidate({ kind: 'HYBRID', soldNvdaRaw: NVDA, suppliedNvdaRaw: NVDA }))
  assert.equal(candidate({ kind: 'HYBRID', soldNvdaRaw: 1n, suppliedNvdaRaw: NVDA, walletNvdaRaw: 2n * NVDA, maxSaleRaw: 0n }).constraints.userSaleLimit, false)
})

test('whole position LTV includes existing plus new collateral and existing plus new debt', () => {
  const risk = calculatePositionRisk(10n * NVDA, 500n * USDG, PRICE, LLTV)
  assert.equal(risk.collateralValueUsdgRaw, 2_000n * USDG)
  assert.equal(risk.ltvWad, 25n * 10n ** 16n)
  assert.equal(risk.liquidationBufferBps, 6_000n)
  const plan = candidate({ kind: 'HYBRID', suppliedNvdaRaw: NVDA, borrowedUsdgRaw: 100n * USDG, existingCollateralNvdaRaw: NVDA, existingDebtUsdgRaw: 100n * USDG, swapReceivedUsdgRaw: 0n })
  assert.equal(plan.collateralNvdaRaw, 2n * NVDA)
  assert.equal(plan.debtUsdgRaw, 200n * USDG)
  assert.equal(plan.soldPercentageBps, 0n)
  assert.equal(plan.priceImpactBps, 0n)
  assert.equal(plan.slippageBps, 100n)
})

test('derives the 60% LTV cap from live market LLTV', () => {
  assert.equal(maxPurviewLtvWad(LLTV), 375n * 10n ** 15n)
  assert.equal(maxPurviewLtvWad(500n * 10n ** 15n), 300n * 10n ** 15n)
})

test('enforces the 40% buffer, 1.5% execution cost, slippage, and oracle deviation', () => {
  assert.equal(candidate({ kind: 'BORROW', borrowedUsdgRaw: 100n * USDG, existingCollateralNvdaRaw: NVDA }).constraints.minLiquidationBuffer, false)
  assert.equal(candidate({ swapFeeUsdgRaw: USDG, priceImpactUsdgRaw: 500_000n }).constraints.maxExecutionCost, true)
  assert.equal(candidate({ swapFeeUsdgRaw: 2n * USDG }).constraints.maxExecutionCost, false)
  assert.equal(candidate({ slippageBps: 101n }).constraints.maxSlippage, false)
  assert.equal(candidate({ soldNvdaRaw: 1n, oracleDeviationBps: 201n }).constraints.oracleQuoteDeviation, false)
})

test('values swap fee and price impact against the market oracle without linear estimates', () => {
  const cost = calculateSwapExecutionCost({ amountInNvdaRaw: NVDA, quotedOutUsdgRaw: 199n * USDG, morphoOraclePriceRaw: PRICE, feeTierPpm: 3_000n })
  assert.equal(cost.oracleGrossOutRaw, 200n * USDG)
  assert.equal(cost.swapFeeUsdgRaw, 600_000n)
  assert.equal(cost.priceImpactUsdgRaw, 400_000n)
  assert.equal(cost.executionCostUsdgRaw, 1n * USDG)
  assert.throws(() => calculateSwapExecutionCost({ amountInNvdaRaw: NVDA, quotedOutUsdgRaw: 1n, morphoOraclePriceRaw: PRICE, feeTierPpm: 10_000n }))
})

test('reports gas separately and never treats unassessed gas as zero', () => {
  const plan = candidate({ gasEstimateEth: '0.00042' })
  assert.deepEqual(plan.gas, { status: 'unassessed', estimateEth: '0.00042', detail: 'ETH gas estimate is reported separately; it is not valued in USDG or counted as zero.' })
})

test('blocks execution without sponsorship or sufficient wallet ETH', () => {
  const noFunding = assessGasFunding({ sponsored: false, walletEthWei: 1n, gasLimit: 100_000n, maxFeePerGasWei: 2_000_000_000n })
  assert.equal(noFunding.ready, false)
  assert.equal(noFunding.method, 'unfunded')
  assert.equal(assessGasFunding({ sponsored: true, walletEthWei: 0n, gasLimit: 100_000n, maxFeePerGasWei: 2_000_000_000n }).ready, true)
  assert.equal(assessGasFunding({ sponsored: false, walletEthWei: 200_000_000_000_000n, gasLimit: 100_000n, maxFeePerGasWei: 2_000_000_000n }).ready, true)
})
