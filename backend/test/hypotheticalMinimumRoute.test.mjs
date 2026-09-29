import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../dist/app.js'

test('hypothetical endpoint validates both amount bounds before RPC work', async () => {
  const app = buildApp()
  await app.ready()
  try {
    const response = await app.inject({ method: 'GET', url: '/api/uniswap/minimum-input/nvda-to-usdg?targetUsdg=3000' })
    assert.equal(response.statusCode, 400)
    assert.equal(response.json().error, 'INVALID_INTENT')
  } finally {
    await app.close()
  }
})
