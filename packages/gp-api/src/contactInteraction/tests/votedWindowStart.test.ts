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
    ).toEqual(new Date('2026-08-05T00:00:00.000Z'))
  })

  it('resets once the general itself is behind us', () => {
    expect(
      votedWindowStart(
        { primaryElectionDate: '2026-08-04', electionDate: '2026-10-20' },
        now,
      ),
    ).toEqual(new Date('2026-10-21T00:00:00.000Z'))
  })

  it('keeps election day itself inside the election', () => {
    expect(
      votedWindowStart(
        { electionDate: '2026-10-23' },
        new Date('2026-10-23T20:00:00.000Z'),
      ),
    ).toBeNull()
  })
})
