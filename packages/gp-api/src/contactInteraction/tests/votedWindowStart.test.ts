import { describe, expect, it } from 'vitest'
import { votedWindowStart } from '../services/votedStatus.service'

describe('votedWindowStart', () => {
  const now = new Date('2026-10-23T15:00:00.000Z')

  it('has no boundary before any election has passed', () => {
    expect(
      votedWindowStart(
        { primaryElectionDate: '2027-03-01', electionDate: '2027-11-02' },
        now,
      ),
    ).toBeNull()
    expect(votedWindowStart(null, now)).toBeNull()
  })

  it('starts the day after a primary that has passed', () => {
    expect(
      votedWindowStart(
        { primaryElectionDate: '2026-08-04', electionDate: '2026-11-03' },
        now,
      ),
    ).toEqual(new Date('2026-08-05T12:00:00.000Z'))
  })

  it('resets once the general itself is behind us', () => {
    expect(
      votedWindowStart(
        { primaryElectionDate: '2026-08-04', electionDate: '2026-10-20' },
        now,
      ),
    ).toEqual(new Date('2026-10-21T12:00:00.000Z'))
  })

  it('keeps election day itself inside the election', () => {
    expect(
      votedWindowStart(
        { electionDate: '2026-10-23' },
        new Date('2026-10-23T20:00:00.000Z'),
      ),
    ).toBeNull()
  })

  // UTC midnight is 8pm Eastern and 5pm Pacific on election day, the height
  // of GOTV. The reset waits until election day is over in every US zone.
  it('keeps election night inside the election in every US time zone', () => {
    const dates = { electionDate: '2026-11-03' }
    for (const at of [
      '2026-11-04T01:00:00.000Z', // 5pm Pacific, election day
      '2026-11-04T07:59:00.000Z', // 11:59pm Pacific
      '2026-11-04T11:59:00.000Z', // 1:59am Hawaii, the next day
    ]) {
      expect(votedWindowStart(dates, new Date(at))).toBeNull()
    }
    expect(
      votedWindowStart(dates, new Date('2026-11-04T12:00:00.000Z')),
    ).toEqual(new Date('2026-11-04T12:00:00.000Z'))
  })

  it('counts a primary-night answer in the primary, not the general', () => {
    const start = votedWindowStart(
      { primaryElectionDate: '2026-08-04', electionDate: '2026-11-03' },
      now,
    )
    // 11pm Pacific on primary night.
    expect(start?.getTime()).toBeGreaterThan(
      Date.parse('2026-08-05T06:00:00.000Z'),
    )
  })
})
