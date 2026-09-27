import { createPublicClient, http, type Address } from 'viem'
import { configuredContracts, robinhoodMainnet, serverConfig } from '../config.js'

const client = createPublicClient({
  chain: robinhoodMainnet,
  transport: http(undefined, { timeout: serverConfig.rpcTimeoutMs, retryCount: 0 }),
})

const bundleAbi = [
  { type: 'function', name: 'BLUE', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'PUBLIC_ALLOCATOR', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
] as const

function sameAddress(actual: Address, expected: Address) {
  return actual.toLowerCase() === expected.toLowerCase()
}

export async function getBlueBundlesStatus() {
  try {
    const [blue, publicAllocator] = await Promise.all([
      client.readContract({ address: configuredContracts.morphoBlueBundlesV1, abi: bundleAbi, functionName: 'BLUE' }),
      client.readContract({ address: configuredContracts.morphoBlueBundlesV1, abi: bundleAbi, functionName: 'PUBLIC_ALLOCATOR' }),
    ])
    const matches = sameAddress(blue, configuredContracts.morphoBlue) &&
      sameAddress(publicAllocator, configuredContracts.morphoBluePublicAllocator)
    return {
      status: matches ? 'available' as const : 'blocked' as const,
      address: configuredContracts.morphoBlueBundlesV1,
      blue,
      expectedBlue: configuredContracts.morphoBlue,
      publicAllocator,
      expectedPublicAllocator: configuredContracts.morphoBluePublicAllocator,
      detail: matches
        ? 'The deployed Morpho BlueBundlesV1 getters match the official Morpho Robinhood Chain registry.'
        : 'The deployed BlueBundlesV1 immutable addresses differ from the official Morpho registry; use is blocked.',
    }
  } catch (error) {
    return {
      status: 'unavailable' as const,
      address: configuredContracts.morphoBlueBundlesV1,
      detail: error instanceof Error ? error.message : 'Unknown RPC error while reading BlueBundlesV1 configuration.',
    }
  }
}
