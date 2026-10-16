import { describe, expect, it } from 'vitest'
import {
  priorityReadStatus,
  underrepresentedGroups,
  type ReadWeighting,
} from './priorityReadStatus.util'
import type { RakingGap } from './raking.util'

const gap = (
  dimension: string,
  value: string,
  unweightedShare: number,
  censusShare: number,
  share = censusShare,
): RakingGap => ({ dimension, value, share, unweightedShare, censusShare })

const weighting = (overrides: Partial<ReadWeighting> = {}): ReadWeighting => ({
  effectiveSampleSize: 200,
  largestGap: 0,
  gaps: [],
  ...overrides,
})

describe('priorityReadStatus', () => {
  it('is too early below 30 answers, whatever the census says', () => {
    expect(
      priorityReadStatus({
        answers: 29,
        population: 2_000,
        weighting: weighting({ gaps: [gap('tenure', 'renter', 0.1, 0.5)] }),
      }),
    ).toEqual({
      answers: 29,
      needed: 92,
      good: false,
      status: 'tooEarly',
      underrepresented: [],
    })
  })

  it('is not yet representative when a group is over 10 points off after weighting', () => {
    const read = priorityReadStatus({
      answers: 150,
      population: 2_000,
      weighting: weighting({
        largestGap: 0.12,
        gaps: [gap('age', '65plus', 0.05, 0.25, 0.13)],
      }),
    })
    expect(read.status).toBe('notYetRepresentative')
    expect(read.good).toBe(false)
    expect(read.underrepresented).toEqual(['age65plus'])
  })

  it('is getting close when every group is near but the weighted answers fall short', () => {
    const read = priorityReadStatus({
      answers: 120,
      population: 2_000,
      weighting: weighting({ effectiveSampleSize: 80, largestGap: 0.04 }),
    })
    expect(read.status).toBe('gettingClose')
    expect(read.good).toBe(false)
  })

  it('is a good read once representative', () => {
    const read = priorityReadStatus({
      answers: 100,
      population: 2_000,
      weighting: weighting({ effectiveSampleSize: 92, largestGap: 0.1 }),
    })
    expect(read).toMatchObject({ status: 'representative', good: true })
  })

  it('falls back to the count alone when the census is unavailable', () => {
    expect(
      priorityReadStatus({ answers: 92, population: 2_000, weighting: null }),
    ).toMatchObject({ status: 'representative', good: true })
    expect(
      priorityReadStatus({ answers: 91, population: 2_000, weighting: null }),
    ).toMatchObject({ status: 'gettingClose', good: false })
  })

  it('uses the uncorrected figure when the population is unknown', () => {
    expect(
      priorityReadStatus({ answers: 0, population: null, weighting: null }),
    ).toMatchObject({ needed: 96, status: 'tooEarly' })
  })
})

describe('underrepresentedGroups', () => {
  it('names the two groups trailing the census most, before weighting', () => {
    expect(
      underrepresentedGroups([
        gap('tenure', 'renter', 0.2, 0.4),
        gap('tenure', 'owner', 0.8, 0.6),
        gap('age', '65plus', 0.1, 0.18),
        gap('tract', '53017950100', 0.02, 0.3),
        gap('tract', 'other', 0.05, 0.1),
      ]),
    ).toEqual(['unreachedAreas', 'renters'])
  })

  it('skips groups trailing by less than 5 points', () => {
    expect(underrepresentedGroups([gap('age', '65plus', 0.17, 0.2)])).toEqual(
      [],
    )
  })
})
