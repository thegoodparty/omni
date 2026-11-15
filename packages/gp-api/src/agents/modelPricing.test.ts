import { describe, expect, it } from 'vitest'
import { priceUsd, ratesFor } from '@/chats/evals/judge/pricing'
import { MODEL_RATES, stepCostUsd } from './modelPricing'

describe('modelPricing', () => {
  it('matches the judge price table for every model it lists', () => {
    for (const [model, rates] of Object.entries(MODEL_RATES)) {
      expect(ratesFor(model)).toEqual({
        inputPerMillion: rates.input,
        outputPerMillion: rates.output,
        cacheReadPerMillion: rates.cacheRead,
        cacheWritePerMillion: rates.cacheWrite,
      })
    }
  })

  it('prices a step as the judge does, counting cache tokens apart from input', () => {
    const usage = {
      inputTokens: 10_000,
      outputTokens: 500,
      cacheReadTokens: 6_000,
      cacheWriteTokens: 2_000,
    }
    expect(stepCostUsd('claude-sonnet-4-6', usage)).toBeCloseTo(
      priceUsd(
        { input: 2_000, output: 500, cacheRead: 6_000, cacheWrite: 2_000 },
        'claude-sonnet-4-6',
      ),
    )
  })

  it('has no price for a model it does not list', () => {
    expect(
      stepCostUsd('some-new-model', {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBeNull()
  })
})
