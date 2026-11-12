import { describe, expect, it } from 'vitest'
import { splitBatch } from '@/contacts/utils/civicPanelAllocation.util'
import { roundTwoDrawCutoff } from '@/outreach/services/outreachServeSmsCreate.service'
import { isUndrawnSample, unionDraws } from './roundTwo.util'

describe('roundTwoDrawCutoff', () => {
  // The Serve SMS create takes a date strictly more than two business days
  // out, so the last day a send could still be booked is three before it.
  it('reaches three business days ahead of a weekday', () => {
    // Monday the 19th: a Thursday send is drawn today.
    expect(roundTwoDrawCutoff(new Date('2026-10-19T17:00:00Z'))).toBe(
      '2026-10-22',
    )
    // Friday the 23rd: across the weekend to Wednesday.
    expect(roundTwoDrawCutoff(new Date('2026-10-23T17:00:00Z'))).toBe(
      '2026-10-28',
    )
  })

  it('draws nothing new on a weekend that Friday did not', () => {
    expect(roundTwoDrawCutoff(new Date('2026-10-24T17:00:00Z'))).toBe(
      '2026-10-28',
    )
  })

  // 05:00 UTC on Monday is still Sunday evening in Pacific, the day the
  // create measures from: Wednesday, not Monday's Thursday.
  it('counts from the Pacific day', () => {
    expect(roundTwoDrawCutoff(new Date('2026-10-19T05:00:00Z'))).toBe(
      '2026-10-21',
    )
  })
})

describe('unionDraws', () => {
  it('keeps the steered draw, then the unsteered one, once each', () => {
    expect(unionDraws(['a', 'b'], ['b', 'c'], 10)).toEqual(['a', 'b', 'c'])
  })

  it('never holds more than was paid for', () => {
    expect(unionDraws(['a', 'b', 'c'], ['d', 'e'], 4)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ])
  })

  // The unsteered part is asked for what the steered draw left, so a short
  // steered draw is made up from the unsteered pool.
  it('fills the paid size from both parts', () => {
    const size = 200
    const { steered } = splitBatch(size)
    const steeredIds = Array.from({ length: steered - 20 }, (_, i) => `s${i}`)
    const unsteeredIds = Array.from(
      { length: size - steeredIds.length },
      (_, i) => `u${i}`,
    )
    const union = unionDraws(steeredIds, unsteeredIds, size)
    expect(union).toHaveLength(size)
    expect(union.filter((id) => id.startsWith('u'))).toHaveLength(50)
  })
})

describe('isUndrawnSample', () => {
  it('is a sample size with nothing drawn', () => {
    expect(isUndrawnSample({ sampleSize: 100, sampledAt: null })).toBe(true)
    expect(isUndrawnSample({ sampleSize: 100, sampledAt: new Date() })).toBe(
      false,
    )
    expect(isUndrawnSample({ sampleSize: null, sampledAt: null })).toBe(false)
    expect(isUndrawnSample(null)).toBe(false)
  })
})
