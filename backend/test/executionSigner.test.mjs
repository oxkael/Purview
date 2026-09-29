import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyMessage } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { ExecutionSignerError, signExecutionDigest } from '../dist/executionSigner.js'

const testPrivateKey = `0x${'0'.repeat(63)}1`
const testAccount = privateKeyToAccount(testPrivateKey)
const digest = `0x${'12'.repeat(32)}`

test('signs a 32-byte router digest only with the configured router signer', async () => {
  const signed = await signExecutionDigest(digest, testAccount.address, testPrivateKey)
  assert.equal(signed.signer, testAccount.address)
  assert.equal(await verifyMessage({
    address: testAccount.address,
    message: { raw: digest },
    signature: signed.signature,
  }), true)
})

test('refuses to sign when no dedicated execution key is configured', async () => {
  await assert.rejects(
    signExecutionDigest(digest, testAccount.address, undefined),
    (error) => error instanceof ExecutionSignerError && error.code === 'EXECUTION_SIGNER_UNCONFIGURED',
  )
})

test('refuses a key that does not match the router immutable signer', async () => {
  await assert.rejects(
    signExecutionDigest(digest, `0x${'22'.repeat(20)}`, testPrivateKey),
    (error) => error instanceof ExecutionSignerError && error.code === 'EXECUTION_SIGNER_MISMATCH',
  )
})

test('refuses malformed digests and malformed private keys', async () => {
  await assert.rejects(
    signExecutionDigest('0x1234', testAccount.address, testPrivateKey),
    (error) => error instanceof ExecutionSignerError && error.code === 'INVALID_EXECUTION_DIGEST',
  )
  await assert.rejects(
    signExecutionDigest(digest, testAccount.address, 'not-a-private-key'),
    (error) => error instanceof ExecutionSignerError && error.code === 'EXECUTION_SIGNER_INVALID',
  )
})
