import { createPublicClient, encodeFunctionData, fallback, formatUnits, http, type Address } from 'viem'
import { configuredContracts, longbowNvdaUsdgFeed, livenessRpcUrl, mainnetRpcUrl, robinhoodMainnet, serverConfig, uniswapReferenceToleranceBps, uniswapV3 } from '../config.js'
import { findMinimumExactInputForOutput } from '../quoteSizing.js'

const quoteRpcUrls = [...new Set([mainnetRpcUrl, livenessRpcUrl].filter(Boolean))]
const client = createPublicClient({
  chain: robinhoodMainnet,
  transport: quoteRpcUrls.length > 1
    ? fallback(quoteRpcUrls.map((url) => http(url, { timeout: serverConfig.rpcTimeoutMs, retryCount: 0 })), { retryCount: 0 })
    : http(mainnetRpcUrl, { timeout: serverConfig.rpcTimeoutMs, retryCount: 0 }),
})

const factoryAbi = [{
  type: 'function', name: 'getPool', stateMutability: 'view',
  inputs: [{ name: 'tokenA', type: 'address' }, { name: 'tokenB', type: 'address' }, { name: 'fee', type: 'uint24' }],
  outputs: [{ name: 'pool', type: 'address' }],
}] as const

const poolAbi = [{
  type: 'function', name: 'factory', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }],
}, {
  type: 'function', name: 'token0', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }],
}, {
  type: 'function', name: 'token1', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }],
}, {
  type: 'function', name: 'fee', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint24' }],
}, {
  type: 'function', name: 'liquidity', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint128' }],
}, {
  type: 'function', name: 'slot0', stateMutability: 'view', inputs: [], outputs: [{
    name: '', type: 'tuple', components: [
      { name: 'sqrtPriceX96', type: 'uint160' }, { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' }, { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' }, { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
  }],
}] as const

const quoterAbi = [{
  type: 'function', name: 'quoteExactInputSingle', stateMutability: 'nonpayable',
  inputs: [{ name: 'params', type: 'tuple', components: [
    { name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' },
    { name: 'amountIn', type: 'uint256' }, { name: 'fee', type: 'uint24' },
    { name: 'sqrtPriceLimitX96', type: 'uint160' },
  ] }],
  outputs: [
    { name: 'amountOut', type: 'uint256' }, { name: 'sqrtPriceX96After', type: 'uint160' },
    { name: 'initializedTicksCrossed', type: 'uint32' }, { name: 'gasEstimate', type: 'uint256' },
  ],
}] as const

const feedAbi = [{
  type: 'function', name: 'latestRoundData', stateMutability: 'view', inputs: [], outputs: [{
    name: '', type: 'tuple', components: [
      { name: 'roundId', type: 'uint80' }, { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' }, { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  }],
}] as const

const swapRouterAbi = [{
  type: 'function', name: 'exactInputSingle', stateMutability: 'payable',
  inputs: [{ name: 'params', type: 'tuple', components: [
    { name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' },
    { name: 'fee', type: 'uint24' }, { name: 'recipient', type: 'address' },
    { name: 'amountIn', type: 'uint256' }, { name: 'amountOutMinimum', type: 'uint256' },
    { name: 'sqrtPriceLimitX96', type: 'uint160' },
  ] }],
  outputs: [{ name: 'amountOut', type: 'uint256' }],
}, {
  type: 'function', name: 'multicall', stateMutability: 'payable',
  inputs: [{ name: 'deadline', type: 'uint256' }, { name: 'data', type: 'bytes[]' }],
  outputs: [{ name: 'results', type: 'bytes[]' }],
}] as const

const nvdaTokenAbi = [{
  type: 'function', name: 'oraclePaused', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }],
}] as const
const fixedSwapDeadlineSeconds = 120n

const q96 = 2 ** 96
const maxSqrtRatioMinusOne = 1461446703485210103287273052203988822378723970341n

function priceFromSqrtPriceX96(sqrtPriceX96: bigint): number {
  const sqrtRatio = Number(sqrtPriceX96) / q96
  // Pool token0 is USDG (6 decimals), token1 is NVDA (18 decimals).
  return 1e12 / (sqrtRatio * sqrtRatio)
}

function deviationBps(price: number, reference: number): number {
  return Math.round(((price / reference) - 1) * 10_000)
}

function isWithinOracleLimit(amountOut: bigint, amountIn: bigint, oracleAnswer: bigint): boolean {
  // USDG has 6 decimals, NVDA 18, and the Chainlink answer 8. Cross-multiply
  // integers so the hard 2% boundary does not depend on floating-point rounding.
  const quoteTimesScale = amountOut * 10n ** 20n
  const oracleTimesInput = oracleAnswer * amountIn
  return quoteTimesScale * 10_000n >= oracleTimesInput * 9_800n
    && quoteTimesScale * 10_000n <= oracleTimesInput * 10_200n
}

/**
 * Read-only exact-input diagnostics. This does not sign, send, approve, or
 * create swap calldata. It checks every candidate against the fixed allowlist
 * and reports oracle freshness as unassessed until the official feed policy
 * is configured.
 */
export async function getUniswapNvdaToUsdgQuotes(amountInRawText: string, snapshotBlockNumber?: bigint) {
  if (!/^\d+$/.test(amountInRawText) || BigInt(amountInRawText) <= 0n) {
    throw new Error('amountInRaw must be a positive integer in NVDA base units.')
  }
  const amountIn = BigInt(amountInRawText)
  const chainId = await client.getChainId()
  const blockNumber = snapshotBlockNumber ?? await client.getBlockNumber()
  if (chainId !== robinhoodMainnet.id) throw new Error(`Wrong RPC chain: expected ${robinhoodMainnet.id}, received ${chainId}.`)
  const [block, round] = await Promise.all([
    client.getBlock({ blockNumber }),
    client.readContract({ address: longbowNvdaUsdgFeed, abi: feedAbi, functionName: 'latestRoundData', blockNumber }),
  ])
  const age = block.timestamp >= round.updatedAt ? block.timestamp - round.updatedAt : null
  const maxAge = serverConfig.riskPolicy.nvdaOracleMaxAgeSeconds
  const freshness = age === null ? 'invalid' as const
    : maxAge === undefined ? 'unassessed' as const
      : age <= BigInt(maxAge) ? 'fresh' as const : 'stale' as const
  const oraclePrice = Number(formatUnits(round.answer, 8))
  const feedValid = round.answer > 0n && round.updatedAt > 0n && round.answeredInRound >= round.roundId && age !== null

  const candidates = await Promise.all(uniswapV3.nvdaUsdgPools.map(async ({ fee, address }) => {
    const [factory, token0, token1, actualFee, liquidity, slot0, factoryPool] = await Promise.all([
      client.readContract({ address, abi: poolAbi, functionName: 'factory', blockNumber }),
      client.readContract({ address, abi: poolAbi, functionName: 'token0', blockNumber }),
      client.readContract({ address, abi: poolAbi, functionName: 'token1', blockNumber }),
      client.readContract({ address, abi: poolAbi, functionName: 'fee', blockNumber }),
      client.readContract({ address, abi: poolAbi, functionName: 'liquidity', blockNumber }),
      client.readContract({ address, abi: poolAbi, functionName: 'slot0', blockNumber }),
      client.readContract({ address: uniswapV3.factory, abi: factoryAbi, functionName: 'getPool', args: [configuredContracts.usdg, configuredContracts.nvda, fee], blockNumber }),
    ])
    const poolIdentityValid = factory.toLowerCase() === uniswapV3.factory.toLowerCase()
      && factoryPool.toLowerCase() === address.toLowerCase()
      && token0.toLowerCase() === configuredContracts.usdg.toLowerCase()
      && token1.toLowerCase() === configuredContracts.nvda.toLowerCase()
      && actualFee === fee
    if (!poolIdentityValid) throw new Error(`Allowlisted Uniswap pool identity check failed for fee ${fee}.`)
    if (liquidity === 0n) return { fee, pool: address, eligible: false, reason: 'Pool has zero active liquidity.' }

    const quoteResult = await client.readContract({
      address: uniswapV3.quoterV2,
      abi: quoterAbi,
      functionName: 'quoteExactInputSingle',
      args: [{ tokenIn: configuredContracts.nvda, tokenOut: configuredContracts.usdg, amountIn, fee, sqrtPriceLimitX96: 0n }],
      blockNumber,
    }) as readonly [bigint, bigint, number, bigint]
    const [amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate] = quoteResult
    const effectivePrice = Number(formatUnits(amountOut, 6)) / Number(formatUnits(amountIn, 18))
    const spotPrice = priceFromSqrtPriceX96(slot0.sqrtPriceX96)
    const impactBps = Math.round((1 - effectivePrice / spotPrice) * 10_000)
    const oracleDeviation = feedValid ? deviationBps(effectivePrice, oraclePrice) : null
    const stoppedAtPriceLimit = sqrtPriceX96After >= maxSqrtRatioMinusOne - 1n
    const quoteUsable = amountOut > 0n && !stoppedAtPriceLimit
    const oraclePass = feedValid && isWithinOracleLimit(amountOut, amountIn, round.answer)
    return {
      fee,
      feePercent: fee / 10_000,
      pool: address,
      liquidityRaw: liquidity.toString(),
      amountOutRaw: amountOut.toString(),
      amountOut: formatUnits(amountOut, 6),
      effectivePriceUsdPerNvda: effectivePrice,
      slot0PriceUsdPerNvda: spotPrice,
      priceImpactBps: impactBps,
      oracleDeviationBps: oracleDeviation,
      sqrtPriceX96After: sqrtPriceX96After.toString(),
      initializedTicksCrossed,
      gasEstimate: gasEstimate.toString(),
      usableExactInputQuote: quoteUsable,
      withinOracleDeviationLimit: oraclePass,
      eligible: quoteUsable && oraclePass,
      reason: stoppedAtPriceLimit ? 'Quote reached the pool price limit and is not treated as a complete usable fill.'
        : !feedValid ? 'Chainlink round is invalid; oracle comparison cannot be used.'
          : !oraclePass ? 'Quote is more than 2% from the Chainlink round.' : null,
    }
  }))

  // The policy's relative-price reference is always the best eligible 0.01
  // NVDA quote, regardless of the requested trade size.
  const referenceAmountIn = 10_000_000_000_000_000n
  const referenceCandidates = await Promise.all(candidates.map(async (candidate) => {
    if (!('liquidityRaw' in candidate)) return null
    const referenceResult = await client.readContract({
      address: uniswapV3.quoterV2,
      abi: quoterAbi,
      functionName: 'quoteExactInputSingle',
      args: [{ tokenIn: configuredContracts.nvda, tokenOut: configuredContracts.usdg, amountIn: referenceAmountIn, fee: candidate.fee, sqrtPriceLimitX96: 0n }],
      blockNumber,
    }) as readonly [bigint, bigint, number, bigint]
    const [amountOut, sqrtPriceX96After] = referenceResult
    const price = Number(formatUnits(amountOut, 6)) / Number(formatUnits(referenceAmountIn, 18))
    const deviation = feedValid ? deviationBps(price, oraclePrice) : null
    const usable = amountOut > 0n && sqrtPriceX96After < maxSqrtRatioMinusOne - 1n
    return {
      fee: candidate.fee,
      amountOut,
      price,
      usable,
      oraclePass: feedValid && isWithinOracleLimit(amountOut, referenceAmountIn, round.answer),
    }
  }))
  const bestReference = referenceCandidates.reduce<typeof referenceCandidates[number] | null>((best, candidate) => {
    if (!candidate || !candidate.usable || !candidate.oraclePass) return best
    return best === null || candidate.amountOut > best.amountOut ? candidate : best
  }, null)
  const filtered = candidates.map((candidate) => {
    if (!('amountOutRaw' in candidate) || !candidate.eligible || bestReference === null) return candidate
    const withinReference = bestReference !== null
      && BigInt(candidate.amountOutRaw) * referenceAmountIn * 10_000n
        >= bestReference.amountOut * amountIn * (10_000n - uniswapReferenceToleranceBps)
    return {
      ...candidate,
      withinReferencePriceLimit: withinReference,
      eligible: withinReference,
      reason: withinReference ? null : bestReference === null
        ? 'No 0.01 NVDA reference quote passed the 2% Chainlink-deviation and complete-fill checks.'
        : 'Effective price is more than 2% worse than the best eligible 0.01 NVDA reference quote.',
    }
  })
  const eligibleQuotes = filtered.filter((candidate): candidate is typeof candidate & { amountOutRaw: string } =>
    'amountOutRaw' in candidate && candidate.eligible)
  const selected = eligibleQuotes.reduce<typeof eligibleQuotes[number] | undefined>((best, candidate) =>
    best === undefined || BigInt(candidate.amountOutRaw) > BigInt(best.amountOutRaw) ? candidate : best, undefined)

  return {
    status: selected ? 'quoted' as const : 'blocked' as const,
    executable: false as const,
    venue: 'Uniswap V3',
    blockNumber: blockNumber.toString(),
    blockTimestamp: block.timestamp.toString(),
    tokenIn: configuredContracts.nvda,
    tokenOut: configuredContracts.usdg,
    amountInRaw: amountIn.toString(),
    amountIn: formatUnits(amountIn, 18),
    oracle: {
      address: longbowNvdaUsdgFeed,
      answerRaw: round.answer.toString(),
      price: oraclePrice,
      updatedAt: round.updatedAt.toString(),
      ageSeconds: age?.toString() ?? null,
      freshness,
      heartbeatSeconds: serverConfig.riskPolicy.nvdaOracleHeartbeatSeconds,
      heartbeatProvisional: serverConfig.riskPolicy.nvdaOracleHeartbeatProvisional,
      closedMarketSellOnlyMaxAgeSeconds: serverConfig.riskPolicy.nvdaOracleClosedSellMaxAgeSeconds,
      threeDayHolidaySellOnlyMaxAgeSeconds: serverConfig.riskPolicy.nvdaOracleHolidaySellMaxAgeSeconds,
      closedMarketAgePolicyProvisional: serverConfig.riskPolicy.nvdaOracleClosedSellMaxAgeProvisional
        || serverConfig.riskPolicy.nvdaOracleHolidaySellMaxAgeProvisional,
      valid: feedValid,
      maxAgeSeconds: maxAge ?? null,
      detail: `Round age is checked against ${serverConfig.riskPolicy.nvdaOracleHeartbeatSeconds}s heartbeat + 60s (${maxAge}s).${serverConfig.riskPolicy.nvdaOracleHeartbeatProvisional ? ' The heartbeat value is provisional and came from the online reference supplied by the product owner.' : ''}`,
    },
    pools: filtered,
    selection: selected ? { fee: selected.fee, pool: selected.pool, amountOutRaw: selected.amountOutRaw }
      : { fee: null, pool: null, amountOutRaw: null },
    detail: selected
      ? 'Read-only quote selected after pool allowlist, exact-input usability, 2% oracle-deviation, and the temporary 2% comparison against the best eligible 0.01 NVDA reference. Oracle freshness still gates any execution plan.'
      : 'No allowlisted pool produced a quote that passes the configured venue filters.',
  }
}

/**
 * Find the least exact-input NVDA amount that reaches a USDG target on any
 * allowlisted pool, pinned to one block. Every fee tier is searched separately
 * because its exact-input output is monotonic; venue/oracle filters are checked
 * again on each final minimum quote.
 */
export async function getMinimumUniswapNvdaInputForUsdg(targetOutRawText: string, maximumInRawText: string, requestedSnapshotBlockNumber?: bigint) {
  if (!/^\d+$/.test(targetOutRawText) || BigInt(targetOutRawText) <= 0n) throw new Error('targetOutRaw must be a positive USDG base-unit integer.')
  if (!/^\d+$/.test(maximumInRawText) || BigInt(maximumInRawText) <= 0n) throw new Error('maximumInRaw must be a positive NVDA base-unit integer.')
  const targetOut = BigInt(targetOutRawText)
  const maximumIn = BigInt(maximumInRawText)
  // PublicNode's public endpoint can reject eth_call at an explicit block as
  // an archive request, even when that block was just fetched. Keep actual
  // planner calls pinned when a snapshot is supplied; the standalone
  // hypothetical diagnostic uses the `latest` tag to remain usable on this
  // non-archive endpoint.
  const snapshotBlockNumber = requestedSnapshotBlockNumber ?? await client.getBlockNumber()
  if (snapshotBlockNumber <= 0n) throw new Error('A positive snapshot block is required for exact-input sizing.')
  const stateRef = requestedSnapshotBlockNumber === undefined
    ? { blockTag: 'latest' as const }
    : { blockNumber: snapshotBlockNumber }
  const [chainId, block, round] = await Promise.all([
    client.getChainId(),
    client.getBlock({ blockTag: 'latest' }),
    client.readContract({ address: longbowNvdaUsdgFeed, abi: feedAbi, functionName: 'latestRoundData', ...stateRef }),
  ])
  if (chainId !== robinhoodMainnet.id) throw new Error(`Wrong RPC chain: expected ${robinhoodMainnet.id}, received ${chainId}.`)
  if (round.answer <= 0n || round.updatedAt === 0n || round.answeredInRound < round.roundId || block.timestamp < round.updatedAt) {
    throw new Error('Chainlink round is invalid at the quote snapshot block.')
  }

  const poolStates = await Promise.all(uniswapV3.nvdaUsdgPools.map(async ({ fee, address }) => {
    const [factory, token0, token1, actualFee, liquidity, registeredPool] = await Promise.all([
      client.readContract({ address, abi: poolAbi, functionName: 'factory', ...stateRef }),
      client.readContract({ address, abi: poolAbi, functionName: 'token0', ...stateRef }),
      client.readContract({ address, abi: poolAbi, functionName: 'token1', ...stateRef }),
      client.readContract({ address, abi: poolAbi, functionName: 'fee', ...stateRef }),
      client.readContract({ address, abi: poolAbi, functionName: 'liquidity', ...stateRef }),
      client.readContract({ address: uniswapV3.factory, abi: factoryAbi, functionName: 'getPool', args: [configuredContracts.usdg, configuredContracts.nvda, fee], ...stateRef }),
    ])
    const verified = factory.toLowerCase() === uniswapV3.factory.toLowerCase()
      && token0.toLowerCase() === configuredContracts.usdg.toLowerCase()
      && token1.toLowerCase() === configuredContracts.nvda.toLowerCase()
      && actualFee === fee
      && registeredPool.toLowerCase() === address.toLowerCase()
    if (!verified) throw new Error(`Allowlisted Uniswap pool identity check failed for fee ${fee}.`)
    return { fee, address, liquidity }
  }))

  const referenceAmountIn = 10_000_000_000_000_000n
  const quotePool = async (fee: number, amountIn: bigint) => {
    const result = await client.readContract({
      address: uniswapV3.quoterV2,
      abi: quoterAbi,
      functionName: 'quoteExactInputSingle',
      args: [{ tokenIn: configuredContracts.nvda, tokenOut: configuredContracts.usdg, amountIn, fee, sqrtPriceLimitX96: 0n }],
      ...stateRef,
    }) as readonly [bigint, bigint, number, bigint]
    const [amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate] = result
    return { amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate, usable: amountOut > 0n && sqrtPriceX96After < maxSqrtRatioMinusOne - 1n }
  }

  const references = await Promise.all(poolStates.map(async (pool) => {
    if (pool.liquidity === 0n) return { ...pool, referenceOut: 0n, referenceValid: false }
    const reference = await quotePool(pool.fee, referenceAmountIn)
    const oraclePass = isWithinOracleLimit(reference.amountOut, referenceAmountIn, round.answer)
    return { ...pool, referenceOut: reference.amountOut, referenceValid: reference.usable && oraclePass }
  }))
  const bestReference = references.reduce<(typeof references)[number] | null>((best, pool) => {
    if (!pool.referenceValid) return best
    return best === null || pool.referenceOut > best.referenceOut ? pool : best
  }, null)
  if (bestReference === null) {
    return { status: 'unavailable' as const, reason: 'NO_VALID_001_REFERENCE', blockNumber: snapshotBlockNumber.toString(), pools: [] }
  }

  const searchedPools = await Promise.all(references.map(async (pool) => {
    if (pool.liquidity === 0n || !pool.referenceValid) return {
      fee: pool.fee, pool: pool.address, status: 'unavailable' as const,
      reason: pool.liquidity === 0n ? 'ZERO_LIQUIDITY' as const : 'REFERENCE_ORACLE_REJECTED' as const,
      probes: 0,
    }
    const sizing = await findMinimumExactInputForOutput({
      targetAmountOutRaw: targetOut,
      maximumAmountInRaw: maximumIn,
      quoteExactInput: async (amountIn) => (await quotePool(pool.fee, amountIn)).amountOut,
    })
    if (sizing.status !== 'quoted') return {
      fee: pool.fee, pool: pool.address, status: 'unavailable' as const,
      reason: sizing.reason, maxProbe: sizing.maxProbe && {
        amountInRaw: sizing.maxProbe.amountInRaw.toString(), amountOutRaw: sizing.maxProbe.amountOutRaw.toString(),
      }, probes: sizing.probes,
    }

    const finalQuote = await quotePool(pool.fee, sizing.minimum.amountInRaw)
    const oraclePass = isWithinOracleLimit(finalQuote.amountOut, sizing.minimum.amountInRaw, round.answer)
    const oracleValueScaled = round.answer * sizing.minimum.amountInRaw
    const oracleDeviationBps = Number((finalQuote.amountOut * 10n ** 20n - oracleValueScaled) * 10_000n / oracleValueScaled)
    const withinReference = finalQuote.amountOut * referenceAmountIn * 10_000n
      >= bestReference.referenceOut * sizing.minimum.amountInRaw * (10_000n - uniswapReferenceToleranceBps)
    const eligible = finalQuote.usable && oraclePass && withinReference
    return {
      fee: pool.fee,
      pool: pool.address,
      status: eligible ? 'quoted' as const : 'rejected' as const,
      reason: !finalQuote.usable ? 'INCOMPLETE_FILL' as const : !oraclePass ? 'ORACLE_DEVIATION' as const : !withinReference ? 'MORE_THAN_2_PERCENT_WORSE_THAN_REFERENCE' as const : null,
      amountInRaw: sizing.minimum.amountInRaw.toString(),
      amountOutRaw: finalQuote.amountOut.toString(),
      oracleDeviationBps,
      lowerProbe: sizing.lowerProbe && {
        amountInRaw: sizing.lowerProbe.amountInRaw.toString(), amountOutRaw: sizing.lowerProbe.amountOutRaw.toString(),
      },
      oracleDeviationPass: oraclePass,
      referencePricePass: withinReference,
      gasEstimate: finalQuote.gasEstimate.toString(),
      initializedTicksCrossed: finalQuote.initializedTicksCrossed,
      probes: sizing.probes + 1,
    }
  }))

  const eligible = searchedPools.filter((pool): pool is typeof pool & { status: 'quoted'; amountInRaw: string; amountOutRaw: string } =>
    pool.status === 'quoted' && 'amountInRaw' in pool && 'amountOutRaw' in pool)
  const selected = eligible.reduce<(typeof eligible)[number] | null>((best, pool) => {
    if (!best) return pool
    const smallerInput = BigInt(pool.amountInRaw) < BigInt(best.amountInRaw)
    return smallerInput || (pool.amountInRaw === best.amountInRaw && BigInt(pool.amountOutRaw) > BigInt(best.amountOutRaw)) ? pool : best
  }, null)
  return {
    status: selected ? 'quoted' as const : 'unavailable' as const,
    reason: selected ? null : 'NO_POOL_REACHED_TARGET_WITH_ALL_VENUE_FILTERS',
    blockNumber: snapshotBlockNumber.toString(),
    blockTimestamp: block.timestamp.toString(),
    targetOutRaw: targetOut.toString(),
    maximumInRaw: maximumIn.toString(),
    reference: { amountInRaw: referenceAmountIn.toString(), fee: bestReference.fee, amountOutRaw: bestReference.referenceOut.toString() },
    selected: selected ? {
      fee: selected.fee,
      pool: selected.pool,
      amountInRaw: selected.amountInRaw,
      amountInNvda: formatUnits(BigInt(selected.amountInRaw), 18),
      amountOutRaw: selected.amountOutRaw,
      amountOutUsdg: formatUnits(BigInt(selected.amountOutRaw), 6),
    } : null,
    pools: searchedPools,
    note: requestedSnapshotBlockNumber === undefined
      ? 'This standalone hypothetical diagnostic used the RPC latest tag for each read because the configured public RPC rejects explicit block-state reads as archive requests. The chain can advance between probes, so this result is indicative and is not a transaction-ready minimum. Each pool was searched independently; the reported boundary, oracle check, and reference check may span different latest states.'
      : 'Each pool was searched independently at the same block. The reported minimum is the adjacent-input boundary for that pool; oracle and 0.01 NVDA reference filters were rechecked at the resulting input.',
  }
}

/**
 * Find the least wallet NVDA sale that can be combined with a Morpho borrow to
 * reach the target, while supplying enough of the unsold wallet NVDA to stay
 * within the operational LTV cap. Every output comes from exact QuoterV2
 * calls at the supplied portfolio block. This function only reads chain state.
 */
export async function getMinimumHybridNvdaSaleQuotes(input: {
  targetOutRaw: bigint
  maximumSaleRaw: bigint
  walletNvdaRaw: bigint
  existingCollateralNvdaRaw: bigint
  existingDebtUsdgRaw: bigint
  availableBorrowLiquidityRaw: bigint
  marketLltvWad: bigint
  marketOraclePriceRaw: bigint
  snapshotBlockNumber: bigint
}) {
  const { targetOutRaw, maximumSaleRaw, walletNvdaRaw, existingCollateralNvdaRaw,
    existingDebtUsdgRaw, availableBorrowLiquidityRaw, marketLltvWad,
    marketOraclePriceRaw, snapshotBlockNumber } = input
  if ([targetOutRaw, maximumSaleRaw, walletNvdaRaw, existingCollateralNvdaRaw,
    existingDebtUsdgRaw, availableBorrowLiquidityRaw].some((value) => value < 0n)
    || targetOutRaw === 0n || marketLltvWad <= 0n || marketOraclePriceRaw <= 0n
    || snapshotBlockNumber <= 0n || maximumSaleRaw > walletNvdaRaw) {
    throw new Error('Invalid live state supplied for hybrid quote sizing.')
  }
  if (maximumSaleRaw === 0n) return { status: 'unavailable' as const, reason: 'NO_PERMITTED_SALE', pools: [] }

  const [chainId, block, round] = await Promise.all([
    client.getChainId(),
    client.getBlock({ blockNumber: snapshotBlockNumber }),
    client.readContract({ address: longbowNvdaUsdgFeed, abi: feedAbi, functionName: 'latestRoundData', blockNumber: snapshotBlockNumber }),
  ])
  if (chainId !== robinhoodMainnet.id) throw new Error(`Wrong RPC chain: expected ${robinhoodMainnet.id}, received ${chainId}.`)
  if (round.answer <= 0n || round.updatedAt === 0n || round.answeredInRound < round.roundId || block.timestamp < round.updatedAt) {
    throw new Error('Chainlink round is invalid at the hybrid quote snapshot block.')
  }

  const referenceAmountIn = 10_000_000_000_000_000n
  const verifiedPools = await Promise.all(uniswapV3.nvdaUsdgPools.map(async ({ fee, address }) => {
    try {
      const [factory, token0, token1, actualFee, liquidity, registeredPool] = await Promise.all([
        client.readContract({ address, abi: poolAbi, functionName: 'factory', blockNumber: snapshotBlockNumber }),
        client.readContract({ address, abi: poolAbi, functionName: 'token0', blockNumber: snapshotBlockNumber }),
        client.readContract({ address, abi: poolAbi, functionName: 'token1', blockNumber: snapshotBlockNumber }),
        client.readContract({ address, abi: poolAbi, functionName: 'fee', blockNumber: snapshotBlockNumber }),
        client.readContract({ address, abi: poolAbi, functionName: 'liquidity', blockNumber: snapshotBlockNumber }),
        client.readContract({ address: uniswapV3.factory, abi: factoryAbi, functionName: 'getPool', args: [configuredContracts.usdg, configuredContracts.nvda, fee], blockNumber: snapshotBlockNumber }),
      ])
      const valid = factory.toLowerCase() === uniswapV3.factory.toLowerCase()
        && token0.toLowerCase() === configuredContracts.usdg.toLowerCase()
        && token1.toLowerCase() === configuredContracts.nvda.toLowerCase()
        && actualFee === fee && registeredPool.toLowerCase() === address.toLowerCase()
      if (!valid) throw new Error('Allowlisted pool identity check failed.')
      return { fee, address, liquidity, error: null as string | null }
    } catch (error) {
      return { fee, address, liquidity: 0n, error: error instanceof Error ? error.message : 'Pool verification failed.' }
    }
  }))

  const quotePool = async (fee: number, amountIn: bigint) => {
    const result = await client.readContract({
      address: uniswapV3.quoterV2, abi: quoterAbi, functionName: 'quoteExactInputSingle',
      args: [{ tokenIn: configuredContracts.nvda, tokenOut: configuredContracts.usdg, amountIn, fee, sqrtPriceLimitX96: 0n }],
      blockNumber: snapshotBlockNumber,
    }) as readonly [bigint, bigint, number, bigint]
    const [amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate] = result
    const usable = amountOut > 0n && sqrtPriceX96After < maxSqrtRatioMinusOne - 1n
    return { amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate, usable }
  }

  const references = await Promise.all(verifiedPools.map(async (pool) => {
    if (pool.error || pool.liquidity === 0n) return { ...pool, referenceOut: 0n, referenceValid: false }
    try {
      const reference = await quotePool(pool.fee, referenceAmountIn)
      return { ...pool, referenceOut: reference.amountOut,
        referenceValid: reference.usable && isWithinOracleLimit(reference.amountOut, referenceAmountIn, round.answer) }
    } catch (error) {
      return { ...pool, referenceOut: 0n, referenceValid: false,
        error: error instanceof Error ? error.message : 'Reference quote failed.' }
    }
  }))
  const bestReference = references.reduce<(typeof references)[number] | null>((best, pool) => {
    if (!pool.referenceValid) return best
    return best === null || pool.referenceOut > best.referenceOut ? pool : best
  }, null)
  if (bestReference === null) return { status: 'unavailable' as const, reason: 'NO_VALID_001_REFERENCE', pools: [] }

  const WAD = 10n ** 18n
  const PRICE_SCALE = 10n ** 36n
  const ltvCap = marketLltvWad * 6_000n / 10_000n
  const ceilDiv = (n: bigint, d: bigint) => n === 0n ? 0n : (n + d - 1n) / d
  const evaluate = async (fee: number, amountIn: bigint) => {
    // A zero-sale feasibility probe is purely a Morpho capacity calculation;
    // QuoterV2 rejects zero exact-input amounts.
    const quote = amountIn === 0n
      ? { amountOut: 0n, sqrtPriceX96After: 0n, initializedTicksCrossed: 0, gasEstimate: 0n, usable: true }
      : await quotePool(fee, amountIn)
    const borrowed = targetOutRaw > quote.amountOut ? targetOutRaw - quote.amountOut : 0n
    const remainingWalletNvda = walletNvdaRaw - amountIn
    const totalCollateralValue = (existingCollateralNvdaRaw + remainingWalletNvda) * marketOraclePriceRaw / PRICE_SCALE
    const maxDebtAtCap = totalCollateralValue * ltvCap / WAD
    const borrowHeadroom = maxDebtAtCap > existingDebtUsdgRaw ? maxDebtAtCap - existingDebtUsdgRaw : 0n
    const feasible = quote.usable && borrowed > 0n
      && borrowed <= availableBorrowLiquidityRaw && borrowed <= borrowHeadroom
    return { quote, borrowed, feasible }
  }

  const pools = await Promise.all(references.map(async (pool) => {
    if (pool.error || pool.liquidity === 0n || !pool.referenceValid) return {
      fee: pool.fee, pool: pool.address, status: 'unavailable' as const,
      reason: pool.error ? 'POOL_OR_REFERENCE_UNAVAILABLE' : pool.liquidity === 0n ? 'ZERO_LIQUIDITY' : 'REFERENCE_ORACLE_REJECTED',
      probes: 0,
    }
    try {
      let low = 0n
      let high = maximumSaleRaw
      let highEval = await evaluate(pool.fee, high)
      let probes = 1
      if (!highEval.feasible) return {
        fee: pool.fee, pool: pool.address, status: 'unavailable' as const,
        reason: 'MAXIMUM_SALE_CANNOT_SUPPORT_TARGET_WITH_SAFE_BORROW', probes,
      }
      const zeroEval = await evaluate(pool.fee, 0n)
      probes += 1
      if (zeroEval.feasible) return {
        fee: pool.fee, pool: pool.address, status: 'unavailable' as const,
        reason: 'ZERO_SALE_BORROW_CANDIDATE_ALREADY_EXISTS', probes,
      }
      while (high - low > 1n) {
        const mid = low + (high - low) / 2n
        const midEval = await evaluate(pool.fee, mid)
        probes += 1
        if (midEval.feasible) {
          high = mid
          highEval = midEval
        } else low = mid
      }
      const lowerEval = await evaluate(pool.fee, high - 1n)
      probes += 1
      if (lowerEval.feasible) throw new Error('Hybrid sizing invariant failed: adjacent lower sale remains feasible.')

      const quote = highEval.quote
      const oraclePass = isWithinOracleLimit(quote.amountOut, high, round.answer)
      const withinReference = quote.amountOut * referenceAmountIn * 10_000n
        >= bestReference.referenceOut * high * (10_000n - uniswapReferenceToleranceBps)
      if (!oraclePass || !withinReference) return {
        fee: pool.fee, pool: pool.address, status: 'rejected' as const,
        reason: !oraclePass ? 'ORACLE_DEVIATION' : 'REFERENCE_PRICE_LIMIT', probes,
      }
      const quoteValueScaled = quote.amountOut * 10n ** 20n
      const oracleValueScaled = round.answer * high
      const deviationBps = Number((quoteValueScaled - oracleValueScaled) * 10_000n / oracleValueScaled)
      const slot0 = await client.readContract({ address: pool.address, abi: poolAbi, functionName: 'slot0', blockNumber: snapshotBlockNumber })
      const spotPrice = priceFromSqrtPriceX96(slot0.sqrtPriceX96)
      const quotePrice = Number(formatUnits(quote.amountOut, 6)) / Number(formatUnits(high, 18))
      const impactBps = Math.round((1 - quotePrice / spotPrice) * 10_000)
      const existingValue = existingCollateralNvdaRaw * marketOraclePriceRaw / PRICE_SCALE
      const requiredValue = ceilDiv((existingDebtUsdgRaw + highEval.borrowed) * WAD, ltvCap)
      const additionalValue = requiredValue > existingValue ? requiredValue - existingValue : 0n
      const suppliedNvdaRaw = ceilDiv(additionalValue * PRICE_SCALE, marketOraclePriceRaw)
      return {
        fee: pool.fee, pool: pool.address, status: 'quoted' as const,
        amountInRaw: high.toString(), amountOutRaw: quote.amountOut.toString(),
        borrowedUsdgRaw: highEval.borrowed.toString(), suppliedNvdaRaw: suppliedNvdaRaw.toString(),
        lowerProbe: { amountInRaw: (high - 1n).toString(), amountOutRaw: lowerEval.quote.amountOut.toString() },
        oracleDeviationBps: deviationBps, priceImpactBps: impactBps,
        gasEstimateUnits: quote.gasEstimate.toString(), initializedTicksCrossed: quote.initializedTicksCrossed,
        oracleDeviationPass: oraclePass, referencePricePass: withinReference, probes,
      }
    } catch (error) {
      return { fee: pool.fee, pool: pool.address, status: 'unavailable' as const,
        reason: error instanceof Error ? error.message : 'HYBRID_QUOTE_FAILED' }
    }
  }))
  return { status: pools.some((pool) => pool.status === 'quoted') ? 'available' as const : 'unavailable' as const,
    blockNumber: snapshotBlockNumber.toString(), blockTimestamp: block.timestamp.toString(), pools }
}

/** Build only the fixed, deadline-wrapped exact-input call; never submits it. */
export async function buildUniswapNvdaToUsdgCall(amountInRawText: string, recipient: Address) {
  const quote = await getUniswapNvdaToUsdgQuotes(amountInRawText)
  if (quote.status !== 'quoted' || quote.selection.fee === null || quote.selection.amountOutRaw === null) {
    throw new Error('No Uniswap V3 tier passed the configured quote filters; no swap call was built.')
  }
  if (quote.oracle.freshness !== 'fresh') {
    throw new Error('Chainlink freshness is unassessed or stale; no swap call was built.')
  }
  const latest = await client.getBlock({ blockTag: 'latest' })
  const maxAge = serverConfig.riskPolicy.nvdaOracleMaxAgeSeconds
  const currentAge = latest.timestamp >= BigInt(quote.oracle.updatedAt)
    ? latest.timestamp - BigInt(quote.oracle.updatedAt)
    : null
  if (maxAge === undefined || currentAge === null || currentAge > BigInt(maxAge)) {
    throw new Error('Chainlink freshness failed on the final pre-build recheck; no swap call was built.')
  }
  const paused = await client.readContract({
    address: configuredContracts.nvda,
    abi: nvdaTokenAbi,
    functionName: 'oraclePaused',
    blockNumber: latest.number,
  })
  if (paused) throw new Error('NVDA oraclePaused() is true; no swap call was built.')

  const feeTier = uniswapV3.nvdaUsdgPools.find((pool) => pool.fee === quote.selection.fee)
  if (!feeTier) throw new Error('Selected Uniswap fee tier is not allowlisted; no swap call was built.')
  const amountIn = BigInt(amountInRawText)
  const quotedAmountOut = BigInt(quote.selection.amountOutRaw)
  const amountOutMinimum = quotedAmountOut * 9_900n / 10_000n
  if (amountIn <= 0n || amountOutMinimum <= 0n) throw new Error('Swap amount or minimum output is invalid.')
  const deadline = latest.timestamp + fixedSwapDeadlineSeconds
  const exactInputCall = encodeFunctionData({
    abi: swapRouterAbi,
    functionName: 'exactInputSingle',
    args: [{
      tokenIn: configuredContracts.nvda,
      tokenOut: configuredContracts.usdg,
      fee: feeTier.fee,
      recipient,
      amountIn,
      amountOutMinimum,
      sqrtPriceLimitX96: 0n,
    }],
  })
  const data = encodeFunctionData({
    abi: swapRouterAbi,
    functionName: 'multicall',
    args: [deadline, [exactInputCall]],
  })
  return {
    status: 'prepared' as const,
    executable: false as const,
    chainId: robinhoodMainnet.id,
    to: uniswapV3.swapRouter02,
    data,
    value: '0',
    tokenIn: configuredContracts.nvda,
    tokenOut: configuredContracts.usdg,
    recipient,
    amountInRaw: amountIn.toString(),
    quotedAmountOutRaw: quotedAmountOut.toString(),
    amountOutMinimumRaw: amountOutMinimum.toString(),
    fee: feeTier.fee,
    pool: feeTier.address,
    deadline: deadline.toString(),
    deadlineSeconds: fixedSwapDeadlineSeconds.toString(),
    nonceMechanism: 'Wallet transaction nonce; SwapRouter02 does not enforce an application nonce.',
    detail: 'Fixed exact-input Uniswap V3 call wrapped by SwapRouter02 deadline multicall. Unsigned; no approval, simulation, or submission was performed.',
  }
}
