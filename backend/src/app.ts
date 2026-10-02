import Fastify from 'fastify'
import { getIntegrationStatus } from './integrations/status.js'
import { getPortfolio } from './integrations/portfolio.js'
import { createPublicClient, getAddress, http, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { getNvdaToUsdgPrice, getNvdaToUsdgQuote, parseTakerAddress, ZeroXError } from './integrations/zeroX.js'
import { parseIntent } from './intent.js'
import { getReadOnlyPlanPreflight } from './planner.js'
import type { StructuredIntent } from './intent.js'
import { getMinimumUniswapNvdaInputForUsdg, getUniswapNvdaToUsdgQuotes } from './integrations/uniswap.js'
import { hashPlanCandidate, issuePlanReference, PlanReferenceError, verifyPlanReference } from './planReference.js'
import { isLoopbackRpcUrl, mainnetRpcUrl, robinhoodMainnet } from './config.js'
import { buildExecutionCallTemplate } from './executionCallTemplate.js'
import { simulateLocalForkRouterCall } from './executionSimulation.js'
import { getJurisdictionGate } from './jurisdiction.js'

const routerReadAbi = [
  { type: 'function', name: 'executionSigner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const

export function buildApp() {
  const app = Fastify({ logger: true })

  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'purview-backend',
    scope: 'process-health-only',
  }))

  app.get('/api/runtime', async () => {
    const rpc = new URL(mainnetRpcUrl)
    const localFork = isLoopbackRpcUrl(mainnetRpcUrl)
    return {
      expectedChainId: 4663,
      environment: localFork ? 'local-fork' : 'configured-rpc',
      rpcHost: rpc.host,
      transactionSubmission: 'disabled',
      detail: localFork
        ? 'Backend reads are routed to a loopback RPC. This is a local fork environment; no mainnet transaction is submitted.'
        : 'Backend reads use the configured remote RPC. The UI does not submit transactions.',
    }
  })

  app.post<{ Body: { text?: unknown } }>('/api/intent', async (request, reply) => {
    const text = request.body?.text
    if (typeof text !== 'string' || text.trim().length === 0 || text.length > 2_000) {
      return reply.code(400).send({
        status: 'invalid',
        error: 'INVALID_INTENT',
        detail: 'Provide a non-empty text field of at most 2000 characters.',
      })
    }

    const result = parseIntent(text.trim())
    if ('status' in result && result.status === 'unsupported') {
      return reply.code(422).send(result)
    }
    if ('status' in result && result.status === 'invalid') {
      return reply.code(400).send(result)
    }
    return reply.send(result)
  })

  app.post<{ Body: { address?: unknown; intent?: unknown } }>('/api/plan', async (request, reply) => {
    const { address: rawAddress, intent: rawIntent } = request.body ?? {}
    if (typeof rawAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(rawAddress)) {
      return reply.code(400).send({ error: 'INVALID_INTENT', detail: 'Provide a valid wallet address.' })
    }
    if (!rawIntent || typeof rawIntent !== 'object') {
      return reply.code(400).send({ error: 'INVALID_INTENT', detail: 'Provide the structured intent returned by POST /api/intent.' })
    }

    const intent = rawIntent as Partial<StructuredIntent>
    if (
      intent.targetAsset !== 'USDG' ||
      typeof intent.targetAmount !== 'number' || !Number.isFinite(intent.targetAmount) || intent.targetAmount <= 0 ||
      intent.restrictedAsset !== 'NVDA' ||
      typeof intent.maxSellPercentage !== 'number' || !Number.isFinite(intent.maxSellPercentage) ||
      intent.maxSellPercentage < 0 || intent.maxSellPercentage > 100
    ) {
      return reply.code(400).send({ error: 'INVALID_INTENT', detail: 'Intent must specify a positive USDG target amount, NVDA restricted asset, and an explicit maximum sale percentage from 0 to 100.' })
    }

    try {
      const preflight = await getReadOnlyPlanPreflight(getAddress(rawAddress), intent as StructuredIntent)
      const selected = (preflight.planAnalysis as { selected?: unknown } | undefined)?.selected
      let planReference: { status: string; token?: string; expiresAt?: number; detail: string }
      if (selected) {
        try {
          const issued = issuePlanReference({ address: getAddress(rawAddress), intent: intent as StructuredIntent, candidate: selected })
          planReference = {
            status: 'available',
            token: issued.token,
            expiresAt: issued.expiresAt,
            detail: 'Short-lived integrity reference for rechecking this diagnostic candidate. It is not an execution authorization.',
          }
        } catch (error) {
          planReference = {
            status: 'unavailable',
            detail: error instanceof PlanReferenceError ? error.message : 'Plan reference could not be issued.',
          }
        }
      } else {
        planReference = { status: 'not_available', detail: 'No selected candidate exists to bind for recheck.' }
      }
      return reply.send({ ...preflight, planReference })
    } catch (error) {
      request.log.error({ err: error }, 'Read-only plan preflight failed')
      return reply.code(503).send({
        error: 'INTEGRATION_UNAVAILABLE',
        detail: error instanceof Error ? error.message : 'Live state required for planning could not be retrieved.',
      })
    }
  })

  app.post<{ Body: { planReference?: unknown; confirmed?: unknown } }>('/api/plan/recheck', async (request, reply) => {
    const { planReference: rawPlanReference, confirmed } = request.body ?? {}
    if (typeof rawPlanReference !== 'string' || rawPlanReference.length > 8_192) {
      return reply.code(400).send({
        error: 'INVALID_INTENT',
        detail: 'Provide the short-lived planReference returned by POST /api/plan.',
      })
    }
    if (confirmed !== true) {
      return reply.code(400).send({
        error: 'INVALID_INTENT',
        detail: 'Set confirmed to true only after the user has reviewed the plan they intend to recheck.',
      })
    }

    let reference
    try {
      reference = verifyPlanReference(rawPlanReference)
    } catch (error) {
      if (error instanceof PlanReferenceError) {
        const statusCode = error.code === 'PLAN_REFERENCE_EXPIRED' ? 409
          : error.code === 'PLAN_REFERENCE_SECRET_UNCONFIGURED' || error.code === 'PLAN_REFERENCE_SECRET_INVALID' ? 503
            : 400
        return reply.code(statusCode).send({ error: error.code, detail: error.message, executable: false })
      }
      return reply.code(400).send({ error: 'PLAN_REFERENCE_INVALID', detail: 'Plan reference could not be verified.', executable: false })
    }

    try {
      const preflight = await getReadOnlyPlanPreflight(reference.address, reference.intent)
      const selected = (preflight.planAnalysis as { selected?: unknown } | undefined)?.selected
      if (!selected || hashPlanCandidate(selected) !== reference.candidateHash) {
        return reply.code(409).send({
          error: 'EXECUTION_BLOCKED',
          status: 'stale_plan',
          executable: false,
          detail: 'The selected candidate changed or is no longer available after refreshing live state. Request and review a new plan.',
          refreshedPlan: preflight,
        })
      }
      let callTemplate: { status: 'template_only'; method: string; arguments: unknown; route: unknown } | { status: 'unavailable'; detail: string }
      let recheckBlockNumber: bigint | undefined
      try {
        const snapshot = (preflight as { snapshot?: { blockNumber?: unknown } }).snapshot
        if (typeof snapshot?.blockNumber !== 'string' || !/^\d+$/.test(snapshot.blockNumber)) {
          throw new Error('The refreshed plan did not include a valid pinned snapshot block.')
        }
        recheckBlockNumber = BigInt(snapshot.blockNumber)
        const client = createPublicClient({
          chain: robinhoodMainnet,
          transport: http(mainnetRpcUrl, { timeout: 5_000, retryCount: 0 }),
        })
        const block = await client.getBlock({ blockNumber: recheckBlockNumber })
        const freshness = preflight.oracleFreshnessForPlan as { maxAgeSeconds?: number | null } | undefined
        const template = buildExecutionCallTemplate(selected, {
          blockTimestamp: block.timestamp,
          sellOracleMaxAgeSeconds: freshness?.maxAgeSeconds ?? null,
        })
        callTemplate = { status: 'template_only', ...template }
      } catch (error) {
        callTemplate = {
          status: 'unavailable',
          detail: error instanceof Error ? error.message : 'A fixed router-call template could not be prepared.',
        }
      }
      let simulation: Record<string, unknown> = {
        status: 'not_attempted',
        detail: 'No selected, constraint-passing candidate and recheck block are available to simulate.',
      }
      if (callTemplate.status === 'template_only' && recheckBlockNumber !== undefined) {
        try {
          simulation = await simulateLocalForkRouterCall({
            user: reference.address,
            template: {
              method: callTemplate.method as 'executeSell' | 'executeBorrow' | 'executeHybrid',
              arguments: callTemplate.arguments as Record<string, unknown>,
            },
            blockNumber: recheckBlockNumber,
          })
        } catch (error) {
          simulation = {
            status: 'unavailable',
            detail: error instanceof Error ? error.message : 'The read-only router eth_call could not be completed.',
          }
        }
      }
      return reply.send({
        status: preflight.status,
        executable: false,
        unchanged: true,
        executionPreparation: {
          status: 'blocked',
          callTemplate,
          simulation,
          routerAddressConfigured: Boolean(process.env.PURVIEW_ROUTER_ADDRESS?.trim()),
          signerConfigured: Boolean(process.env.PURVIEW_EXECUTION_SIGNER_PRIVATE_KEY?.trim()),
          jurisdiction: (preflight as { jurisdictionGate?: { status?: string } }).jurisdictionGate?.status ?? 'blocked',
          blockers: (preflight as { blockers?: unknown[] }).blockers ?? [],
          detail: 'The fixed-method template comes from the freshly rechecked candidate. Local-fork simulation may create an ephemeral signature solely for eth_call; it returns no signature or calldata and submits no transaction. The dev-only jurisdiction override, if active, does not enable transaction submission.',
        },
        refreshedPlan: preflight,
      })
    } catch (error) {
      request.log.error({ err: error }, 'Confirmed plan recheck failed')
      return reply.code(503).send({
        error: 'EXECUTION_BLOCKED',
        executable: false,
        detail: error instanceof Error ? error.message : 'Fresh plan state could not be retrieved; execution remains blocked.',
      })
    }
  })

  app.get('/api/integrations/status', async (_request, reply) => {
    const status = await getIntegrationStatus()
    const rpcAvailable = status.network.rpc.status === 'available'
    return reply.code(rpcAvailable ? 200 : 503).send(status)
  })

  app.get('/api/execution/readiness', async (request, reply) => {
    const rawRouterAddress = process.env.PURVIEW_ROUTER_ADDRESS?.trim()
    const rawSignerKey = process.env.PURVIEW_EXECUTION_SIGNER_PRIVATE_KEY?.trim()
    const checks: Record<string, unknown> = {
      routerAddress: rawRouterAddress
        ? { status: /^0x[0-9a-fA-F]{40}$/.test(rawRouterAddress) ? 'configured' : 'invalid', address: /^0x[0-9a-fA-F]{40}$/.test(rawRouterAddress) ? getAddress(rawRouterAddress) : undefined }
        : { status: 'not_configured', detail: 'PURVIEW_ROUTER_ADDRESS is not set.' },
      signerKey: rawSignerKey ? { status: 'configured' } : { status: 'not_configured', detail: 'PURVIEW_EXECUTION_SIGNER_PRIVATE_KEY is not set.' },
      jurisdiction: getJurisdictionGate(),
      signing: { status: 'disabled', detail: 'This endpoint is read-only. It does not sign authorizations or submit transactions.' },
    }

    let derivedSigner: string | undefined
    if (rawSignerKey) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(rawSignerKey)) {
        checks.signerKey = { status: 'invalid', detail: 'Configured signer key has an invalid format.' }
      } else {
        try {
          derivedSigner = privateKeyToAccount(rawSignerKey as `0x${string}`).address
          checks.signerKey = { status: 'configured', address: derivedSigner }
        } catch {
          checks.signerKey = { status: 'invalid', detail: 'Configured signer key is not a valid secp256k1 private key.' }
        }
      }
    }

    if (!rawRouterAddress || !/^0x[0-9a-fA-F]{40}$/.test(rawRouterAddress)) {
      checks.routerCode = { status: 'not_checked', detail: 'A valid PURVIEW_ROUTER_ADDRESS is required before checking deployment bytecode.' }
      checks.signerMatch = { status: 'not_checked', detail: 'The deployed router signer cannot be compared until router bytecode is found.' }
      return reply.send({ status: 'blocked', executable: false, expectedChainId: 4663, checks })
    }

    try {
      const client = createPublicClient({ chain: robinhoodMainnet, transport: http(mainnetRpcUrl, { timeout: 5_000 }) })
      const [chainId, code] = await Promise.all([client.getChainId(), client.getBytecode({ address: getAddress(rawRouterAddress) })])
      checks.chain = { status: chainId === 4663 ? 'available' : 'wrong_chain', chainId }
      if (chainId !== 4663) {
        checks.routerCode = { status: 'not_checked', detail: 'Router bytecode is checked only on Robinhood Chain (4663).' }
        checks.signerMatch = { status: 'not_checked', detail: 'The configured RPC does not report Robinhood Chain.' }
        return reply.code(503).send({ status: 'unavailable', executable: false, expectedChainId: 4663, chainId, checks })
      }
      if (!code || code === '0x') {
        checks.routerCode = { status: 'not_deployed', detail: 'No contract bytecode exists at PURVIEW_ROUTER_ADDRESS on Robinhood Chain.' }
        checks.signerMatch = { status: 'not_checked', detail: 'The configured address has no router bytecode.' }
      } else {
        checks.routerCode = { status: 'deployed', codeBytes: (code.length - 2) / 2 }
        const deployedSigner = await client.readContract({ address: getAddress(rawRouterAddress), abi: routerReadAbi, functionName: 'executionSigner' })
        checks.signerMatch = derivedSigner
          ? { status: deployedSigner.toLowerCase() === derivedSigner.toLowerCase() ? 'matched' : 'mismatch', deployedSigner, configuredSigner: derivedSigner }
          : { status: 'signer_key_missing', deployedSigner, detail: 'Set the dedicated key locally only after verifying the router deployment.' }
      }
      return reply.send({ status: 'blocked', executable: false, expectedChainId: 4663, chainId, checks })
    } catch (error) {
      request.log.warn({ err: error }, 'Router execution-readiness RPC check failed')
      checks.routerCode = { status: 'unavailable', detail: error instanceof Error ? error.message : 'Router deployment could not be checked.' }
      checks.signerMatch = { status: 'not_checked', detail: 'Router deployment state is unavailable.' }
      return reply.code(503).send({ status: 'unavailable', executable: false, expectedChainId: 4663, checks })
    }
  })

  app.get<{ Querystring: { address?: string } }>('/api/portfolio', async (request, reply) => {
    const rawAddress = request.query.address
    if (!rawAddress || !/^0x[0-9a-fA-F]{40}$/.test(rawAddress)) {
      return reply.code(400).send({ error: 'INVALID_INTENT', detail: 'Provide a valid EVM wallet address in the address query parameter.' })
    }

    try {
      const portfolio = await getPortfolio(getAddress(rawAddress))
      return reply.send(portfolio)
    } catch (error) {
      request.log.error({ err: error }, 'Live portfolio read failed')
      return reply.code(503).send({
        error: 'INTEGRATION_UNAVAILABLE',
        detail: error instanceof Error ? error.message : 'Live portfolio state could not be retrieved.',
      })
    }
  })

  app.get<{ Querystring: { sellAmountRaw?: string; taker?: string } }>('/api/quotes/nvda-to-usdg', async (request, reply) => {
    const { sellAmountRaw, taker: rawTaker } = request.query
    if (!sellAmountRaw) {
      return reply.code(400).send({ error: 'INVALID_INTENT', detail: 'Provide sellAmountRaw as a positive integer token amount in base units.' })
    }
    if (!rawTaker) {
      return reply.code(400).send({ error: 'INVALID_INTENT', detail: 'Provide a valid EVM wallet address in the taker query parameter.' })
    }
    const taker = parseTakerAddress(rawTaker)
    if (!taker) {
      return reply.code(400).send({ error: 'INVALID_INTENT', detail: 'The taker query parameter must be a valid EVM wallet address.' })
    }

    try {
      const quote = await getNvdaToUsdgQuote(sellAmountRaw, taker)
      return reply.send(quote)
    } catch (error) {
      if (error instanceof ZeroXError) {
        return reply.code(error.statusCode).send({ error: error.statusCode === 403 ? 'TRADE_RESTRICTED' : 'QUOTE_UNAVAILABLE', detail: error.message })
      }
      request.log.error({ err: error }, 'Live 0x quote request failed')
      return reply.code(502).send({ error: 'QUOTE_UNAVAILABLE', detail: 'Live 0x quote could not be retrieved.' })
    }
  })

  app.get<{ Querystring: { amountInRaw?: string } }>('/api/uniswap/quotes/nvda-to-usdg', async (request, reply) => {
    const { amountInRaw } = request.query
    if (!amountInRaw || !/^\d+$/.test(amountInRaw) || BigInt(amountInRaw) <= 0n) {
      return reply.code(400).send({ error: 'INVALID_INTENT', detail: 'Provide amountInRaw as a positive integer NVDA amount in base units.' })
    }

    try {
      return reply.send(await getUniswapNvdaToUsdgQuotes(amountInRaw))
    } catch (error) {
      request.log.error({ err: error }, 'Read-only Uniswap V3 quote failed')
      return reply.code(502).send({
        error: 'QUOTE_UNAVAILABLE',
        detail: error instanceof Error ? error.message : 'Uniswap V3 quote could not be retrieved.',
      })
    }
  })

  app.get<{ Querystring: { targetUsdg?: string; maximumNvda?: string } }>('/api/uniswap/minimum-input/nvda-to-usdg', async (request, reply) => {
    const { targetUsdg, maximumNvda } = request.query
    const decimalPattern = /^(?:0|[1-9]\d*)(?:\.\d+)?$/
    if (!targetUsdg || !maximumNvda || !decimalPattern.test(targetUsdg) || !decimalPattern.test(maximumNvda)) {
      return reply.code(400).send({
        error: 'INVALID_INTENT',
        detail: 'Provide positive decimal targetUsdg and maximumNvda query values, for example targetUsdg=3000&maximumNvda=20.',
      })
    }

    let targetOutRaw: bigint
    let maximumInRaw: bigint
    try {
      targetOutRaw = parseUnits(targetUsdg, 6)
      maximumInRaw = parseUnits(maximumNvda, 18)
    } catch {
      return reply.code(400).send({
        error: 'INVALID_INTENT',
        detail: 'USDG supports at most 6 decimal places and NVDA at most 18 decimal places.',
      })
    }
    if (targetOutRaw <= 0n || maximumInRaw <= 0n || targetOutRaw >= 2n ** 256n || maximumInRaw >= 2n ** 256n) {
      return reply.code(400).send({ error: 'INVALID_INTENT', detail: 'Target and maximum NVDA input must be positive uint256-sized token amounts.' })
    }

    try {
      const quote = await getMinimumUniswapNvdaInputForUsdg(targetOutRaw.toString(), maximumInRaw.toString())
      return reply.send({
        ...quote,
        executable: false,
        diagnosticOnly: true,
        walletOwnershipChecked: false,
        maximumInputIsHypothetical: true,
        disclaimer: 'This read-only quote does not check whether the wallet owns NVDA, does not create a plan, and cannot be executed. The supplied maximum is only a quote-search bound.',
      })
    } catch (error) {
      request.log.error({ err: error }, 'Hypothetical Uniswap minimum-input quote failed')
      return reply.code(502).send({
        error: 'QUOTE_UNAVAILABLE',
        detail: error instanceof Error ? error.message : 'Minimum-input quote could not be retrieved from Uniswap V3.',
        executable: false,
      })
    }
  })

  app.get<{ Querystring: { sellAmountRaw?: string; taker?: string } }>('/api/prices/nvda-to-usdg', async (request, reply) => {
    const { sellAmountRaw, taker: rawTaker } = request.query
    if (!sellAmountRaw) {
      return reply.code(400).send({ error: 'INVALID_INTENT', detail: 'Provide sellAmountRaw as a positive integer token amount in base units.' })
    }
    let taker
    if (rawTaker) {
      taker = parseTakerAddress(rawTaker)
      if (!taker) {
        return reply.code(400).send({ error: 'INVALID_INTENT', detail: 'The optional taker query parameter must be a valid EVM wallet address.' })
      }
    }

    try {
      const price = await getNvdaToUsdgPrice(sellAmountRaw, taker)
      return reply.send(price)
    } catch (error) {
      if (error instanceof ZeroXError) {
        return reply.code(error.statusCode).send({ error: error.statusCode === 403 ? 'TRADE_RESTRICTED' : 'PRICE_UNAVAILABLE', detail: error.message })
      }
      request.log.error({ err: error }, 'Live 0x price request failed')
      return reply.code(502).send({ error: 'PRICE_UNAVAILABLE', detail: 'Live 0x price could not be retrieved.' })
    }
  })

  return app
}
