import { createPublicClient, http, type Address } from 'viem'
import { configuredContracts, longbowNvdaUsdgMarket, robinhoodMainnet, serverConfig } from '../config.js'

const client = createPublicClient({
  chain: robinhoodMainnet,
  transport: http(undefined, { timeout: serverConfig.rpcTimeoutMs, retryCount: 0 }),
})

const erc20Abi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
] as const

const morphoAbi = [
  { type: 'function', name: 'position', stateMutability: 'view', inputs: [{ name: 'id', type: 'bytes32' }, { name: 'user', type: 'address' }], outputs: [{ name: 'position', type: 'tuple', components: [{ name: 'supplyShares', type: 'uint256' }, { name: 'borrowShares', type: 'uint128' }, { name: 'collateral', type: 'uint128' }] }] },
  { type: 'function', name: 'market', stateMutability: 'view', inputs: [{ name: 'id', type: 'bytes32' }], outputs: [{ name: 'totalSupplyAssets', type: 'uint128' }, { name: 'totalSupplyShares', type: 'uint128' }, { name: 'totalBorrowAssets', type: 'uint128' }, { name: 'totalBorrowShares', type: 'uint128' }, { name: 'lastUpdate', type: 'uint128' }, { name: 'fee', type: 'uint128' }] },
  { type: 'function', name: 'isAuthorized', stateMutability: 'view', inputs: [{ name: 'authorizer', type: 'address' }, { name: 'authorized', type: 'address' }], outputs: [{ name: 'isAuthorized', type: 'bool' }] },
] as const

const marketOracleAbi = [{
  type: 'function', name: 'price', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }],
}] as const

const irmAbi = [{
  type: 'function',
  name: 'borrowRateView',
  stateMutability: 'view',
  inputs: [
    { name: 'marketParams', type: 'tuple', components: [
      { name: 'loanToken', type: 'address' },
      { name: 'collateralToken', type: 'address' },
      { name: 'oracle', type: 'address' },
      { name: 'irm', type: 'address' },
      { name: 'lltv', type: 'uint256' },
    ] },
    { name: 'market', type: 'tuple', components: [
      { name: 'totalSupplyAssets', type: 'uint128' },
      { name: 'totalSupplyShares', type: 'uint128' },
      { name: 'totalBorrowAssets', type: 'uint128' },
      { name: 'totalBorrowShares', type: 'uint128' },
      { name: 'lastUpdate', type: 'uint128' },
      { name: 'fee', type: 'uint128' },
    ] },
  ],
  outputs: [{ name: 'rate', type: 'uint256' }],
}] as const

const WAD = 10n ** 18n

// Mirrors Morpho Blue MathLib.wTaylorCompounded and _accrueInterest rounding.
function accruedInterest(totalBorrowAssets: bigint, borrowRate: bigint, elapsedSeconds: bigint): bigint {
  const firstTerm = borrowRate * elapsedSeconds
  const secondTerm = (firstTerm * firstTerm) / (2n * WAD)
  const thirdTerm = (secondTerm * firstTerm) / (3n * WAD)
  const compounded = firstTerm + secondTerm + thirdTerm
  return (totalBorrowAssets * compounded) / WAD
}

function sharesToAssetsUp(shares: bigint, assets: bigint, totalShares: bigint): bigint {
  if (shares === 0n) return 0n
  if (totalShares === 0n) throw new Error('Morpho market has borrower shares but zero total borrow shares.')
  const numerator = shares * assets
  return (numerator + totalShares - 1n) / totalShares
}

export async function getPortfolio(address: Address) {
  const [chainId, blockNumber] = await Promise.all([client.getChainId(), client.getBlockNumber()])
  if (chainId !== robinhoodMainnet.id) {
    throw new Error(`Configured RPC returned chain ${chainId}; expected ${robinhoodMainnet.id}.`)
  }

  const block = await client.getBlock({ blockNumber })

  const [usdgBalance, usdgDecimals, nvdaBalance, nvdaDecimals, usdgAllowanceToMorpho, nvdaAllowanceToMorpho, nvdaAllowanceToBundles, bundleAuthorized, position, market, marketOraclePrice] = await Promise.all([
    client.readContract({ address: configuredContracts.usdg, abi: erc20Abi, functionName: 'balanceOf', args: [address], blockNumber }),
    client.readContract({ address: configuredContracts.usdg, abi: erc20Abi, functionName: 'decimals', blockNumber }),
    client.readContract({ address: configuredContracts.nvda, abi: erc20Abi, functionName: 'balanceOf', args: [address], blockNumber }),
    client.readContract({ address: configuredContracts.nvda, abi: erc20Abi, functionName: 'decimals', blockNumber }),
    client.readContract({ address: configuredContracts.usdg, abi: erc20Abi, functionName: 'allowance', args: [address, configuredContracts.morphoBlue], blockNumber }),
    client.readContract({ address: configuredContracts.nvda, abi: erc20Abi, functionName: 'allowance', args: [address, configuredContracts.morphoBlue], blockNumber }),
    client.readContract({ address: configuredContracts.nvda, abi: erc20Abi, functionName: 'allowance', args: [address, configuredContracts.morphoBlueBundlesV1], blockNumber }),
    client.readContract({ address: configuredContracts.morphoBlue, abi: morphoAbi, functionName: 'isAuthorized', args: [address, configuredContracts.morphoBlueBundlesV1], blockNumber }),
    client.readContract({ address: configuredContracts.morphoBlue, abi: morphoAbi, functionName: 'position', args: [longbowNvdaUsdgMarket.id, address], blockNumber }),
    client.readContract({ address: configuredContracts.morphoBlue, abi: morphoAbi, functionName: 'market', args: [longbowNvdaUsdgMarket.id], blockNumber }),
    client.readContract({ address: longbowNvdaUsdgMarket.oracle, abi: marketOracleAbi, functionName: 'price', blockNumber }),
  ])

  const marketLastUpdate = market[4]
  const marketTotalBorrowAssets = market[2]
  const marketTotalBorrowShares = market[3]
  const elapsedSeconds = block.timestamp > marketLastUpdate ? block.timestamp - marketLastUpdate : 0n
  const borrowRate = longbowNvdaUsdgMarket.irm === '0x0000000000000000000000000000000000000000'
    ? 0n
    : await client.readContract({
        address: longbowNvdaUsdgMarket.irm,
        abi: irmAbi,
        functionName: 'borrowRateView',
        args: [
          {
            loanToken: longbowNvdaUsdgMarket.loanToken,
            collateralToken: longbowNvdaUsdgMarket.collateralToken,
            oracle: longbowNvdaUsdgMarket.oracle,
            irm: longbowNvdaUsdgMarket.irm,
            lltv: longbowNvdaUsdgMarket.lltvWad,
          },
          {
            totalSupplyAssets: market[0],
            totalSupplyShares: market[1],
            totalBorrowAssets: market[2],
            totalBorrowShares: market[3],
            lastUpdate: market[4],
            fee: market[5],
          },
        ],
        blockNumber,
      })
  const accrued = accruedInterest(marketTotalBorrowAssets, borrowRate, elapsedSeconds)
  const expectedTotalBorrowAssets = marketTotalBorrowAssets + accrued
  const debtAssets = sharesToAssetsUp(position.borrowShares, expectedTotalBorrowAssets, marketTotalBorrowShares)

  return {
    status: 'available' as const,
    address,
    chainId,
    blockNumber: blockNumber.toString(),
    readAt: new Date(Number(block.timestamp) * 1000).toISOString(),
    balances: {
      usdg: { token: configuredContracts.usdg, raw: usdgBalance.toString(), decimals: usdgDecimals },
      nvda: { token: configuredContracts.nvda, raw: nvdaBalance.toString(), decimals: nvdaDecimals },
    },
    approvals: {
      nvdaAllowanceToMorphoRaw: nvdaAllowanceToMorpho.toString(),
      usdgAllowanceToMorphoRaw: usdgAllowanceToMorpho.toString(),
      nvdaAllowanceToBlueBundlesV1Raw: nvdaAllowanceToBundles.toString(),
      blueBundlesV1MorphoAuthorization: bundleAuthorized,
      spender: configuredContracts.morphoBlue,
      blueBundlesV1: configuredContracts.morphoBlueBundlesV1,
      note: 'Direct supplyCollateral requires NVDA allowance to Morpho. The atomic BlueBundlesV1 path requires NVDA allowance (or a supported token permit) to BlueBundlesV1 and Morpho position authorization (or a signed authorization). USDG allowance is for repayment, not borrowing.',
    },
    longbowNvdaUsdg: {
      marketId: longbowNvdaUsdgMarket.id,
      collateralRaw: position.collateral.toString(),
      borrowSharesRaw: position.borrowShares.toString(),
      debtAssetsRaw: debtAssets.toString(),
      accruedInterestRaw: accrued.toString(),
      accrualElapsedSeconds: elapsedSeconds.toString(),
      borrowRatePerSecondWad: borrowRate.toString(),
      marketSupplyAssetsRaw: market[0].toString(),
      marketSupplySharesRaw: market[1].toString(),
      supplySharesRaw: position.supplyShares.toString(),
      marketBorrowAssetsRaw: marketTotalBorrowAssets.toString(),
      marketBorrowSharesRaw: marketTotalBorrowShares.toString(),
      lastAccrualTimestamp: marketLastUpdate.toString(),
      marketFeeWad: market[5].toString(),
      marketOraclePriceRaw: marketOraclePrice.toString(),
      note: 'Debt assets are calculated from the live Morpho market and IRM state at the reported block using Morpho Blue interest accrual and round-up share conversion. Values remain raw loan-token units; no USD valuation is reported.',
    },
  }
}
