import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StatsService } from './stats.service'
import type { PeopleDbService } from '../peopleDb.service'

describe('StatsService', () => {
  let service: StatsService
  let mockPrisma: {
    districtStats: {
      findUnique: ReturnType<typeof vi.fn>
    }
  }

  beforeEach(() => {
    mockPrisma = {
      districtStats: {
        findUnique: vi.fn(),
      },
    }

    service = new StatsService()
    ;(service as unknown as { _peopleDb: PeopleDbService })._peopleDb = {
      get instance() {
        return mockPrisma
      },
    } as unknown as PeopleDbService
  })

  it('uses districtId directly', async () => {
    mockPrisma.districtStats.findUnique.mockResolvedValue({
      districtId: 'district-1',
      totalConstituents: 100,
    })

    const result = await service.findStats({
      districtId: 'district-1',
    } as never)

    expect(mockPrisma.districtStats.findUnique).toHaveBeenCalledWith({
      where: { districtId: 'district-1' },
    })
    expect(result?.districtId).toBe('district-1')
  })

  it('returns null when stats are missing', async () => {
    mockPrisma.districtStats.findUnique.mockResolvedValue(null)

    await expect(
      service.findStats({ districtId: 'missing-district-id' } as never),
    ).resolves.toBeNull()
  })

  it('returns null total counts when stats are missing', async () => {
    mockPrisma.districtStats.findUnique.mockResolvedValue(null)

    await expect(
      service.findTotalCounts('missing-district-id'),
    ).resolves.toBeNull()
  })

  it('returns total counts for a district', async () => {
    mockPrisma.districtStats.findUnique.mockResolvedValue({
      totalConstituents: 111,
      totalConstituentsWithCellPhone: 55,
    })

    const counts = await service.findTotalCounts('district-1')

    expect(mockPrisma.districtStats.findUnique).toHaveBeenCalledWith({
      select: {
        totalConstituents: true,
        totalConstituentsWithCellPhone: true,
      },
      where: { districtId: 'district-1' },
    })
    expect(counts?.totalConstituents).toBe(111)
    expect(counts?.totalConstituentsWithCellPhone).toBe(55)
  })

  it('returns totalConstituents without throwing when the stats row exists', async () => {
    mockPrisma.districtStats.findUnique.mockResolvedValue({
      totalConstituents: 39932,
    })

    await expect(service.findTotalConstituents('district-1')).resolves.toBe(
      39932,
    )
    expect(mockPrisma.districtStats.findUnique).toHaveBeenCalledWith({
      select: { totalConstituents: true },
      where: { districtId: 'district-1' },
    })
  })

  it('returns null (not an exception) when findTotalConstituents finds no stats row', async () => {
    mockPrisma.districtStats.findUnique.mockResolvedValue(null)

    await expect(
      service.findTotalConstituents('missing-district-id'),
    ).resolves.toBeNull()
  })

  it('returns null when total counts are missing', async () => {
    mockPrisma.districtStats.findUnique.mockResolvedValue(null)

    await expect(
      service.findTotalCounts('missing-district-id'),
    ).resolves.toBeNull()
  })
  describe('store routing', () => {
    const databricks = { findStats: vi.fn() }

    beforeEach(() => {
      ;(service as unknown as { databricks: unknown }).databricks = databricks
      process.env.USE_DATABRICKS_PEOPLE_DB = 'true'
    })

    afterEach(() => {
      process.env.USE_DATABRICKS_PEOPLE_DB = 'false'
    })

    it('computes stats on demand instead of reading the stale table', async () => {
      databricks.findStats.mockResolvedValue({
        districtId: 'district-1',
        totalConstituents: 100,
        totalConstituentsWithCellPhone: 40,
      })

      const result = await service.findStats({
        districtId: 'district-1',
      } as never)

      expect(result?.totalConstituents).toBe(100)
      expect(mockPrisma.districtStats.findUnique).not.toHaveBeenCalled()
    })

    // A zero-voter district has to keep presenting as "no stats row" — polls
    // and the webapp's empty state both branch on the null.
    it('passes a null computed result straight through', async () => {
      databricks.findStats.mockResolvedValue(null)

      await expect(
        service.findStats({ districtId: 'district-1' } as never),
      ).resolves.toBeNull()
      await expect(
        service.findTotalConstituents('district-1'),
      ).resolves.toBeNull()
      await expect(service.findTotalCounts('district-1')).resolves.toBeNull()
    })

    it('derives both totals from the computed row', async () => {
      databricks.findStats.mockResolvedValue({
        districtId: 'district-1',
        totalConstituents: 100,
        totalConstituentsWithCellPhone: 40,
      })

      await expect(service.findTotalCounts('district-1')).resolves.toEqual({
        totalConstituents: 100,
        totalConstituentsWithCellPhone: 40,
      })
      await expect(service.findTotalConstituents('district-1')).resolves.toBe(
        100,
      )
    })
  })
})
