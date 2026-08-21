import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StatsService } from './stats.service'
import type { DatabricksVoterService } from '../databricks/databricksVoter.service'

describe('StatsService', () => {
  let findStats: ReturnType<typeof vi.fn>
  let service: StatsService

  beforeEach(() => {
    findStats = vi.fn()
    service = new StatsService({
      findStats,
    } as unknown as DatabricksVoterService)
  })

  const stats = {
    districtId: 'district-1',
    computedAt: '2026-08-21T00:00:00Z',
    totalConstituents: 100,
    totalConstituentsWithCellPhone: 40,
    buckets: {
      age: [],
      education: [],
      homeowner: [],
      presenceOfChildren: [],
      estimatedIncomeRange: [],
    },
  }

  it('computes the row on demand for the requested district', async () => {
    findStats.mockResolvedValue(stats)

    await expect(
      service.findStats({ districtId: 'district-1' } as never),
    ).resolves.toBe(stats)
    expect(findStats).toHaveBeenCalledWith('district-1')
  })

  // A zero-voter district has to keep presenting as "no stats row" — poll
  // creation and the webapp's empty state both branch on the null.
  it('passes a null computed result straight through', async () => {
    findStats.mockResolvedValue(null)

    await expect(
      service.findStats({ districtId: 'district-1' } as never),
    ).resolves.toBeNull()
    await expect(
      service.findTotalConstituents('district-1'),
    ).resolves.toBeNull()
    await expect(service.findTotalCounts('district-1')).resolves.toBeNull()
  })

  it('derives both totals from the computed row', async () => {
    findStats.mockResolvedValue(stats)

    await expect(service.findTotalCounts('district-1')).resolves.toEqual({
      totalConstituents: 100,
      totalConstituentsWithCellPhone: 40,
    })
    await expect(service.findTotalConstituents('district-1')).resolves.toBe(100)
  })
})
