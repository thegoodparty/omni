import { describe, expect, it } from 'vitest'
import {
  isHighConfidence,
  PRICE_PER_TEXT,
  recommendedSampleSize,
} from './SampleSizing.const'

describe('recommendedSampleSize', () => {
  it('sizes for 83 replies at a 3% reply rate by default', () => {
    expect(recommendedSampleSize({ audience: 58_520 })).toBe(2_767)
  })

  it('uses the reply rate it is given', () => {
    expect(recommendedSampleSize({ audience: 58_520, replyRate: 0.05 })).toBe(
      1_660,
    )
  })

  it('sizes only for the replies still missing', () => {
    expect(
      recommendedSampleSize({ audience: 58_520, repliesAlready: 50 }),
    ).toBe(1_100)
  })

  it('never asks for more people than the audience holds', () => {
    expect(recommendedSampleSize({ audience: 1_200 })).toBe(1_200)
  })

  it('never asks for more people than one draw can take', () => {
    expect(recommendedSampleSize({ audience: 500_000, replyRate: 0.001 })).toBe(
      10_000,
    )
  })

  it('asks nobody once the replies are in', () => {
    expect(
      recommendedSampleSize({ audience: 58_520, repliesAlready: 90 }),
    ).toBe(0)
  })
})

describe('isHighConfidence', () => {
  it('holds past 75 replies', () => {
    expect(isHighConfidence({ replies: 76, population: 100_000 })).toBe(true)
    expect(isHighConfidence({ replies: 75, population: 100_000 })).toBe(false)
  })

  it('holds once replies reach 10% of the population', () => {
    expect(isHighConfidence({ replies: 40, population: 400 })).toBe(true)
    expect(isHighConfidence({ replies: 39, population: 400 })).toBe(false)
  })

  it('does not divide by an empty population', () => {
    expect(isHighConfidence({ replies: 10, population: 0 })).toBe(false)
  })
})

describe('PRICE_PER_TEXT', () => {
  it('is 3.5 cents', () => {
    expect(PRICE_PER_TEXT).toBe(0.035)
  })
})
