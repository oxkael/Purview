export type StructuredIntent = {
  targetAsset: 'USDG'
  targetAmount: number
  restrictedAsset: 'NVDA'
  maxSellPercentage: number
}

export type IntentParseResult =
  | StructuredIntent
  | { status: 'clarification_required'; field: string; question: string }
  | { status: 'unsupported'; error: 'UNSUPPORTED_ASSET'; detail: string }
  | { status: 'invalid'; error: 'INVALID_INTENT'; detail: string }

type MissingField = 'targetAmount' | 'targetAsset' | 'restrictedAsset' | 'maxSellPercentage'

const clarificationQuestions: Record<MissingField, string> = {
  targetAmount: 'How much USDG do you need?',
  targetAsset: 'Which asset do you want to receive? This backend currently supports USDG.',
  restrictedAsset: 'Which asset are you limiting the sale of? This backend currently supports NVDA.',
  maxSellPercentage: 'What is the maximum percentage of your NVDA you are willing to sell?',
}

function parseAmount(text: string): number | undefined {
  const match = text.match(/\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)/)
    ?? text.match(/\b(?:need|get|receive|borrow)\s+([0-9][0-9,]*(?:\.[0-9]+)?)\s+USDG\b/i)
  if (!match) return undefined

  const rawAmount = match[1]
  if (!rawAmount) return undefined
  const amount = Number(rawAmount.replaceAll(',', ''))
  return Number.isFinite(amount) && amount > 0 ? amount : undefined
}

function targetAssetFromText(text: string): string | undefined {
  if (/\bUSDG\b/i.test(text)) return 'USDG'

  const amountThenAsset = text.match(/\$\s*[0-9][0-9,]*(?:\.[0-9]+)?\s+(USDC|USDT|USD|ETH|BTC|NVDA|SOL)\b/i)
    ?? text.match(/\b(?:need|get|receive|borrow)\s+[0-9][0-9,]*(?:\.[0-9]+)?\s+(USDC|USDT|USD|ETH|BTC|NVDA|SOL)\b/i)
  const rawAsset = amountThenAsset?.[1]
  return rawAsset?.toUpperCase()
}

function saleLimitFromText(text: string): { percentage: number; asset: string } | undefined {
  const match = text.match(/(?:without\s+selling\s+more\s+than|sell(?:ing)?\s+(?:no\s+more\s+than|at\s+most|up\s+to)|(?:no\s+more\s+than|at\s+most|up\s+to))\s+(\d+(?:\.\d+)?)\s*%\s*(?:of\s+)?(?:my\s+)?([A-Z][A-Z0-9]{1,11})\b/i)
  if (!match) return undefined

  const rawPercentage = match[1]
  const rawAsset = match[2]
  if (!rawPercentage || !rawAsset) return undefined
  const percentage = Number(rawPercentage)
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) return undefined
  return { percentage, asset: rawAsset.toUpperCase() }
}

function restrictedAssetFromText(text: string): string | undefined {
  const reference = text.match(/\b(?:of\s+)?my\s+(NVDA|[A-Z][A-Z0-9]{1,11})\b/i)
    ?? text.match(/\b(?:sell|selling|liquidate|dispose\s+of)\b[^.]{0,50}\b(NVDA|[A-Z][A-Z0-9]{1,11})\b/i)
  const rawAsset = reference?.[1]
  return rawAsset?.toUpperCase()
}

export function parseIntent(text: string): IntentParseResult {
  const amount = parseAmount(text)
  const asset = targetAssetFromText(text)
  const saleLimit = saleLimitFromText(text)
  const restrictedAsset = saleLimit?.asset ?? restrictedAssetFromText(text)

  if (!amount && /\$\s*[0-9]/.test(text)) {
    return { status: 'invalid', error: 'INVALID_INTENT', detail: 'The requested amount must be a positive finite number.' }
  }
  if (saleLimit === undefined && /(?:without\s+selling\s+more\s+than|sell(?:ing)?\s+(?:no\s+more\s+than|at\s+most|up\s+to)|(?:no\s+more\s+than|at\s+most|up\s+to))\s+\d+(?:\.\d+)?\s*%/i.test(text)) {
    return { status: 'invalid', error: 'INVALID_INTENT', detail: 'The maximum sale percentage must be between 0 and 100, and must name the asset.' }
  }

  if (asset && asset !== 'USDG') {
    return { status: 'unsupported', error: 'UNSUPPORTED_ASSET', detail: `Target asset ${asset} is not supported; this backend currently supports USDG.` }
  }
  if (restrictedAsset && restrictedAsset !== 'NVDA') {
    return { status: 'unsupported', error: 'UNSUPPORTED_ASSET', detail: `Restricted asset ${restrictedAsset} is not supported; this backend currently supports NVDA.` }
  }

  const missing: MissingField | undefined = !amount ? 'targetAmount'
    : !asset ? 'targetAsset'
      : !restrictedAsset ? 'restrictedAsset'
        : saleLimit === undefined ? 'maxSellPercentage'
          : undefined
  if (missing) {
    return { status: 'clarification_required', field: missing, question: clarificationQuestions[missing] }
  }

  if (amount === undefined || saleLimit === undefined) {
    return { status: 'invalid', error: 'INVALID_INTENT', detail: 'The request could not be parsed without ambiguity.' }
  }

  return {
    targetAsset: 'USDG',
    targetAmount: amount,
    restrictedAsset: 'NVDA',
    maxSellPercentage: saleLimit.percentage,
  }
}
