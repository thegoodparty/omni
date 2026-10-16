import { describe, expect, it } from 'vitest'
import {
  ANSWERS_NEEDED_UNCORRECTED,
  answersNeeded,
} from './AnswersNeeded.const'

describe('answersNeeded', () => {
  it('starts from about 96 answers before correcting for size', () => {
    expect(ANSWERS_NEEDED_UNCORRECTED).toBeCloseTo(96.04, 2)
  })

  it('needs about 96 answers in most districts', () => {
    expect(answersNeeded(32_000)).toBe(96)
    expect(answersNeeded(1_000_000)).toBe(96)
  })

  it('needs fewer answers in a small district', () => {
    expect(answersNeeded(2_000)).toBe(92)
    expect(answersNeeded(500)).toBe(81)
  })

  it('falls back to the uncorrected figure when the population is unknown', () => {
    expect(answersNeeded(null)).toBe(96)
    expect(answersNeeded(undefined)).toBe(96)
    expect(answersNeeded(0)).toBe(96)
  })
})
