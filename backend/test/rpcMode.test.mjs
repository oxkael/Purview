import test from 'node:test'
import assert from 'node:assert/strict'
import { isLoopbackRpcUrl } from '../dist/config.js'

test('recognizes loopback RPC URLs for local-fork isolation', () => {
  for (const url of [
    'http://127.0.0.1:8545',
    'http://127.0.0.2:8545',
    'http://localhost:8545',
    'http://[::1]:8545',
  ]) assert.equal(isLoopbackRpcUrl(url), true, url)
})

test('does not classify remote or malformed RPC URLs as loopback', () => {
  for (const url of [
    'https://rpc.mainnet.chain.robinhood.com',
    'https://robinhood-rpc.publicnode.com',
    'http://127.0.0.1.attacker.example:8545',
    'not a URL',
  ]) assert.equal(isLoopbackRpcUrl(url), false, url)
})
