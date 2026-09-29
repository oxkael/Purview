import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { getAddress, type Address } from 'viem'
import type { StructuredIntent } from './intent.js'

const TOKEN_VERSION = 1
const TOKEN_TTL_MS = 120_000
const HASH_PATTERN = /^[0-9a-f]{64}$/

export type PlanReferencePayload = {
  version: 1
  address: Address
  intent: StructuredIntent
  candidateHash: string
  issuedAt: number
  expiresAt: number
}

export type PlanReferenceErrorCode =
  | 'PLAN_REFERENCE_SECRET_UNCONFIGURED'
  | 'PLAN_REFERENCE_SECRET_INVALID'
  | 'PLAN_REFERENCE_INVALID'
  | 'PLAN_REFERENCE_EXPIRED'

export class PlanReferenceError extends Error {
  constructor(readonly code: PlanReferenceErrorCode, message: string) {
    super(message)
    this.name = 'PlanReferenceError'
  }
}

function getSecret(): string {
  const secret = process.env.PURVIEW_PLAN_REFERENCE_SECRET?.trim()
  if (!secret) {
    throw new PlanReferenceError(
      'PLAN_REFERENCE_SECRET_UNCONFIGURED',
      'Plan recheck is unavailable until PURVIEW_PLAN_REFERENCE_SECRET is configured.',
    )
  }
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new PlanReferenceError(
      'PLAN_REFERENCE_SECRET_INVALID',
      'PURVIEW_PLAN_REFERENCE_SECRET must contain at least 32 UTF-8 bytes.',
    )
  }
  return secret
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const entries = Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    return `{${entries.join(',')}}`
  }
  throw new TypeError('Plan candidate contains a non-JSON value.')
}

export function hashPlanCandidate(candidate: unknown): string {
  return createHash('sha256').update(canonicalJson(candidate)).digest('hex')
}

function signPayload(encodedPayload: string, secret: string): string {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url')
}

export function issuePlanReference(input: {
  address: Address
  intent: StructuredIntent
  candidate: unknown
  now?: number
}): { token: string; expiresAt: number } {
  const secret = getSecret()
  const now = input.now ?? Date.now()
  const payload: PlanReferencePayload = {
    version: TOKEN_VERSION,
    address: getAddress(input.address),
    intent: input.intent,
    candidateHash: hashPlanCandidate(input.candidate),
    issuedAt: now,
    expiresAt: now + TOKEN_TTL_MS,
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return { token: `${encodedPayload}.${signPayload(encodedPayload, secret)}`, expiresAt: payload.expiresAt }
}

export function verifyPlanReference(token: string, now = Date.now()): PlanReferencePayload {
  const secret = getSecret()
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new PlanReferenceError('PLAN_REFERENCE_INVALID', 'Plan reference format is invalid.')
  }
  const [encodedPayload, suppliedSignature] = parts as [string, string]
  const expectedSignature = signPayload(encodedPayload, secret)
  const supplied = Buffer.from(suppliedSignature, 'base64url')
  const expected = Buffer.from(expectedSignature, 'base64url')
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new PlanReferenceError('PLAN_REFERENCE_INVALID', 'Plan reference signature is invalid.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
  } catch {
    throw new PlanReferenceError('PLAN_REFERENCE_INVALID', 'Plan reference payload is invalid.')
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new PlanReferenceError('PLAN_REFERENCE_INVALID', 'Plan reference payload is invalid.')
  }
  const payload = parsed as Partial<PlanReferencePayload>
  if (
    payload.version !== TOKEN_VERSION ||
    typeof payload.address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(payload.address) ||
    !payload.intent || typeof payload.intent !== 'object' ||
    typeof payload.candidateHash !== 'string' || !HASH_PATTERN.test(payload.candidateHash) ||
    typeof payload.issuedAt !== 'number' || !Number.isSafeInteger(payload.issuedAt) ||
    typeof payload.expiresAt !== 'number' || !Number.isSafeInteger(payload.expiresAt) ||
    payload.expiresAt <= payload.issuedAt || payload.expiresAt - payload.issuedAt > TOKEN_TTL_MS
  ) {
    throw new PlanReferenceError('PLAN_REFERENCE_INVALID', 'Plan reference fields are invalid.')
  }
  if (payload.issuedAt > now + 30_000) {
    throw new PlanReferenceError('PLAN_REFERENCE_INVALID', 'Plan reference issue time is in the future.')
  }
  if (payload.expiresAt <= now) {
    throw new PlanReferenceError('PLAN_REFERENCE_EXPIRED', 'Plan reference expired; request a fresh plan.')
  }
  return {
    version: TOKEN_VERSION,
    address: getAddress(payload.address),
    intent: payload.intent,
    candidateHash: payload.candidateHash,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
  }
}
