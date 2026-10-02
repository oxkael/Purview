import {
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  http,
  parseAbi,
  type Address,
  type Hex,
} from 'viem'
import { isLoopbackRpcUrl, mainnetRpcUrl, robinhoodMainnet } from './config.js'
import { signExecutionDigest } from './executionSigner.js'

const routerAbi = parseAbi([
  'function executionSigner() view returns (address)',
  'function sellExecutionDigest(address user,uint256 amountIn,uint256 maxSellAmount,uint256 minOutput,uint24 fee,uint256 oracleMaxAgeSeconds,uint256 deadline) view returns (bytes32)',
  'function borrowExecutionDigest(address user,uint256 borrowAmount,uint256 maxBorrowAmount,uint256 deadline) view returns (bytes32)',
  'function executionDigest(address user,uint256 amountIn,uint256 maxSellAmount,uint256 collateralToSupply,uint256 borrowAmount,uint256 maxBorrowAmount,uint256 minOutput,uint24 fee,uint256 deadline) view returns (bytes32)',
  'function executeSell(uint256 amountIn,uint256 maxSellAmount,uint256 minOutput,uint24 fee,uint256 oracleMaxAgeSeconds,uint256 deadline,bytes authorization) returns (uint256 amountOut)',
  'function executeBorrow(uint256 borrowAmount,uint256 maxBorrowAmount,uint256 deadline,bytes authorization) returns (uint256 amountBorrowed)',
  'function executeHybrid(uint256 amountIn,uint256 maxSellAmount,uint256 collateralToSupply,uint256 borrowAmount,uint256 maxBorrowAmount,uint256 minOutput,uint24 fee,uint256 deadline,bytes authorization) returns (uint256 amountOut,uint256 amountBorrowed)',
])

type CallTemplate = {
  method: 'executeSell' | 'executeBorrow' | 'executeHybrid'
  arguments: Record<string, unknown>
}

function argString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error(`Router call template has invalid ${key}.`)
  return value
}

function argNumber(args: Record<string, unknown>, key: string): number {
  const value = args[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Router call template has invalid ${key}.`)
  }
  return value
}

function localForkConfig(): { router: Address } | null {
  if (process.env.PURVIEW_LOCAL_FORK_SIMULATION?.trim().toLowerCase() !== 'true') return null
  if (!isLoopbackRpcUrl(mainnetRpcUrl)) return null
  const configured = process.env.PURVIEW_ROUTER_ADDRESS?.trim()
  if (!configured || !/^0x[0-9a-fA-F]{40}$/.test(configured)) return null
  return { router: getAddress(configured) }
}

/**
 * Sign a plan-derived authorization only for an explicitly enabled loopback
 * fork, then eth_call the deployed router at the recheck block. Never submits.
 */
export async function simulateLocalForkRouterCall(input: {
  user: Address
  template: CallTemplate
  blockNumber: bigint
}) {
  const config = localForkConfig()
  if (!config) {
    return {
      status: 'not_enabled' as const,
      detail: 'Local fork simulation requires PURVIEW_LOCAL_FORK_SIMULATION=true, a loopback RPC, and a configured router address.',
    }
  }

  const client = createPublicClient({
    chain: robinhoodMainnet,
    transport: http(mainnetRpcUrl, { timeout: 5_000, retryCount: 0 }),
  })
  const [chainId, code, snapshot] = await Promise.all([
    client.getChainId(),
    client.getBytecode({ address: config.router, blockNumber: input.blockNumber }),
    client.getBlock({ blockTag: 'latest' }),
  ])
  if (chainId !== 4663) throw new Error(`Local fork returned chain ID ${chainId}, expected 4663.`)
  if (!code || code === '0x') throw new Error('No router bytecode exists at the configured local fork address.')
  if (snapshot.number !== input.blockNumber) {
    throw new Error('Local fork head changed after recheck; refresh the plan before simulating.')
  }

  const signer = await client.readContract({ address: config.router, abi: routerAbi, functionName: 'executionSigner', blockNumber: input.blockNumber })
  const args = input.template.arguments
  let digest: Hex
  let data: Hex

  if (input.template.method === 'executeSell') {
    const callArgs = {
      amountIn: BigInt(argString(args, 'amountIn')),
      maxSellAmount: BigInt(argString(args, 'maxSellAmount')),
      minOutput: BigInt(argString(args, 'minOutput')),
      fee: argNumber(args, 'fee'),
      oracleMaxAgeSeconds: BigInt(argNumber(args, 'oracleMaxAgeSeconds')),
      deadline: BigInt(argString(args, 'deadline')),
    }
    digest = await client.readContract({
      address: config.router, abi: routerAbi, functionName: 'sellExecutionDigest',
      args: [input.user, callArgs.amountIn, callArgs.maxSellAmount, callArgs.minOutput, callArgs.fee, callArgs.oracleMaxAgeSeconds, callArgs.deadline],
      blockNumber: input.blockNumber,
    })
    const { signature } = await signExecutionDigest(digest, signer)
    data = encodeFunctionData({
      abi: routerAbi, functionName: 'executeSell',
      args: [callArgs.amountIn, callArgs.maxSellAmount, callArgs.minOutput, callArgs.fee, callArgs.oracleMaxAgeSeconds, callArgs.deadline, signature],
    })
  } else if (input.template.method === 'executeBorrow') {
    const callArgs = {
      borrowAmount: BigInt(argString(args, 'borrowAmount')),
      maxBorrowAmount: BigInt(argString(args, 'maxBorrowAmount')),
      deadline: BigInt(argString(args, 'deadline')),
    }
    digest = await client.readContract({
      address: config.router, abi: routerAbi, functionName: 'borrowExecutionDigest',
      args: [input.user, callArgs.borrowAmount, callArgs.maxBorrowAmount, callArgs.deadline],
      blockNumber: input.blockNumber,
    })
    const { signature } = await signExecutionDigest(digest, signer)
    data = encodeFunctionData({
      abi: routerAbi, functionName: 'executeBorrow',
      args: [callArgs.borrowAmount, callArgs.maxBorrowAmount, callArgs.deadline, signature],
    })
  } else {
    const callArgs = {
      amountIn: BigInt(argString(args, 'amountIn')),
      maxSellAmount: BigInt(argString(args, 'maxSellAmount')),
      collateralToSupply: BigInt(argString(args, 'collateralToSupply')),
      borrowAmount: BigInt(argString(args, 'borrowAmount')),
      maxBorrowAmount: BigInt(argString(args, 'maxBorrowAmount')),
      minOutput: BigInt(argString(args, 'minOutput')),
      fee: argNumber(args, 'fee'),
      deadline: BigInt(argString(args, 'deadline')),
    }
    digest = await client.readContract({
      address: config.router, abi: routerAbi, functionName: 'executionDigest',
      args: [input.user, callArgs.amountIn, callArgs.maxSellAmount, callArgs.collateralToSupply, callArgs.borrowAmount, callArgs.maxBorrowAmount, callArgs.minOutput, callArgs.fee, callArgs.deadline],
      blockNumber: input.blockNumber,
    })
    const { signature } = await signExecutionDigest(digest, signer)
    data = encodeFunctionData({
      abi: routerAbi, functionName: 'executeHybrid',
      args: [callArgs.amountIn, callArgs.maxSellAmount, callArgs.collateralToSupply, callArgs.borrowAmount, callArgs.maxBorrowAmount, callArgs.minOutput, callArgs.fee, callArgs.deadline, signature],
    })
  }

  let result
  try {
    result = await client.call({ account: input.user, to: config.router, data, blockNumber: input.blockNumber })
  } catch (error) {
    if (await client.getBlockNumber() !== snapshot.number) {
      throw new Error('Local fork head changed during eth_call; discard this simulation and refresh the plan.')
    }
    const detail = error && typeof error === 'object' && 'shortMessage' in error
      ? String(error.shortMessage)
      : error instanceof Error ? error.message : 'Router eth_call failed.'
    if (/revert/i.test(detail)) {
      return {
        status: 'reverted' as const,
        method: input.template.method,
        routerAddress: config.router,
        signerAddress: signer,
        blockNumber: input.blockNumber.toString(),
        transactionSubmitted: false as const,
        detail: detail.slice(0, 500),
      }
    }
    throw error
  }
  if (await client.getBlockNumber() !== snapshot.number) {
    throw new Error('Local fork head changed during eth_call; discard this simulation and refresh the plan.')
  }
  if (!result.data || result.data === '0x') throw new Error('Router eth_call returned no ABI result.')
  let amounts: string[]
  if (input.template.method === 'executeSell') {
    amounts = [String(decodeFunctionResult({ abi: routerAbi, functionName: 'executeSell', data: result.data }))]
  } else if (input.template.method === 'executeBorrow') {
    amounts = [String(decodeFunctionResult({ abi: routerAbi, functionName: 'executeBorrow', data: result.data }))]
  } else {
    amounts = decodeFunctionResult({ abi: routerAbi, functionName: 'executeHybrid', data: result.data }).map(String)
  }
  return {
    status: 'succeeded' as const,
    method: input.template.method,
    routerAddress: config.router,
    signerAddress: signer,
    blockNumber: input.blockNumber.toString(),
    returnValuesRaw: amounts,
    transactionSubmitted: false as const,
    detail: 'The plan-derived router call succeeded under eth_call at the recheck block. No transaction was submitted.',
  }
}
