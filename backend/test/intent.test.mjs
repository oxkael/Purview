import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../dist/app.js'
import { parseIntent } from '../dist/intent.js'

test('parses the documented USDG target and explicit NVDA sale limit', () => {
  assert.deepEqual(
    parseIntent('I need $3,000 USDG without selling more than 20% of my NVDA.'),
    { targetAsset: 'USDG', targetAmount: 3000, restrictedAsset: 'NVDA', maxSellPercentage: 20 },
  )
})

test('asks for a clarification instead of inventing a missing sale limit', () => {
  assert.deepEqual(parseIntent('I need $3,000 USDG from my NVDA.'), {
    status: 'clarification_required',
    field: 'maxSellPercentage',
    question: 'What is the maximum percentage of your NVDA you are willing to sell?',
  })
})

test('asks which target asset when the request only gives a dollar amount', () => {
  assert.equal(parseIntent('I need $3,000 from my NVDA, selling up to 20% of my NVDA.').field, 'targetAsset')
})

test('rejects an unsupported target asset', () => {
  assert.equal(parseIntent('I need $3,000 USDC without selling more than 20% of my NVDA.').error, 'UNSUPPORTED_ASSET')
})

test('rejects an unsupported restricted asset', () => {
  assert.equal(parseIntent('I need $3,000 USDG without selling more than 20% of my TSLA.').error, 'UNSUPPORTED_ASSET')
})

test('rejects a sale percentage above 100 instead of clamping it', () => {
  assert.equal(parseIntent('I need $3,000 USDG without selling more than 101% of my NVDA.').error, 'INVALID_INTENT')
})

test('intent HTTP route returns clarification and unsupported errors without chain calls', async (t) => {
  const app = buildApp()
  t.after(() => app.close())

  const clarification = await app.inject({
    method: 'POST', url: '/api/intent',
    payload: { text: 'I need $3,000 USDG from my NVDA.' },
  })
  assert.equal(clarification.statusCode, 200)
  assert.equal(clarification.json().status, 'clarification_required')
  assert.equal(clarification.json().field, 'maxSellPercentage')

  const unsupported = await app.inject({
    method: 'POST', url: '/api/intent',
    payload: { text: 'I need $3,000 USDC without selling more than 20% of my NVDA.' },
  })
  assert.equal(unsupported.statusCode, 422)
  assert.equal(unsupported.json().error, 'UNSUPPORTED_ASSET')
})

test('intent HTTP route rejects empty and oversized request text', async (t) => {
  const app = buildApp()
  t.after(() => app.close())

  const empty = await app.inject({ method: 'POST', url: '/api/intent', payload: { text: '  ' } })
  assert.equal(empty.statusCode, 400)
  assert.equal(empty.json().error, 'INVALID_INTENT')

  const oversized = await app.inject({ method: 'POST', url: '/api/intent', payload: { text: 'a'.repeat(2001) } })
  assert.equal(oversized.statusCode, 400)
  assert.equal(oversized.json().error, 'INVALID_INTENT')
})
