import { NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

    const result = await service.getStats({
      districtId: 'district-1',
    } as never)

    expect(mockPrisma.districtStats.findUnique).toHaveBeenCalledWith({
      where: { districtId: 'district-1' },
    })
    expect(result.districtId).toBe('district-1')
  })

  it('throws NotFoundException when stats are missing', async () => {
    mockPrisma.districtStats.findUnique.mockResolvedValue(null)

    await expect(
      service.getStats({ districtId: 'missing-district-id' } as never),
    ).rejects.toThrow(NotFoundException)
  })

  it('returns total counts for a district', async () => {
    mockPrisma.districtStats.findUnique.mockResolvedValue({
      totalConstituents: 111,
      totalConstituentsWithCellPhone: 55,
    })

    const counts = await service.getTotalCounts('district-1')

    expect(mockPrisma.districtStats.findUnique).toHaveBeenCalledWith({
      select: {
        totalConstituents: true,
        totalConstituentsWithCellPhone: true,
      },
      where: { districtId: 'district-1' },
    })
    expect(counts.totalConstituents).toBe(111)
    expect(counts.totalConstituentsWithCellPhone).toBe(55)
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

  it('throws when total counts are missing', async () => {
    mockPrisma.districtStats.findUnique.mockResolvedValue(null)

    await expect(service.getTotalCounts('missing-district-id')).rejects.toThrow(
      NotFoundException,
    )
  })
})
