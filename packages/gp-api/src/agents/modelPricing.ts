import type { StepUsage } from './aiSdkLoop'

// List prices per million tokens, USD. Copied from the judge's
// src/chats/evals/judge/pricing.ts because the production build leaves
// src/chats/evals out; modelPricing.test.ts keeps the two equal.
export const MODEL_RATES: Record<
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
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
}

// Null for a model with no price on record, rather than a guess.
export const stepCostUsd = (model: string, usage: StepUsage): number | null => {
  const rates = MODEL_RATES[model]
  if (!rates) return null
  const uncached =
    usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens
  return (
    (uncached * rates.input +
      usage.outputTokens * rates.output +
      usage.cacheReadTokens * rates.cacheRead +
      usage.cacheWriteTokens * rates.cacheWrite) /
    1_000_000
  )
}
