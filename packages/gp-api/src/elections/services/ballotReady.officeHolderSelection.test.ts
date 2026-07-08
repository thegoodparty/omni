import { describe, expect, it } from 'vitest'
import { selectPreferredOfficeHolder } from '../util/ballotReady.util'
import { PersonOfficeHolder } from '../types/ballotReady.types'

const holder = (
  overrides: Partial<PersonOfficeHolder>,
): PersonOfficeHolder => ({
  id: 'oh-1',
  databaseId: '1',
  startAt: null,
  endAt: null,
  isCurrent: false,
  isVacant: false,
  officeTitle: null,
  position: null,
  ...overrides,
})

describe('selectPreferredOfficeHolder', () => {
  const now = new Date('2026-01-01T00:00:00Z')

  it('returns null for an empty list', () => {
    expect(selectPreferredOfficeHolder([], now)).toBeNull()
  })

  it('prefers an upcoming term that starts within 3 months', () => {
    const current = holder({ id: 'current', isCurrent: true })
    const upcoming = holder({ id: 'upcoming', startAt: '2026-02-15' })
    const result = selectPreferredOfficeHolder([current, upcoming], now)
    expect(result?.id).toBe('upcoming')
  })

  it('ignores upcoming terms that start more than 3 months out', () => {
    const current = holder({ id: 'current', isCurrent: true })
    const farFuture = holder({ id: 'far', startAt: '2026-09-01' })
    const result = selectPreferredOfficeHolder([current, farFuture], now)
    expect(result?.id).toBe('current')
  })

  it('picks the soonest of multiple in-window upcoming terms', () => {
    const soon = holder({ id: 'soon', startAt: '2026-01-20' })
    const later = holder({ id: 'later', startAt: '2026-03-15' })
    const result = selectPreferredOfficeHolder([later, soon], now)
    expect(result?.id).toBe('soon')
  })

  it('falls back to a term whose range contains now when nothing is marked current', () => {
    const past = holder({
      id: 'past',
      startAt: '2020-01-01',
      endAt: '2024-01-01',
    })
    const ongoing = holder({
      id: 'ongoing',
      startAt: '2025-01-01',
      endAt: '2029-01-01',
    })
    const result = selectPreferredOfficeHolder([past, ongoing], now)
    expect(result?.id).toBe('ongoing')
  })

  it('ignores a vacant holder even when its date range covers now', () => {
    const vacant = holder({
      id: 'vacant',
      isVacant: true,
      startAt: '2020-01-01',
      endAt: '2029-01-01',
    })
    expect(selectPreferredOfficeHolder([vacant], now)).toBeNull()
  })

  it('skips vacant holders and returns the active one', () => {
    const vacant = holder({
      id: 'vacant',
      isVacant: true,
      startAt: '2020-01-01',
      endAt: '2029-01-01',
    })
    const active = holder({ id: 'active', isCurrent: true })
    expect(selectPreferredOfficeHolder([vacant, active], now)?.id).toBe(
      'active',
    )
  })

  it('parses term boundaries with the shared UTC date util', () => {
    // Selection parses startAt/endAt with parseIsoDateAsUTC — the same util the
    // controller uses to persist them — so the 3-month window decision and the
    // stored calendar day never disagree. A date-only and an equivalent
    // TZ-offset datetime that resolve to the same in-window day both select.
    const dateOnly = holder({ id: 'date-only', startAt: '2026-02-15' })
    expect(selectPreferredOfficeHolder([dateOnly], now)?.id).toBe('date-only')

    const offset = holder({
      // 2026-02-14T20:00-05:00 === 2026-02-15T01:00Z — within the 3-month window.
      id: 'offset',
      startAt: '2026-02-14T20:00:00-05:00',
    })
    expect(selectPreferredOfficeHolder([offset], now)?.id).toBe('offset')
  })
})
