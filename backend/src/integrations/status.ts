import { createPublicClient, http, type Address } from 'viem'
import { configuredContracts, robinhoodMainnet, serverConfig } from '../config.js'
import { getLongbowMarketStatus } from './longbow.js'
import { getLongbowOracleStatus } from './oracle.js'

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

  const [usdg, nvda, morphoBlue, adaptiveCurveIrm] = contractProbes

  return {
    checkedAt: new Date().toISOString(),
    network: {
      name: robinhoodMainnet.name,
      chainId: robinhoodMainnet.id,
      rpc,
    },
    contracts: rpc.status === 'available'
      ? { usdg, nvda, morphoBlue, adaptiveCurveIrm }
      : {
          usdg: { status: 'not_checked' as const, address: configuredContracts.usdg, detail: 'RPC chain was not verified.' },
          nvda: { status: 'not_checked' as const, address: configuredContracts.nvda, detail: 'RPC chain was not verified.' },
          morphoBlue: { status: 'not_checked' as const, address: configuredContracts.morphoBlue, detail: 'RPC chain was not verified.' },
          adaptiveCurveIrm: { status: 'not_checked' as const, address: configuredContracts.adaptiveCurveIrm, detail: 'RPC chain was not verified.' },
        },
    integrations: {
      zeroX: {
        status: 'not_checked' as const,
        detail: 'A live quote and execution-path validation have not been performed.',
      },
      longbowMarket,
      chainlink: longbowOracle,
      router: {
        status: 'not_checked' as const,
        detail: 'No router contract has been implemented or deployed.',
      },
    },
    note: 'RPC reachability and bytecode presence are diagnostic checks only; they do not verify token identity, market support, ABI behavior, safety, or execution readiness.',
  }
}
