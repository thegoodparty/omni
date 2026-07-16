import { describe, expect, it } from 'vitest'
import {
  pickNextUpcomingRace,
  RaceForNextElection,
} from './pickNextUpcomingRace.util'

// A mid-day instant so we can prove `now` is truncated to its UTC midnight.
const NOW = new Date('2026-06-01T15:30:00Z')

const makeRace = (
  overrides: Partial<RaceForNextElection>,
): RaceForNextElection => ({
  electionDate: new Date('2030-11-05'),
  isPrimary: false,
  isRunoff: false,
  ...overrides,
})

describe('pickNextUpcomingRace', () => {
  it('returns null for an empty list', () => {
    expect(pickNextUpcomingRace([], NOW)).toBeNull()
  })

  it('picks the nearest future general election among many', () => {
    const races = [
      makeRace({ electionDate: new Date('2030-11-05') }),
      makeRace({ electionDate: new Date('2026-11-03') }),
      makeRace({ electionDate: new Date('2028-11-07') }),
    ]
    const chosen = pickNextUpcomingRace(races, NOW)
    expect(chosen?.electionDate.toISOString()).toBe(
      new Date('2026-11-03').toISOString(),
    )
  })

  it('includes a same-day election (UTC midnight >= truncated now)', () => {
    const races = [makeRace({ electionDate: new Date('2026-06-01') })]
    const chosen = pickNextUpcomingRace(races, NOW)
    expect(chosen?.electionDate.toISOString()).toBe(
      new Date('2026-06-01').toISOString(),
    )
  })

  it('excludes a past general election', () => {
    const races = [makeRace({ electionDate: new Date('2026-05-31') })]
    expect(pickNextUpcomingRace(races, NOW)).toBeNull()
  })

  it('excludes primaries even when they are the nearest future race', () => {
    const races = [
      makeRace({ electionDate: new Date('2026-08-01'), isPrimary: true }),
      makeRace({ electionDate: new Date('2026-11-03') }),
    ]
    const chosen = pickNextUpcomingRace(races, NOW)
    expect(chosen?.isPrimary).toBe(false)
    expect(chosen?.electionDate.toISOString()).toBe(
      new Date('2026-11-03').toISOString(),
    )
  })

  it('excludes runoffs even when they are the nearest future race', () => {
    const races = [
      makeRace({ electionDate: new Date('2026-08-01'), isRunoff: true }),
      makeRace({ electionDate: new Date('2026-11-03') }),
    ]
    const chosen = pickNextUpcomingRace(races, NOW)
    expect(chosen?.isRunoff).toBe(false)
    expect(chosen?.electionDate.toISOString()).toBe(
      new Date('2026-11-03').toISOString(),
    )
  })

  it('returns null when only primaries and runoffs are in the future', () => {
    const races = [
      makeRace({ electionDate: new Date('2027-03-15'), isPrimary: true }),
      makeRace({ electionDate: new Date('2027-06-15'), isRunoff: true }),
    ]
    expect(pickNextUpcomingRace(races, NOW)).toBeNull()
  })
})
