import { describe, it, expect } from 'vitest'
import {
  isActiveCampaign,
  isHeldOffice,
  isUpcomingElectionDate,
} from './eligibility.util'
import { Campaign, ElectedOffice } from '../../generated/prisma'

const office = (overrides: Partial<ElectedOffice>): ElectedOffice =>
  ({ termEndDate: null, ...overrides }) as ElectedOffice

const campaign = (overrides: Partial<Campaign>): Campaign =>
  ({
    isDemo: false,
    primaryResult: null,
    didWin: null,
    details: { electionDate: '2026-11-03' },
    ...overrides,
  }) as Campaign

describe('isUpcomingElectionDate', () => {
  it('counts election day itself as upcoming (active through the whole day)', () => {
    // The comparison is UTC-calendar-day, so a late-in-the-day "now" on
    // election day must not flip the campaign inactive.
    const now = new Date('2026-11-03T23:30:00.000Z')

    expect(isUpcomingElectionDate('2026-11-03', now)).toBe(true)
  })

  it('is upcoming for a future date', () => {
    const now = new Date('2026-11-03T12:00:00.000Z')

    expect(isUpcomingElectionDate('2026-11-04', now)).toBe(true)
  })

  it('is not upcoming the day after the election', () => {
    const now = new Date('2026-11-04T00:01:00.000Z')

    expect(isUpcomingElectionDate('2026-11-03', now)).toBe(false)
  })

  it('is not upcoming for an unparseable date string', () => {
    expect(isUpcomingElectionDate('not-a-date', new Date())).toBe(false)
  })
})

describe('isActiveCampaign', () => {
  const now = new Date('2026-06-15T12:00:00.000Z')

  it('is active with no result recorded and an upcoming election', () => {
    expect(isActiveCampaign(campaign({}), now)).toBe(true)
  })

  it('is not active for a demo campaign', () => {
    expect(isActiveCampaign(campaign({ isDemo: true }), now)).toBe(false)
  })

  it('is not active after a lost primary even with a future general', () => {
    expect(isActiveCampaign(campaign({ primaryResult: 'lost' }), now)).toBe(
      false,
    )
  })

  it('is not active without an election date', () => {
    expect(isActiveCampaign(campaign({ details: {} }), now)).toBe(false)
  })

  it('is not active once didWin is recorded, win or lose', () => {
    expect(isActiveCampaign(campaign({ didWin: true }), now)).toBe(false)
    expect(isActiveCampaign(campaign({ didWin: false }), now)).toBe(false)
  })

  it('is not active once the election date has passed', () => {
    expect(
      isActiveCampaign(
        campaign({ details: { electionDate: '2026-06-14' } }),
        now,
      ),
    ).toBe(false)
  })
})

describe('isHeldOffice', () => {
  it('is held the day before the exclusive term-end boundary', () => {
    // termEndDate is the half-open exclusive boundary (successor's start day);
    // the holder is still in office the day before it.
    const termEndDate = new Date('2026-06-30T00:00:00.000Z')
    const now = new Date('2026-06-29T18:00:00.000Z')

    expect(isHeldOffice(office({ termEndDate }), now)).toBe(true)
  })

  it('is not held once the term-end boundary day arrives', () => {
    // On the boundary day the successor has taken over, so the office is past.
    const termEndDate = new Date('2026-06-30T00:00:00.000Z')
    const now = new Date('2026-06-30T00:01:00.000Z')

    expect(isHeldOffice(office({ termEndDate }), now)).toBe(false)
  })

  it('is not held once the term end is in the past', () => {
    const termEndDate = new Date('2020-01-01T00:00:00.000Z')

    expect(isHeldOffice(office({ termEndDate }), new Date())).toBe(false)
  })

  it('is not held when the term end date is missing (derived inactive)', () => {
    // isActive is derived from termEndDate, so a null end (missing term data)
    // is treated as not held until the holder supplies dates.
    expect(isHeldOffice(office({ termEndDate: null }), new Date())).toBe(false)
  })
})
