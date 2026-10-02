export type JurisdictionGate = {
  status: 'blocked' | 'dev_override'
  enforced: boolean
  devOverrideApplied: boolean
  detail: string
  disclaimer: string
}

const BLOCKED_DETAIL = 'No approved jurisdiction policy or trusted location-verification source is configured. All plans remain blocked until eligibility can be checked.'
const DISCLAIMER = 'Product availability and use may be restricted by your jurisdiction. This plan does not determine your legal eligibility; do not use the service where it is prohibited.'

/**
 * The bypass is deliberately limited to local development. Every request that
 * consumes an active override emits a conspicuous warning.
 */
export function getJurisdictionGate(): JurisdictionGate {
  const requested = process.env.JURISDICTION_DEV_OVERRIDE?.trim().toLowerCase() === 'true'
  const development = process.env.NODE_ENV === 'development'
  const devOverrideApplied = requested && development

  if (devOverrideApplied) {
    console.warn('⚠️ JURISDICTION CHECK BYPASSED — DEV ONLY')
  }

  return devOverrideApplied
    ? {
        status: 'dev_override',
        enforced: false,
        devOverrideApplied: true,
        detail: 'Jurisdiction eligibility was not checked. The local development-only override bypassed this gate.',
        disclaimer: DISCLAIMER,
      }
    : {
        status: 'blocked',
        enforced: true,
        devOverrideApplied: false,
        detail: BLOCKED_DETAIL,
        disclaimer: DISCLAIMER,
      }
}
