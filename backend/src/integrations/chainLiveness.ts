import { createPublicClient, http } from 'viem'
import { livenessRpcUrl, mainnetRpcUrl, robinhoodMainnet, serverConfig } from '../config.js'

function hostOf(rawUrl: string): string | undefined {
  try {
    return new URL(rawUrl).host.toLowerCase()
  } catch {
    return undefined
  }
}

function createClient(url: string) {
  return createPublicClient({
    chain: robinhoodMainnet,
    transport: http(url, { timeout: serverConfig.rpcTimeoutMs, retryCount: 0 }),
  })
}

/**
 * Conservative RPC-based chain-head liveness substitute. This checks that two
 * separately hosted RPC endpoints agree the L2 is producing recent blocks; it
 * is not a Chainlink sequencer-uptime feed and does not guarantee tx inclusion.
 */
export async function getChainLivenessStatus() {
  const primaryHost = hostOf(mainnetRpcUrl)
  const secondaryHost = hostOf(livenessRpcUrl)
  if (!livenessRpcUrl || !secondaryHost) {
    return {
      status: 'blocked' as const,
      detail: 'A second independently hosted Robinhood Chain RPC is required. Configure ROBINHOOD_LIVENESS_RPC_URL.',
    }
  }
  if (!primaryHost || primaryHost === secondaryHost) {
    return {
      status: 'blocked' as const,
      detail: 'Primary and liveness RPC endpoints must use different hosts to provide an independent cross-check.',
    }
  }

  try {
    const primary = createClient(mainnetRpcUrl)
    const secondary = createClient(livenessRpcUrl)
    const [primaryChainId, secondaryChainId, primaryBlockNumber, secondaryBlockNumber] = await Promise.all([
      primary.getChainId(), secondary.getChainId(), primary.getBlockNumber(), secondary.getBlockNumber(),
    ])
    if (primaryChainId !== robinhoodMainnet.id || secondaryChainId !== robinhoodMainnet.id) {
      return {
        status: 'blocked' as const,
        primaryChainId,
        secondaryChainId,
        detail: `Both RPC endpoints must report chain ID ${robinhoodMainnet.id}.`,
      }
    }
    const [primaryBlock, secondaryBlock] = await Promise.all([
      primary.getBlock({ blockNumber: primaryBlockNumber }),
      secondary.getBlock({ blockNumber: secondaryBlockNumber }),
    ])
    const nowSeconds = BigInt(Math.floor(Date.now() / 1_000))
    const primaryAge = nowSeconds >= primaryBlock.timestamp ? nowSeconds - primaryBlock.timestamp : null
    const secondaryAge = nowSeconds >= secondaryBlock.timestamp ? nowSeconds - secondaryBlock.timestamp : null
    const timestampSkew = primaryBlock.timestamp >= secondaryBlock.timestamp
      ? primaryBlock.timestamp - secondaryBlock.timestamp
      : secondaryBlock.timestamp - primaryBlock.timestamp
    const ageLimit = BigInt(serverConfig.livenessPolicy.maxBlockAgeSeconds)
    const skewLimit = BigInt(serverConfig.livenessPolicy.maxHeadTimestampSkewSeconds)
    const recent = primaryAge !== null && secondaryAge !== null
      && primaryAge <= ageLimit && secondaryAge <= ageLimit
    const aligned = timestampSkew <= skewLimit
    const available = recent && aligned

    return {
      status: available ? 'available' as const : 'blocked' as const,
      checkedAt: new Date().toISOString(),
      primaryHost,
      secondaryHost,
      chainId: robinhoodMainnet.id,
      primaryBlockNumber: primaryBlockNumber.toString(),
      secondaryBlockNumber: secondaryBlockNumber.toString(),
      primaryBlockTimestamp: primaryBlock.timestamp.toString(),
      secondaryBlockTimestamp: secondaryBlock.timestamp.toString(),
      primaryBlockAgeSeconds: primaryAge?.toString() ?? null,
      secondaryBlockAgeSeconds: secondaryAge?.toString() ?? null,
      headTimestampSkewSeconds: timestampSkew.toString(),
      policy: {
        maxBlockAgeSeconds: serverConfig.livenessPolicy.maxBlockAgeSeconds,
        maxHeadTimestampSkewSeconds: serverConfig.livenessPolicy.maxHeadTimestampSkewSeconds,
      },
      detail: !recent
        ? `At least one RPC head is future-dated or older than ${serverConfig.livenessPolicy.maxBlockAgeSeconds}s.`
        : !aligned
          ? `RPC head timestamps differ by more than ${serverConfig.livenessPolicy.maxHeadTimestampSkewSeconds}s.`
          : 'Two different RPC hosts report recent Robinhood Chain heads with timestamps within the configured skew.',
      limitation: 'RPC head liveness is a conservative substitute, not a sequencer uptime feed or a guarantee that a transaction will be included.',
    }
  } catch {
    return {
      status: 'blocked' as const,
      primaryHost,
      secondaryHost,
      // Provider errors can include full endpoint URLs (and API keys), so do
      // not return raw transport messages through the status endpoint.
      detail: 'RPC liveness check failed for at least one configured endpoint.',
    }
  }
}
