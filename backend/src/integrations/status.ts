import { createPublicClient, http, type Address } from 'viem'
import { configuredContracts, robinhoodMainnet, serverConfig } from '../config.js'
import { getLongbowMarketStatus } from './longbow.js'
import { getLongbowOracleStatus } from './oracle.js'
import { getBlueBundlesStatus } from './morphoBundles.js'

const client = createPublicClient({
  chain: robinhoodMainnet,
  transport: http(undefined, { timeout: serverConfig.rpcTimeoutMs, retryCount: 0 }),
})

type ProbeStatus = 'available' | 'unavailable' | 'blocked' | 'not_checked'

type ContractProbe = {
  status: ProbeStatus
  address: Address
  codePresent?: boolean
  detail?: string
}

async function probeBytecode(address: Address): Promise<ContractProbe> {
  try {
    const bytecode = await client.getBytecode({ address })
    const codePresent = bytecode !== undefined && bytecode !== '0x'
    return {
      status: codePresent ? 'available' : 'unavailable',
      address,
      codePresent,
      detail: codePresent ? 'RPC returned contract bytecode; contract behavior is not verified.' : 'No contract bytecode returned at this address.',
    }
  } catch (error) {
    return {
      status: 'unavailable',
      address,
      detail: errorMessage(error),
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown RPC error'
}

async function getNvdaOraclePausedStatus() {
  try {
    const paused = await client.readContract({
      address: configuredContracts.nvda,
      abi: [{
        type: 'function',
        name: 'oraclePaused',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ name: '', type: 'bool' }],
      }] as const,
      functionName: 'oraclePaused',
    })

    return {
      status: paused ? 'blocked' as const : 'available' as const,
      address: configuredContracts.nvda,
      paused,
      detail: paused
        ? 'NVDA token oraclePaused() returned true; oracle use is vetoed.'
        : 'NVDA token oraclePaused() returned false.',
    }
  } catch (error) {
    return {
      status: 'unavailable' as const,
      address: configuredContracts.nvda,
      detail: `Could not read oraclePaused() from the NVDA token; oracle use is vetoed. ${errorMessage(error)}`,
    }
  }
}

export async function getIntegrationStatus() {
  let rpc: {
    status: ProbeStatus
    configuredChainId: number
    observedChainId?: number
    blockNumber?: string
    detail?: string
  }

  try {
    const [observedChainId, blockNumber] = await Promise.all([
      client.getChainId(),
      client.getBlockNumber(),
    ])
    const chainMatches = observedChainId === robinhoodMainnet.id
    rpc = {
      status: chainMatches ? 'available' : 'unavailable',
      configuredChainId: robinhoodMainnet.id,
      observedChainId,
      blockNumber: blockNumber.toString(),
      ...(chainMatches ? {} : { detail: 'RPC chain ID does not match configured mainnet chain ID.' }),
    }
  } catch (error) {
    rpc = {
      status: 'unavailable',
      configuredChainId: robinhoodMainnet.id,
      detail: errorMessage(error),
    }
  }

  // Do not make dependent contract calls when the endpoint reports a different
  // chain or cannot be reached. This avoids presenting wrong-chain data as valid.
  const contractProbes = rpc.status === 'available'
    ? await Promise.all([
        probeBytecode(configuredContracts.usdg),
        probeBytecode(configuredContracts.nvda),
        probeBytecode(configuredContracts.morphoBlue),
        probeBytecode(configuredContracts.morphoBlueBundlesV1),
        probeBytecode(configuredContracts.adaptiveCurveIrm),
      ])
    : []

  const longbowMarket = rpc.status === 'available'
    ? await getLongbowMarketStatus()
    : {
        status: 'not_checked' as const,
        marketId: '0x66306c087add8907752320b309934abcc354d21626de8115c79df49d9c214edc' as const,
        expectedLltvWad: '625000000000000000',
        detail: 'RPC chain was not verified.',
      }

  const longbowOracle = rpc.status === 'available'
    ? await getLongbowOracleStatus()
    : {
        status: 'not_checked' as const,
        detail: 'RPC chain was not verified.',
      }

  const nvdaTokenOracle = rpc.status === 'available'
    ? await getNvdaOraclePausedStatus()
    : {
        status: 'not_checked' as const,
        address: configuredContracts.nvda,
        detail: 'RPC chain was not verified; oraclePaused() was not read.',
      }

  const morphoBundles = rpc.status === 'available'
    ? await getBlueBundlesStatus()
    : { status: 'not_checked' as const, address: configuredContracts.morphoBlueBundlesV1, detail: 'RPC chain was not verified.' }

  const [usdg, nvda, morphoBlue, morphoBlueBundlesV1, adaptiveCurveIrm] = contractProbes

  return {
    checkedAt: new Date().toISOString(),
    network: {
      name: robinhoodMainnet.name,
      chainId: robinhoodMainnet.id,
      rpc,
    },
    contracts: rpc.status === 'available'
      ? { usdg, nvda, morphoBlue, morphoBlueBundlesV1, adaptiveCurveIrm }
      : {
          usdg: { status: 'not_checked' as const, address: configuredContracts.usdg, detail: 'RPC chain was not verified.' },
          nvda: { status: 'not_checked' as const, address: configuredContracts.nvda, detail: 'RPC chain was not verified.' },
          morphoBlue: { status: 'not_checked' as const, address: configuredContracts.morphoBlue, detail: 'RPC chain was not verified.' },
          morphoBlueBundlesV1: { status: 'not_checked' as const, address: configuredContracts.morphoBlueBundlesV1, detail: 'RPC chain was not verified.' },
          adaptiveCurveIrm: { status: 'not_checked' as const, address: configuredContracts.adaptiveCurveIrm, detail: 'RPC chain was not verified.' },
        },
    integrations: {
      zeroX: {
        status: serverConfig.zeroXApiKey ? 'blocked' as const : 'unavailable' as const,
        detail: serverConfig.zeroXApiKey
          ? 'API key is configured. Last live NVDA-to-USDG price request was rejected by 0x for legal restrictions; no route or execution is available unless 0x grants tokenized-equity access.'
          : 'ZEROX_API_KEY is not configured; live token-pair validation is unavailable.',
      },
      longbowMarket,
      morphoBlueBundlesV1: morphoBundles,
      chainlink: longbowOracle,
      nvdaTokenOracle,
      uniswapV3: {
        status: 'configured' as const,
        factory: '0x1f7d7550b1b028f7571e69a784071f0205fd2efa',
        quoterV2: '0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7',
        swapRouter02: '0xcaf681a66d020601342297493863e78c959e5cb2',
        allowlistedFees: [100, 500, 3000],
        detail: 'Read-only QuoterV2 path is implemented. Each quote verifies the allowlisted pool identity onchain; a fixed unsigned call builder exists but is not exposed until all plan gates are wired.',
      },
      router: {
        status: 'not_checked' as const,
        detail: 'The fixed unsigned call builder is not exposed or wired to signing, approvals, simulation, or submission. Uniswap SwapRouter02 is configured as the destination.',
      },
    },
    note: 'RPC reachability and bytecode presence are diagnostic checks only; they do not verify token identity, market support, ABI behavior, safety, or execution readiness.',
  }
}
