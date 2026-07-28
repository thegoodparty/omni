import { describe, it, expect } from 'vitest'
import type { ContactsStats } from 'app/dashboard/polls/shared/queries'
import { getContactStatsRendered } from './stats.util'

const baseStats: ContactsStats = {
  districtId: 'district-1',
  computedAt: '2026-07-27T00:00:00.000Z',
  totalConstituents: 20000,
  totalConstituentsWithCellPhone: 15000,
  buckets: {
    age: [],
    homeowner: [],
    education: [],
    presenceOfChildren: [],
    estimatedIncomeRange: [],
  },
}

describe('getContactStatsRendered — fenced total (ENG-10804)', () => {
  it('renders an exact total and a precise percent when not fenced', () => {
    const result = getContactStatsRendered(baseStats, 10000, false)

    expect(result.totalConstituents).toBe('10,000')
    expect(result.visibleContactsPercent).toBe('50.00%')
  })

  it('renders a "+" total and suppresses the percent when fenced', () => {
    const result = getContactStatsRendered(baseStats, 10000, true)

    expect(result.totalConstituents).toBe('10,000+')
    // A fenced count is a floor, not the true membership — a precise
    // percent computed from it would contradict the "+" on the total card.
    expect(result.visibleContactsPercent).toBe('--')
  })
})
