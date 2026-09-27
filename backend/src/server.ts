import { buildApp } from './app.js'
import { serverConfig } from './config.js'

const app = buildApp()

try {
  await app.listen({ host: serverConfig.host, port: serverConfig.port })
} catch (error) {
  app.log.error(error)
  process.exitCode = 1
}
