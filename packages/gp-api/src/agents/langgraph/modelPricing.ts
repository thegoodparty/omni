import type { UsageMetadata } from '@langchain/core/messages'

// Anthropic list prices per million tokens (cache write at the 5-minute
// rate), the same figures the judge's pricing table uses. Web search fees
// are not counted.
const RATES: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  'claude-sonnet-4-6': {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
}

// LangChain's Anthropic input_tokens already includes the cached tokens.
export const usageCostUsd = (
  model: string,
  usage: UsageMetadata | undefined,
): number => {
  const rates = RATES[model]
  if (!rates || !usage) return 0
  const cacheRead = usage.input_token_details?.cache_read ?? 0
  const cacheWrite = usage.input_token_details?.cache_creation ?? 0
  const fresh = Math.max(0, usage.input_tokens - cacheRead - cacheWrite)
  return (
    (fresh * rates.input +
      cacheRead * rates.cacheRead +
      cacheWrite * rates.cacheWrite +
      usage.output_tokens * rates.output) /
    1_000_000
  )
}
