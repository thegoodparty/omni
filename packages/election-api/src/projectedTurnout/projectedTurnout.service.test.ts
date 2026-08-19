import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ElectionCode } from '../generated/prisma'
import { ProjectedTurnoutService } from './projectedTurnout.service'
import { ProjectedTurnoutUniqueDTO } from './projectedTurnout.schema'

describe('ProjectedTurnoutService', () => {
  let service: ProjectedTurnoutService
  let findFirst: ReturnType<typeof vi.fn>

  beforeEach(() => {
    findFirst = vi.fn().mockResolvedValue(null)
    service = new ProjectedTurnoutService()
    Object.defineProperty(service, '_prisma', {
      value: {
        projectedTurnout: { findFirst },
      },
    })
  })

  const dto = (over: Partial<ProjectedTurnoutUniqueDTO>) =>
    over as ProjectedTurnoutUniqueDTO

  describe('determineElectionCode', () => {
    it('returns General for an even-year November election day', () => {
      expect(service.determineElectionCode('2026-11-03')).toBe(
        ElectionCode.General,
      )
    })

    it('returns LocalOrMunicipal for an odd-year November, in every state', () => {
      // The retrained model dropped the consolidated-general category that
      // LA/MS/NJ/VA and Kansas quadrennials used to read, so asking for it
      // would find no row. The state is no longer an argument at all — the
      // typecheck is what enforces that the branch is gone; this pins the
      // answer those states now get.
      expect(service.determineElectionCode('2027-11-02')).toBe(
        ElectionCode.LocalOrMunicipal,
      )
      expect(service.determineElectionCode('2025-11-04')).toBe(
        ElectionCode.LocalOrMunicipal,
      )
    })

    it('returns LocalOrMunicipal for a date outside November', () => {
      expect(service.determineElectionCode('2026-01-09')).toBe(
        ElectionCode.LocalOrMunicipal,
      )
    })

    it('returns LocalOrMunicipal for a November date that is not the general day', () => {
      // 2026-11-10 is the second Tuesday, outside the first-Monday window.
      expect(service.determineElectionCode('2026-11-10')).toBe(
        ElectionCode.LocalOrMunicipal,
      )
    })

    it('classifies a full ISO timestamp, not only a date-only string', () => {
      // The DTO accepts any string `new Date` parses. Appending a zone suffix to
      // one that already carries a time produced an invalid date, which fell
      // through to LocalOrMunicipal for every November election.
      expect(service.determineElectionCode('2026-11-03T12:00:00Z')).toBe(
        ElectionCode.General,
      )
    })
  })

  describe('election-year binding', () => {
    it('pins the district lookup to the election date own year', async () => {
      await service.getProjectedTurnout(
        dto({ districtId: 'district-1', electionDate: '2026-04-07' }),
      )

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          districtId: 'district-1',
          electionCode: ElectionCode.LocalOrMunicipal,
          electionYear: 2026,
        },
      })
    })

    it('pins the district-name lookup to the election date own year', async () => {
      await service.getProjectedTurnout(
        dto({
          state: 'MO',
          L2DistrictType: 'City',
          L2DistrictName: 'SPRINGFIELD',
          electionDate: '2028-11-07',
        }),
      )

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          electionCode: ElectionCode.General,
          electionYear: 2028,
          district: {
            L2DistrictType: 'City',
            L2DistrictName: 'SPRINGFIELD',
            state: 'MO',
          },
        },
      })
    })

    it('prefers an explicitly supplied election year over the date', async () => {
      await service.getProjectedTurnout(
        dto({
          districtId: 'district-1',
          electionDate: '2026-04-07',
          electionYear: 2028,
        }),
      )

      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ electionYear: 2028 }),
        }),
      )
    })

    it('derives the year in UTC', async () => {
      // A UTC-midnight New Year date read in a western local zone would land in
      // the previous year and select the wrong vintage.
      await service.getProjectedTurnout(
        dto({ districtId: 'district-1', electionDate: '2027-01-01' }),
      )

      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ electionYear: 2027 }),
        }),
      )
    })

    it('does not look the district up before classifying', async () => {
      // Classification no longer depends on the district state, so the extra
      // query that existed only to fetch it is gone.
      const districtFindUnique = vi.fn()
      Object.defineProperty(service, '_prisma', {
        value: {
          projectedTurnout: { findFirst },
          district: { findUnique: districtFindUnique },
        },
      })

      await service.getProjectedTurnout(
        dto({ districtId: 'district-1', electionDate: '2026-04-07' }),
      )

      expect(districtFindUnique).not.toHaveBeenCalled()
    })
  })

  describe('caller-supplied election code', () => {
    it('uses the supplied code instead of classifying the date', async () => {
      await service.getProjectedTurnout(
        dto({
          districtId: 'district-1',
          electionDate: '2026-11-03',
          electionCode: ElectionCode.Primary,
        }),
      )

      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            electionCode: ElectionCode.Primary,
          }),
        }),
      )
    })
  })
})
