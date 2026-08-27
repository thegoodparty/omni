import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  VoterDensityService,
  type VoterDensityResult,
} from './voterDensity.service'
import type { PeopleDbService } from '../peopleDb.service'
import type { ShadowReadService } from '../shadowRead.service'
import type { DatabricksVoterDensityService } from '../databricks/databricksVoterDensity.service'

const DISTRICT_ID = '457a1cd7-4184-f823-49d3-f207af693521'

type CompareArgs = {
  op: string
  districtId: string
  authoritative: () => Promise<VoterDensityResult>
  comparison: () => Promise<VoterDensityResult>
  fingerprintAuthoritative: (
    value: VoterDensityResult,
  ) => string | number | null
  fingerprintComparison: (value: VoterDensityResult) => string | number | null
}

describe('VoterDensityService dual read', () => {
  let service: VoterDensityService
  let mockPrisma: {
    districtVoterDensity: { findMany: ReturnType<typeof vi.fn> }
    districtVoterDensityMeta: { findUnique: ReturnType<typeof vi.fn> }
  }
  let findVoterDensity: ReturnType<typeof vi.fn>
  let compared: CompareArgs | null
  let shadow: { enabled: boolean; compare: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    compared = null
    mockPrisma = {
      districtVoterDensity: { findMany: vi.fn().mockResolvedValue([]) },
      districtVoterDensityMeta: { findUnique: vi.fn().mockResolvedValue(null) },
    }
    findVoterDensity = vi.fn().mockResolvedValue({ coverage: 0.9, cells: [] })
    shadow = {
      enabled: true,
      compare: vi.fn((args: CompareArgs) => {
        compared = args
        return args.authoritative()
      }),
    }

    service = new VoterDensityService()
    ;(service as unknown as { shadow: ShadowReadService }).shadow =
      shadow as unknown as ShadowReadService
    ;(
      service as unknown as { databricksDensity: DatabricksVoterDensityService }
    ).databricksDensity = {
      findVoterDensity,
    } as unknown as DatabricksVoterDensityService
    ;(service as unknown as { _peopleDb: PeopleDbService })._peopleDb = {
      get instance() {
        return mockPrisma
      },
    } as unknown as PeopleDbService
  })

  it('serves from Databricks and shadows Postgres when enabled', async () => {
    findVoterDensity.mockResolvedValue({
      coverage: 0.982,
      cells: [{ lat: 43.1, lng: -108.2, count: 25 }],
    })

    const result = await service.getVoterDensity(DISTRICT_ID)

    expect(result).toEqual({
      coverage: 0.982,
      cells: [{ lat: 43.1, lng: -108.2, count: 25 }],
    })
    expect(findVoterDensity).toHaveBeenCalledWith(DISTRICT_ID, 8)
    expect(compared?.op).toBe('voter-density')
    expect(compared?.districtId).toBe(DISTRICT_ID)
  })

  it('does not touch Databricks when the flag is off', async () => {
    shadow.enabled = false

    await service.getVoterDensity(DISTRICT_ID)

    expect(findVoterDensity).not.toHaveBeenCalled()
    expect(shadow.compare).not.toHaveBeenCalled()
    expect(mockPrisma.districtVoterDensity.findMany).toHaveBeenCalled()
  })

  it('passes an explicit resolution to both arms', async () => {
    await service.getVoterDensity(DISTRICT_ID, 9)
    await compared?.comparison()

    expect(findVoterDensity).toHaveBeenCalledWith(DISTRICT_ID, 9)
    expect(mockPrisma.districtVoterDensity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { districtId: DISTRICT_ID, resolution: 9 },
      }),
    )
  })

  it('runs the Postgres comparison arm against people-db', async () => {
    mockPrisma.districtVoterDensity.findMany.mockResolvedValue([
      { lat: 1, lng: 2, voterCount: 30 },
    ])
    mockPrisma.districtVoterDensityMeta.findUnique.mockResolvedValue({
      coverage: 0.5,
    })

    await service.getVoterDensity(DISTRICT_ID)
    const comparison = await compared!.comparison()

    expect(comparison).toEqual({
      coverage: 0.5,
      cells: [{ lat: 1, lng: 2, count: 30 }],
    })
  })

  describe('fingerprint', () => {
    const fingerprint = async (value: VoterDensityResult) => {
      await service.getVoterDensity(DISTRICT_ID)
      return compared!.fingerprintAuthoritative(value)
    }

    it('agrees for the same cells in a different order', async () => {
      const a = await fingerprint({
        coverage: 0.9,
        cells: [
          { lat: 1, lng: 2, count: 5 },
          { lat: 3, lng: 4, count: 7 },
        ],
      })
      const b = await fingerprint({
        coverage: 0.9,
        cells: [
          { lat: 3, lng: 4, count: 7 },
          { lat: 1, lng: 2, count: 5 },
        ],
      })

      expect(a).toBe(b)
    })

    it('disagrees for different cells of the same count', async () => {
      // The failure a row count cannot see: same size, different ground.
      const a = await fingerprint({
        coverage: 0.9,
        cells: [{ lat: 1, lng: 2, count: 5 }],
      })
      const b = await fingerprint({
        coverage: 0.9,
        cells: [{ lat: 9, lng: 9, count: 5 }],
      })

      expect(a).not.toBe(b)
    })

    it('disagrees when only the voter count in a cell changes', async () => {
      const a = await fingerprint({
        coverage: 0.9,
        cells: [{ lat: 1, lng: 2, count: 5 }],
      })
      const b = await fingerprint({
        coverage: 0.9,
        cells: [{ lat: 1, lng: 2, count: 6 }],
      })

      expect(a).not.toBe(b)
    })

    it('disagrees when only coverage changes', async () => {
      const a = await fingerprint({ coverage: 0.9, cells: [] })
      const b = await fingerprint({ coverage: 0.8, cells: [] })

      expect(a).not.toBe(b)
    })

    it('distinguishes null coverage from zero', async () => {
      const a = await fingerprint({ coverage: null, cells: [] })
      const b = await fingerprint({ coverage: 0, cells: [] })

      expect(a).not.toBe(b)
    })

    it('ignores float noise below the digest precision', async () => {
      // Both arms read the same mart; the Postgres copy round-trips through the
      // loader, so representation noise must not read as a divergence.
      const a = await fingerprint({
        coverage: 0.982,
        cells: [{ lat: 43.1, lng: -108.2, count: 25 }],
      })
      const b = await fingerprint({
        coverage: 0.9820000000000001,
        cells: [{ lat: 43.10000000000001, lng: -108.2, count: 25 }],
      })

      expect(a).toBe(b)
    })
  })
})
