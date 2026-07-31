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

describe('getContactStatsRendered — total', () => {
  it('renders an exact total and a precise percent', () => {
    const result = getContactStatsRendered(baseStats, 10000)

    expect(result.totalConstituents).toBe('10,000')
    expect(result.visibleContactsPercent).toBe('50.00%')
  })
})
