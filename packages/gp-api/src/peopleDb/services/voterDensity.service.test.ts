import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VoterDensityService } from './voterDensity.service'
import type { PeopleDbService } from '../peopleDb.service'
import type { ShadowReadService } from '../shadowRead.service'

describe('VoterDensityService', () => {
  let service: VoterDensityService
  let mockPrisma: {
    districtVoterDensity: { findMany: ReturnType<typeof vi.fn> }
    districtVoterDensityMeta: { findUnique: ReturnType<typeof vi.fn> }
  }

  beforeEach(() => {
    mockPrisma = {
      districtVoterDensity: { findMany: vi.fn() },
      districtVoterDensityMeta: { findUnique: vi.fn() },
    }

    service = new VoterDensityService()
    // Flag off: this file covers the Postgres arm. The dual-read fork has its
    // own file.
    ;(service as unknown as { shadow: ShadowReadService }).shadow = {
      enabled: false,
    } as unknown as ShadowReadService
    ;(service as unknown as { _peopleDb: PeopleDbService })._peopleDb = {
      get instance() {
        return mockPrisma
      },
    } as unknown as PeopleDbService
  })

  it('maps rows to cells (voterCount -> count) and reads coverage from meta', async () => {
    mockPrisma.districtVoterDensity.findMany.mockResolvedValue([
      { lat: 43.1, lng: -108.2, voterCount: 25 },
      { lat: 43.2, lng: -108.3, voterCount: 11 },
    ])
    mockPrisma.districtVoterDensityMeta.findUnique.mockResolvedValue({
      coverage: 0.82,
    })

    const result = await service.getVoterDensity('district-1')

    expect(result).toEqual({
      coverage: 0.82,
      cells: [
        { lat: 43.1, lng: -108.2, count: 25 },
        { lat: 43.2, lng: -108.3, count: 11 },
      ],
    })
  })

  it('defaults resolution to 8 when omitted', async () => {
    mockPrisma.districtVoterDensity.findMany.mockResolvedValue([])
    mockPrisma.districtVoterDensityMeta.findUnique.mockResolvedValue(null)

    await service.getVoterDensity('district-1')

    expect(mockPrisma.districtVoterDensity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { districtId: 'district-1', resolution: 8 },
      }),
    )
    expect(mockPrisma.districtVoterDensityMeta.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          districtId_resolution: { districtId: 'district-1', resolution: 8 },
        },
      }),
    )
  })

  it('honors an explicit resolution', async () => {
    mockPrisma.districtVoterDensity.findMany.mockResolvedValue([])
    mockPrisma.districtVoterDensityMeta.findUnique.mockResolvedValue(null)

    await service.getVoterDensity('district-1', 9)

    expect(mockPrisma.districtVoterDensity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { districtId: 'district-1', resolution: 9 },
      }),
    )
  })

  it('returns null coverage when no meta row exists', async () => {
    mockPrisma.districtVoterDensity.findMany.mockResolvedValue([
      { lat: 1, lng: 2, voterCount: 30 },
    ])
    mockPrisma.districtVoterDensityMeta.findUnique.mockResolvedValue(null)

    const result = await service.getVoterDensity('district-1')

    expect(result.coverage).toBeNull()
    expect(result.cells).toEqual([{ lat: 1, lng: 2, count: 30 }])
  })

  it('returns empty cells when the district has no density rows', async () => {
    mockPrisma.districtVoterDensity.findMany.mockResolvedValue([])
    mockPrisma.districtVoterDensityMeta.findUnique.mockResolvedValue(null)

    const result = await service.getVoterDensity('district-1')

    expect(result).toEqual({ coverage: null, cells: [] })
  })
})
