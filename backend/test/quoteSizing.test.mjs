import test from 'node:test'
import assert from 'node:assert/strict'
import { findMinimumExactInputForOutput } from '../dist/quoteSizing.js'

test('finds the least integer input whose exact quote meets the output target', async () => {
  const result = await findMinimumExactInputForOutput({
    targetAmountOutRaw: 1_000n,
    maximumAmountInRaw: 10_000n,
    quoteExactInput: async (amountInRaw) => amountInRaw * 3n,
  })
  assert.equal(result.status, 'quoted')
  assert.equal(result.minimum.amountInRaw, 334n)
  assert.equal(result.minimum.amountOutRaw, 1_002n)
  assert.equal(result.lowerProbe.amountInRaw, 333n)
  assert.equal(result.lowerProbe.amountOutRaw, 999n)
})

test('reports target unreachable at the maximum permitted sale', async () => {
  const result = await findMinimumExactInputForOutput({
    targetAmountOutRaw: 1_000n,
    maximumAmountInRaw: 100n,
    quoteExactInput: async (amountInRaw) => amountInRaw * 2n,
  })
  assert.deepEqual(result, {
    status: 'unavailable', reason: 'TARGET_NOT_REACHED',
    maxProbe: { amountInRaw: 100n, amountOutRaw: 200n }, lowerBound: null, probes: 1,
  })
})

test('rejects zero target or zero maximum input without calling the quoter', async () => {
  let calls = 0
  const result = await findMinimumExactInputForOutput({
    targetAmountOutRaw: 0n, maximumAmountInRaw: 100n,
    quoteExactInput: async () => { calls += 1; return 1n },
  })
  assert.equal(result.status, 'unavailable')
  assert.equal(result.reason, 'INVALID_INPUT')
  assert.equal(calls, 0)
})

test('propagates quote failures instead of treating them as small outputs', async () => {
  await assert.rejects(findMinimumExactInputForOutput({
    targetAmountOutRaw: 100n, maximumAmountInRaw: 200n,
    quoteExactInput: async () => { throw new Error('RPC timeout') },
  }), /RPC timeout/)
})
