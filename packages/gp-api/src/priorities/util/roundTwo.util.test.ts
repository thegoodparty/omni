import { describe, expect, it } from 'vitest'
import { splitBatch } from '@/contacts/utils/civicPanelAllocation.util'
import { roundTwoDrawCutoff } from '@/outreach/services/outreachServeSmsCreate.service'
import {
  ACS_COUNT_KEYS,
  type AcsCountKey,
  type AcsCounts,
  type RespondentCell,
} from '@/peopleDb/databricks/districtCensusSql.util'
import {
  isUndrawnSample,
  roundTwoAnswers,
  roundTwoDimensions,
  roundTwoFrame,
  unionDraws,
} from './roundTwo.util'

const acs = (overrides: Partial<Record<AcsCountKey, number>>): AcsCounts =>
  Object.fromEntries(
    ACS_COUNT_KEYS.map((key) => [key, overrides[key] ?? 0]),
  ) as AcsCounts

// 1,000 adults, 20% of them 65 and over, in two tracts of 60% and 40%.
const CENSUS = {
  district: acs({
    totalPopulation: 1_250,
    populationUnder18: 250,
    population65Plus: 200,
  }),
  tractAdults: new Map([
    ['53017950100', 600],
    ['53017950200', 400],
  ]),
}

const cell = (
  count: number,
  overrides: Partial<RespondentCell> = {},
): RespondentCell => ({
  ageBand: '18to64',
  gender: null,
  tenure: null,
  tract: '53017950100',
  race: null,
  count,
  ...overrides,
})

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

describe('roundTwoFrame', () => {
  it('multiplies each dimension in, summing to the district', () => {
    const frame = roundTwoFrame(CENSUS, roundTwoDimensions(false))
    expect(frame).toHaveLength(4)
    expect(frame.reduce((sum, c) => sum + c.count, 0)).toBeCloseTo(1)
    const older = frame.find(
      (c) => c.values.age === '65plus' && c.values.tract === '53017950200',
    )
    expect(older?.count).toBeCloseTo(0.2 * 0.4)
  })
})

describe('roundTwoAnswers', () => {
  it('counts yes as one, mixed as half and no as none', () => {
    const dimensions = roundTwoDimensions(false)
    const frame = roundTwoFrame(CENSUS, dimensions)
    const answers = roundTwoAnswers(
      {
        yes: [cell(3)],
        no: [cell(2), cell(4, { ageBand: '65plus' })],
        mixed: [cell(2)],
      },
      frame,
      dimensions,
    )
    expect(answers).toEqual([
      {
        yes: 4,
        answers: 7,
        values: { age: '18to64', tract: '53017950100' },
      },
      {
        yes: 0,
        answers: 4,
        values: { age: '65plus', tract: '53017950100' },
      },
    ])
  })

  it('sits a tract outside the district out of that dimension', () => {
    const dimensions = roundTwoDimensions(false)
    const frame = roundTwoFrame(CENSUS, dimensions)
    const [answer] = roundTwoAnswers(
      { yes: [cell(1, { tract: '99999999999' })], no: [], mixed: [] },
      frame,
      dimensions,
    )
    expect(answer?.values).toEqual({ age: '18to64', tract: null })
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
