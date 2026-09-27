import Fastify from 'fastify'
import { getIntegrationStatus } from './integrations/status.js'
import { getPortfolio } from './integrations/portfolio.js'
import { getAddress } from 'viem'

export function buildApp() {
  const app = Fastify({ logger: true })

  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'purview-backend',
    scope: 'process-health-only',
  }))

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

  return app
}
