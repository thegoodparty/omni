import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StatsService } from './stats.service'
import type { PeopleDbService } from '../peopleDb.service'
import type { ShadowReadService } from '../shadowRead.service'

describe('StatsService', () => {
  let service: StatsService
  let mockPrisma: {
    districtStats: {
      findUnique: ReturnType<typeof vi.fn>
    }
  }
  let databricksFindStats: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockPrisma = {
      districtStats: {
        findUnique: vi.fn(),
      },
    }
    databricksFindStats = vi.fn()

    service = new StatsService()
    // Shadow reader off, so these assertions describe the Postgres read and
    // nothing else. compare() still mirrors the real signature -- keying it on
    // anything else makes the enabled branch untestable rather than merely
    // unused, since a wrong key only shows up as calling undefined.
    ;(service as unknown as { shadow: ShadowReadService }).shadow = {
      enabled: false,
      databricks: { findStats: databricksFindStats },
      compare: (args: { authoritative: () => unknown }) => args.authoritative(),
    } as unknown as ShadowReadService
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

  it('serves Databricks as authoritative once the shadow read is on', async () => {
    const service2 = service as unknown as { shadow: { enabled: boolean } }
    service2.shadow.enabled = true
    databricksFindStats.mockResolvedValue({
      districtId: 'district-1',
      totalConstituents: 42,
    })

    const result = await service.findStats({
      districtId: 'district-1',
    } as never)

    expect(databricksFindStats).toHaveBeenCalledWith('district-1')
    expect(result?.totalConstituents).toBe(42)
  })
})
