export type ExactOutputProbe = {
  amountInRaw: bigint
  amountOutRaw: bigint
}

export type ExactInputSizingResult =
  | { status: 'quoted'; minimum: ExactOutputProbe; lowerProbe: ExactOutputProbe | null; probes: number }
  | { status: 'unavailable'; reason: 'INVALID_INPUT' | 'TARGET_NOT_REACHED' | 'SEARCH_LIMIT_REACHED'; maxProbe: ExactOutputProbe | null; lowerBound: ExactOutputProbe | null; probes: number }

/**
 * Finds the smallest integer input whose exact live quote reaches the target.
 * Run this separately for each allowlisted V3 fee tier. `quoteExactInput` must
 * return that pool's raw exact-input output, which is monotonic for a fixed
 * pool. After sizing, the caller must re-check allowlist, Chainlink deviation,
 * and the temporary 2% comparison against the best eligible 0.01 NVDA
 * reference quote.
 * Quote/RPC errors intentionally propagate instead of being misclassified as
 * an insufficient amount. Do not binary-search a cross-pool selector whose
 * eligibility can change with trade size.
 */
export async function findMinimumExactInputForOutput(input: {
  targetAmountOutRaw: bigint
  maximumAmountInRaw: bigint
  maxProbes?: bigint
  quoteExactInput: (amountInRaw: bigint) => Promise<bigint>
}): Promise<ExactInputSizingResult> {
  if (input.targetAmountOutRaw <= 0n || input.maximumAmountInRaw <= 0n) {
    return { status: 'unavailable', reason: 'INVALID_INPUT', maxProbe: null, lowerBound: null, probes: 0 }
  }

  let probes = 1
  let lowInput = 0n // zero is below a positive target without a network call
  let highInput = input.maximumAmountInRaw
  let highOutput = await input.quoteExactInput(highInput)
  if (highOutput < input.targetAmountOutRaw) {
    return {
      status: 'unavailable',
      reason: 'TARGET_NOT_REACHED',
      maxProbe: { amountInRaw: highInput, amountOutRaw: highOutput },
      lowerBound: null,
      probes,
    }
  }

  let lowerProbe: ExactOutputProbe | null = null
  // Integer bisection has a predictable upper bound: one high quote plus at
  // most bitLength(maximumInput) midpoint quotes. Leave one extra probe for
  // the explicit adjacent-lower verification below.
  const maxProbes = input.maxProbes ?? BigInt(input.maximumAmountInRaw.toString(2).length + 2)
  while (highInput - lowInput > 1n) {
    if (BigInt(probes) >= maxProbes) {
      return {
        status: 'unavailable',
        reason: 'SEARCH_LIMIT_REACHED',
        maxProbe: { amountInRaw: highInput, amountOutRaw: highOutput },
        lowerBound: { amountInRaw: lowInput, amountOutRaw: lowerProbe?.amountOutRaw ?? 0n },
        probes,
      }
    }
    const midInput = lowInput + (highInput - lowInput) / 2n
    const midOutput = await input.quoteExactInput(midInput)
    probes += 1
    if (midOutput >= input.targetAmountOutRaw) {
      highInput = midInput
      highOutput = midOutput
    } else {
      lowInput = midInput
      lowerProbe = { amountInRaw: midInput, amountOutRaw: midOutput }
    }
  }

  // Confirm the adjacent lower integer also misses. The binary search already
  // establishes this, but keeping the boundary explicit makes the result easy
  // to audit and avoids relying on an unstated rounding convention.
  if (highInput > 1n && (lowerProbe === null || lowerProbe.amountInRaw !== highInput - 1n)) {
    const lowerOutput = await input.quoteExactInput(highInput - 1n)
    probes += 1
    lowerProbe = { amountInRaw: highInput - 1n, amountOutRaw: lowerOutput }
    if (lowerOutput >= input.targetAmountOutRaw) {
      throw new Error('Exact-input sizing invariant failed: adjacent lower input still reaches target.')
    }
  }

  return {
    status: 'quoted',
    minimum: { amountInRaw: highInput, amountOutRaw: highOutput },
    lowerProbe,
    probes,
  }
}
