import { describe, expect, it } from 'vitest'
import {
  draftTokenTotals,
  estimateCostUsd,
  rateForModel,
} from './ordinanceCost.util'

describe('ordinanceCost.util', () => {
  it('matches a full model id to its family rate by substring', () => {
    expect(rateForModel('claude-sonnet-4-6')).toEqual({
      inputPerM: 3,
      outputPerM: 15,
    })
    expect(rateForModel('claude-opus-4-7')).toEqual({
      inputPerM: 15,
      outputPerM: 75,
    })
    expect(rateForModel('claude-haiku-4-5')).toEqual({
      inputPerM: 0.8,
      outputPerM: 4,
    })
  })

  it('falls back to the sonnet-class rate for an unknown model', () => {
    // Unknown bills at the common case, never zero (which would hide cost).
    expect(rateForModel('some-future-model')).toEqual({
      inputPerM: 3,
      outputPerM: 15,
    })
  })

  it('derives cost from input/output tokens at the model rate', () => {
    // 1M sonnet input = $3, 1M output = $15.
    expect(estimateCostUsd('claude-sonnet-4-6', 1_000_000, 1_000_000)).toBe(18)
    // Opus is pricier: 100k in = $1.50, 20k out = $1.50.
    expect(estimateCostUsd('claude-opus-4-7', 100_000, 20_000)).toBeCloseTo(
      3,
      5,
    )
    expect(estimateCostUsd('claude-sonnet-4-6', 0, 0)).toBe(0)
  })

  it('rolls up the per-draft total from flow + manual QC + loop columns', () => {
    const totals = draftTokenTotals({
      flowInputTokens: 700_000,
      flowOutputTokens: 18_000,
      qcInputTokens: 20_000,
      qcOutputTokens: 1_500,
      loopInputTokens: 40_000,
      loopOutputTokens: 3_000,
    })
    // Sums each split across all three sources; iteration-row tokens are NOT
    // part of this (they'd double-count the loop columns).
    expect(totals).toEqual({ inputTokens: 760_000, outputTokens: 22_500 })
    // And it prices through the same helper.
    expect(
      estimateCostUsd(
        'claude-sonnet-4-6',
        totals.inputTokens,
        totals.outputTokens,
      ),
    ).toBeCloseTo(760_000e-6 * 3 + 22_500e-6 * 15, 6)
  })
})
