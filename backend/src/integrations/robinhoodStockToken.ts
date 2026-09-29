import { configuredContracts } from '../config.js'

const assetsUrl = 'https://api.robinhood.com/rhj/assets'

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown Robinhood Stock Token API error.'
}

function capabilitySchema(value: unknown): 'session_map' | 'tradability_flags' | 'unknown' | 'missing' {
  if (!isRecord(value)) return 'missing'
  if ('market' in value || 'extended' in value || 'overnight' in value) return 'session_map'
  if ('fractionalTradability' in value || 'allDayTradability' in value || 'extendedHoursFractionalTradability' in value) {
    return 'tradability_flags'
  }
  return 'unknown'
}

function assessAllSessionTradability(value: unknown): { status: 'available' | 'blocked' | 'unverified'; detail: string } {
  if (!isRecord(value) || capabilitySchema(value) !== 'session_map') {
    return {
      status: 'unverified',
      detail: 'The response does not contain the per-session whole/fractional capability map needed for a conservative check.',
    }
  }

  const sessions = ['market', 'extended', 'overnight'] as const
  const restrictions: string[] = []
  for (const session of sessions) {
    const sessionValue = value[session]
    if (!isRecord(sessionValue)) {
      restrictions.push(`${session}: missing session data`)
      continue
    }
    for (const size of ['whole', 'fractional'] as const) {
      if (sessionValue[size] !== 'TRADING_STATUS_TRADABLE') {
        restrictions.push(`${session}.${size}: ${String(sessionValue[size] ?? 'missing')}`)
      }
    }
  }

  if (restrictions.length > 0) {
    return {
      status: 'blocked',
      detail: `SELL/HYBRID require the official registry to report whole and fractional trading as TRADABLE in every session because the current session class is not independently resolved. Restrictions: ${restrictions.join(', ')}.`,
    }
  }
  return {
    status: 'available',
    detail: 'Official Robinhood registry reports whole and fractional NVDA as TRADABLE in market, extended, and overnight sessions.',
  }
}

/** Reads the official Stock Token registry; it does not infer wallet eligibility or execution permission. */
export async function getRobinhoodNvdaRegistryStatus() {
  const checkedAt = new Date().toISOString()
  try {
    const response = await fetch(assetsUrl, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) {
      return {
        status: 'unavailable' as const,
        checkedAt,
        source: assetsUrl,
        detail: `Robinhood Stock Token assets endpoint returned HTTP ${response.status}.`,
      }
    }

    const payload: unknown = await response.json()
    if (!isRecord(payload) || !Array.isArray(payload.assets)) {
      return {
        status: 'unavailable' as const,
        checkedAt,
        source: assetsUrl,
        detail: 'Robinhood Stock Token assets response did not match the documented { assets: [] } shape.',
      }
    }

    const nvdaEntries = payload.assets.filter((asset): asset is JsonRecord =>
      isRecord(asset) && typeof asset.tokenSymbol === 'string' && asset.tokenSymbol.toUpperCase() === 'NVDA',
    )
    const deployedEntry = nvdaEntries.find((asset) => Array.isArray(asset.deployments)
      && asset.deployments.some((deployment) => isRecord(deployment)
        && deployment.chainId === 4663
        && typeof deployment.contractAddress === 'string'
        && deployment.contractAddress.toLowerCase() === configuredContracts.nvda.toLowerCase()))

    if (!deployedEntry) {
      return {
        status: 'mismatch' as const,
        checkedAt,
        source: assetsUrl,
        expectedChainId: 4663,
        expectedAddress: configuredContracts.nvda,
        sellCapability: { status: 'unverified' as const, detail: 'Canonical token deployment was not verified.' },
        detail: nvdaEntries.length > 0
          ? 'The official registry lists NVDA, but no Robinhood Chain deployment matches the configured token address.'
          : 'The official registry did not list an NVDA Stock Token.',
      }
    }

    const capabilities = deployedEntry.tradingCapabilities
    const capabilityStatus = capabilitySchema(capabilities)
    const sellCapability = assessAllSessionTradability(capabilities)
    const assetStatus = deployedEntry.status
    return {
      status: assetStatus === 'ASSET_STATUS_ACTIVE' ? 'available' as const : 'inactive' as const,
      checkedAt,
      source: assetsUrl,
      freshness: 'origin_timestamp_not_provided' as const,
      tokenSymbol: 'NVDA',
      assetStatus: typeof assetStatus === 'string' ? assetStatus : 'unknown',
      chainId: 4663,
      tokenAddress: configuredContracts.nvda,
      tradingCapabilities: isRecord(capabilities) ? capabilities : null,
      tradingCapabilitiesSchema: capabilityStatus,
      sellCapability,
      detail: assetStatus !== 'ASSET_STATUS_ACTIVE'
        ? 'Official registry identity matches, but the asset is not active.'
        : sellCapability.status === 'available'
          ? `Official registry identity matches. ${sellCapability.detail}`
          : `Official registry identity matches, but session tradeability did not pass. ${sellCapability.detail}`,
    }
  } catch (error) {
    return {
      status: 'unavailable' as const,
      checkedAt,
      source: assetsUrl,
      detail: errorMessage(error),
    }
  }
}
