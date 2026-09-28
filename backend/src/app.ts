import Fastify from 'fastify'
import { getIntegrationStatus } from './integrations/status.js'
import { getPortfolio } from './integrations/portfolio.js'
import { getAddress } from 'viem'
import { getNvdaToUsdgPrice, getNvdaToUsdgQuote, parseTakerAddress, ZeroXError } from './integrations/zeroX.js'
import { parseIntent } from './intent.js'
import { getReadOnlyPlanPreflight } from './planner.js'
import type { StructuredIntent } from './intent.js'
import { getUniswapNvdaToUsdgQuotes } from './integrations/uniswap.js'

export function buildApp() {
  const app = Fastify({ logger: true })

  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'purview-backend',
    scope: 'process-health-only',
  }))

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
      return reply.send(preflight)
    } catch (error) {
      request.log.error({ err: error }, 'Read-only plan preflight failed')
      return reply.code(503).send({
        error: 'INTEGRATION_UNAVAILABLE',
        detail: error instanceof Error ? error.message : 'Live state required for planning could not be retrieved.',
      })
    }
  })

  app.get('/api/integrations/status', async (_request, reply) => {
    const status = await getIntegrationStatus()
    const rpcAvailable = status.network.rpc.status === 'available'
    return reply.code(rpcAvailable ? 200 : 503).send(status)
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
