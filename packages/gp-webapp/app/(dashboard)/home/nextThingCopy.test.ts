import { describe, expect, it } from 'vitest'
import type { Campaign } from 'helpers/types'
import { eyebrowFor } from './nextThingCopy'

const today = new Date(2026, 9, 6)
const campaign = (details: Record<string, string>): Campaign =>
  ({ details }) as unknown as Campaign

describe('eyebrowFor', () => {
  it('shows today and the days left to Election Day', () => {
    expect(eyebrowFor(campaign({ electionDate: '2026-11-03' }), today)).toBe(
      'Tuesday, October 6 · 28 days to Election Day',
    )
  })

  it('counts to the primary while it is still ahead', () => {
    expect(
      eyebrowFor(
        campaign({
          electionDate: '2026-11-03',
          primaryElectionDate: '2026-10-20',
        }),
        today,
      ),
    ).toBe('Tuesday, October 6 · 14 days to your primary')
  })

  it('names the day itself and the day before', () => {
    expect(eyebrowFor(campaign({ electionDate: '2026-10-06' }), today)).toBe(
      'Tuesday, October 6 · Election Day is today',
    )
    expect(eyebrowFor(campaign({ electionDate: '2026-10-07' }), today)).toBe(
      'Tuesday, October 6 · Election Day is tomorrow',
    )
  })

  it('shows only the date without an election ahead', () => {
    expect(eyebrowFor(campaign({}), today)).toBe('Tuesday, October 6')
    expect(eyebrowFor(campaign({ electionDate: '2026-09-01' }), today)).toBe(
      'Tuesday, October 6',
    )
  })
})
