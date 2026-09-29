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
 * Sign only a digest returned by the deployed router's executionDigest view.
 * This helper is intentionally not exposed through an HTTP route. Its caller must
 * have already passed every deterministic execution gate and simulation.
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

  const signature = await account.signMessage({ message: { raw: digest as Hex } })
  return { signer: account.address, signature }
}
