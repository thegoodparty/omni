import { describe, expect, it } from 'vitest'
import type { Campaign } from 'helpers/types'
import { countdownFor } from './nextThingCopy'

const today = new Date(2026, 9, 6)
const campaign = (details: Record<string, string>): Campaign =>
  ({ details }) as unknown as Campaign

describe('countdownFor', () => {
  it('counts the days to Election Day', () => {
    expect(countdownFor(campaign({ electionDate: '2026-11-03' }), today)).toBe(
      '28 days to Election Day',
    )
  })

  it('counts to the primary while it is still ahead', () => {
    expect(
      countdownFor(
        campaign({
          electionDate: '2026-11-03',
          primaryElectionDate: '2026-10-20',
        }),
        today,
      ),
    ).toBe('14 days to your primary')
  })

  it('names the day itself and the day before', () => {
    expect(countdownFor(campaign({ electionDate: '2026-10-06' }), today)).toBe(
      'Election Day is today',
    )
    expect(countdownFor(campaign({ electionDate: '2026-10-07' }), today)).toBe(
      'Election Day is tomorrow',
    )
  })

  it('shows nothing without an election ahead', () => {
    expect(countdownFor(campaign({}), today)).toBeNull()
    expect(
      countdownFor(campaign({ electionDate: '2026-09-01' }), today),
    ).toBeNull()
  })
})
