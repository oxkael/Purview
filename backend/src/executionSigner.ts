import { getAddress, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

export type ExecutionSignerErrorCode =
  | 'EXECUTION_SIGNER_UNCONFIGURED'
  | 'EXECUTION_SIGNER_INVALID'
  | 'EXECUTION_SIGNER_MISMATCH'
  | 'INVALID_EXECUTION_DIGEST'

export class ExecutionSignerError extends Error {
  constructor(readonly code: ExecutionSignerErrorCode, message: string) {
    super(message)
    this.name = 'ExecutionSignerError'
  }
}

const privateKeyPattern = /^0x[0-9a-fA-F]{64}$/
const bytes32Pattern = /^0x[0-9a-fA-F]{64}$/

/**
 * Sign only the final 32-byte digest returned by the deployed router's
 * executionDigest view. The router already applies the EIP-191 prefix before
 * returning this digest, so sign its hash directly; signMessage would prefix it twice.
 * This is not an execution-signing endpoint. Its current caller is the loopback-only
 * fork eth_call path, which discards the signature and submits no transaction.
 */
export async function signExecutionDigest(
  digest: string,
  expectedSignerAddress: Address,
  privateKey = process.env.PURVIEW_EXECUTION_SIGNER_PRIVATE_KEY?.trim(),
): Promise<{ signer: Address; signature: Hex }> {
  if (!bytes32Pattern.test(digest)) {
    throw new ExecutionSignerError('INVALID_EXECUTION_DIGEST', 'Execution digest must be exactly 32 bytes.')
  }
  if (!privateKey) {
    throw new ExecutionSignerError('EXECUTION_SIGNER_UNCONFIGURED', 'Dedicated execution signer is not configured.')
  }
  if (!privateKeyPattern.test(privateKey)) {
    throw new ExecutionSignerError('EXECUTION_SIGNER_INVALID', 'Dedicated execution signer key is malformed.')
  }

  let account
  try {
    account = privateKeyToAccount(privateKey as Hex)
  } catch {
    throw new ExecutionSignerError('EXECUTION_SIGNER_INVALID', 'Dedicated execution signer key is invalid.')
  }
  if (account.address.toLowerCase() !== getAddress(expectedSignerAddress).toLowerCase()) {
    throw new ExecutionSignerError(
      'EXECUTION_SIGNER_MISMATCH',
      'Configured execution key does not match the signer fixed in the router contract.',
    )
  }

  const signature = await account.sign({ hash: digest as Hex })
  return { signer: account.address, signature }
}
