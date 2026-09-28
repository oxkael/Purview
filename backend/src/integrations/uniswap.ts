import { createPublicClient, encodeFunctionData, formatUnits, http, type Address } from 'viem'
import { configuredContracts, longbowNvdaUsdgFeed, robinhoodMainnet, serverConfig, uniswapV3 } from '../config.js'

const client = createPublicClient({
  chain: robinhoodMainnet,
  transport: http(undefined, { timeout: serverConfig.rpcTimeoutMs, retryCount: 0 }),
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
export async function getUniswapNvdaToUsdgQuotes(amountInRawText: string) {
  if (!/^\d+$/.test(amountInRawText) || BigInt(amountInRawText) <= 0n) {
    throw new Error('amountInRaw must be a positive integer in NVDA base units.')
  }
  const amountIn = BigInt(amountInRawText)
  const [chainId, blockNumber] = await Promise.all([client.getChainId(), client.getBlockNumber()])
  if (chainId !== robinhoodMainnet.id) throw new Error(`Wrong RPC chain: expected ${robinhoodMainnet.id}, received ${chainId}.`)
  const [block, round] = await Promise.all([
    client.getBlock({ blockNumber }),
    client.readContract({ address: longbowNvdaUsdgFeed, abi: feedAbi, functionName: 'latestRoundData' }),
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
      client.readContract({ address, abi: poolAbi, functionName: 'factory' }),
      client.readContract({ address, abi: poolAbi, functionName: 'token0' }),
      client.readContract({ address, abi: poolAbi, functionName: 'token1' }),
      client.readContract({ address, abi: poolAbi, functionName: 'fee' }),
      client.readContract({ address, abi: poolAbi, functionName: 'liquidity' }),
      client.readContract({ address, abi: poolAbi, functionName: 'slot0' }),
      client.readContract({ address: uniswapV3.factory, abi: factoryAbi, functionName: 'getPool', args: [configuredContracts.usdg, configuredContracts.nvda, fee] }),
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
      && BigInt(candidate.amountOutRaw) * referenceAmountIn * 100n
        >= bestReference.amountOut * amountIn * 99n
    return {
      ...candidate,
      withinOnePercentOfBestPrice: withinReference,
      eligible: withinReference,
      reason: withinReference ? null : bestReference === null
        ? 'No 0.01 NVDA reference quote passed the 2% Chainlink-deviation and complete-fill checks.'
        : 'Effective price is more than 1% worse than the best eligible 0.01 NVDA reference quote.',
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
      ? 'Read-only quote selected after pool allowlist, exact-input usability, 2% oracle-deviation, and 1% comparison against the best eligible 0.01 NVDA reference. Oracle freshness still gates any execution plan.'
      : 'No allowlisted pool produced a quote that passes the configured venue filters.',
  }
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
