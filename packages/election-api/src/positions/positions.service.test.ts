import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import { ElectionCode } from '../generated/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectedTurnoutService } from 'src/projectedTurnout/projectedTurnout.service'
import { PositionsService } from './positions.service'

describe('PositionsService', () => {
  let service: PositionsService
  let findUnique: ReturnType<typeof vi.fn>
  let raceFindMany: ReturnType<typeof vi.fn>
  let projectedTurnoutService: Pick<
    ProjectedTurnoutService,
    'determineElectionCode'
  >

  beforeEach(() => {
    findUnique = vi.fn()
    raceFindMany = vi.fn()
    projectedTurnoutService = {
      determineElectionCode: vi.fn(),
    }
    service = new PositionsService(
      projectedTurnoutService as ProjectedTurnoutService,
    )
    Object.defineProperty(service, '_prisma', {
      value: {
        position: {
          findUnique,
        },
        race: {
          findMany: raceFindMany,
        },
      },
    })
  })

  it('throws when includeTurnout is true but electionDate is missing', async () => {
    await expect(
      service.getPositionById({
        id: 'pos-1',
        includeDistrict: true,
        includeTurnout: true,
      }),
    ).rejects.toThrow(
      new BadRequestException(
        'If includeTurnout is true, you must pass an electionDate',
      ),
    )
  })

  it('throws when includeTurnout is true but includeDistrict is false', async () => {
    await expect(
      service.getPositionById({
        id: 'pos-1',
        includeDistrict: false,
        includeTurnout: true,
        electionDate: '2024-11-05',
      }),
    ).rejects.toThrow(
      new BadRequestException(
        'A district must be included in the response to return a turnout',
      ),
    )
  })

  it('returns position fields without district when includeDistrict is false', async () => {
    findUnique.mockResolvedValue({
      id: 'pos-1',
      brPositionId: 'br-pos-1',
      brDatabaseId: 'db-1',
      state: 'CA',
      name: 'Mayor',
      level: 'Local',
      isWinIcp: true,
      isServeIcp: false,
    })

    const result = await service.getPositionById({ id: 'pos-1' })

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'pos-1' },
      select: {
        id: true,
        brPositionId: true,
        brDatabaseId: true,
        state: true,
        name: true,
        level: true,
        isWinIcp: true,
        isServeIcp: true,
      },
    })
    expect(result).toEqual({
      id: 'pos-1',
      brPositionId: 'br-pos-1',
      brDatabaseId: 'db-1',
      state: 'CA',
      name: 'Mayor',
      level: 'Local',
      isWinIcp: true,
      isServeIcp: false,
    })
  })

  it('returns district with null projectedTurnout when includeDistrict is true and includeTurnout is false', async () => {
    findUnique.mockResolvedValue({
      id: 'pos-1',
      brPositionId: 'br-pos-1',
      brDatabaseId: 'db-1',
      state: 'CA',
      name: 'Mayor',
      district: {
        id: 'district-1',
        L2DistrictType: 'City',
        L2DistrictName: 'Los Angeles',
      },
    })

    const result = await service.getPositionByBallotReadyId({
      brPositionId: 'br-pos-1',
      includeDistrict: true,
    })

    expect(findUnique).toHaveBeenCalledWith({
      where: { brPositionId: 'br-pos-1' },
      include: { district: true },
    })
    expect(result.district).toEqual({
      id: 'district-1',
      L2DistrictType: 'City',
      L2DistrictName: 'Los Angeles',
      projectedTurnout: null,
    })
  })

  it('returns position without district when includeDistrict is true but district is null', async () => {
    findUnique.mockResolvedValue({
      id: 'pos-1',
      brPositionId: 'br-pos-1',
      brDatabaseId: 'db-1',
      state: 'CA',
      name: 'Mayor',
      district: null,
    })

    const result = await service.getPositionById({
      id: 'pos-1',
      includeDistrict: true,
      includeTurnout: false,
    })

    expect(result).toEqual({
      id: 'pos-1',
      brPositionId: 'br-pos-1',
      brDatabaseId: 'db-1',
      state: 'CA',
      name: 'Mayor',
    })
  })

  it('returns filtered projected turnout when includeTurnout is true', async () => {
    vi.mocked(projectedTurnoutService.determineElectionCode).mockReturnValue(
      ElectionCode.General,
    )
    findUnique.mockResolvedValue({
      id: 'pos-1',
      brPositionId: 'br-pos-1',
      brDatabaseId: 'db-1',
      state: 'CA',
      name: 'Mayor',
      district: {
        id: 'district-1',
        L2DistrictType: 'City',
        L2DistrictName: 'Los Angeles',
        ProjectedTurnouts: [
          {
            id: 'pt-1',
            electionYear: 2024,
            electionCode: ElectionCode.General,
          },
          {
            id: 'pt-2',
            electionYear: 2023,
            electionCode: ElectionCode.LocalOrMunicipal,
          },
        ],
      },
    })

    const result = await service.getPositionById({
      id: 'pos-1',
      includeDistrict: true,
      includeTurnout: true,
      electionDate: '2024-11-05',
    })

    expect(projectedTurnoutService.determineElectionCode).toHaveBeenCalledWith(
      '2024-11-05',
      'CA',
    )
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'pos-1' },
      include: {
        district: {
          include: {
            ProjectedTurnouts: true,
          },
        },
      },
    })
    expect(result.district?.projectedTurnout).toMatchObject({
      id: 'pt-1',
      electionYear: 2024,
      electionCode: ElectionCode.General,
    })
  })

  it('returns null projected turnout when no turnout matches election year and code', async () => {
    vi.mocked(projectedTurnoutService.determineElectionCode).mockReturnValue(
      ElectionCode.General,
    )
    findUnique.mockResolvedValue({
      id: 'pos-1',
      brPositionId: 'br-pos-1',
      brDatabaseId: 'db-1',
      state: 'CA',
      name: 'Mayor',
      district: {
        id: 'district-1',
        L2DistrictType: 'City',
        L2DistrictName: 'Los Angeles',
        ProjectedTurnouts: [
          {
            id: 'pt-1',
            electionYear: 2023,
            electionCode: ElectionCode.LocalOrMunicipal,
          },
        ],
      },
    })

    const result = await service.getPositionById({
      id: 'pos-1',
      includeDistrict: true,
      includeTurnout: true,
      electionDate: '2024-11-05',
    })

    expect(result.district?.projectedTurnout).toBeNull()
  })

  it('throws when duplicate projected turnouts match election year and code', async () => {
    vi.mocked(projectedTurnoutService.determineElectionCode).mockReturnValue(
      ElectionCode.General,
    )
    findUnique.mockResolvedValue({
      id: 'pos-1',
      brPositionId: 'br-pos-1',
      brDatabaseId: 'db-1',
      state: 'CA',
      name: 'Mayor',
      district: {
        id: 'district-1',
        L2DistrictType: 'City',
        L2DistrictName: 'Los Angeles',
        ProjectedTurnouts: [
          {
            id: 'pt-1',
            electionYear: 2024,
            electionCode: ElectionCode.General,
          },
          {
            id: 'pt-2',
            electionYear: 2024,
            electionCode: ElectionCode.General,
          },
        ],
      },
    })

    await expect(
      service.getPositionById({
        id: 'pos-1',
        includeDistrict: true,
        includeTurnout: true,
        electionDate: '2024-11-05',
      }),
    ).rejects.toThrow(
      new InternalServerErrorException(
        'Error: Data integrity issue - duplicate turnouts found for a given electionYear and electionCode',
      ),
    )
  })

  it('throws not found when includeDistrict is true and includeTurnout is false', async () => {
    findUnique.mockResolvedValue(null)

    await expect(
      service.getPositionById({
        id: 'missing-id',
        includeDistrict: true,
        includeTurnout: false,
      }),
    ).rejects.toThrow(
      new NotFoundException('Position not found for id=missing-id'),
    )
  })

  it('throws not found when includeTurnout is true and position does not exist', async () => {
    findUnique.mockResolvedValue(null)

    await expect(
      service.getPositionById({
        id: 'missing-id',
        includeDistrict: true,
        includeTurnout: true,
        electionDate: '2024-11-05',
      }),
    ).rejects.toThrow(
      new NotFoundException('Position not found for id=missing-id'),
    )
  })

  it('throws internal server error when includeTurnout path is reached without electionDate', async () => {
    vi.spyOn(service as any, 'validateOptions').mockImplementation(
      () => undefined,
    )
    findUnique.mockResolvedValue({
      id: 'pos-1',
      brPositionId: 'br-pos-1',
      brDatabaseId: 'db-1',
      state: 'CA',
      name: 'Mayor',
      district: {
        id: 'district-1',
        L2DistrictType: 'City',
        L2DistrictName: 'Los Angeles',
        ProjectedTurnouts: [],
      },
    })

    const findPositionWithOptions = (
      service as unknown as {
        findPositionWithOptions: (params: {
          where: { id: string }
          notFoundMessage: string
          includeDistrict: boolean
          includeTurnout: boolean
        }) => Promise<unknown>
      }
    ).findPositionWithOptions.bind(service)

    await expect(
      findPositionWithOptions({
        where: { id: 'pos-1' },
        notFoundMessage: 'unused',
        includeDistrict: true,
        includeTurnout: true,
      }),
    ).rejects.toThrow(
      new InternalServerErrorException(
        'It should be impossible to get to this line without electionDate defined',
      ),
    )
  })

  it('throws not found when position does not exist', async () => {
    findUnique.mockResolvedValue(null)

    await expect(
      service.getPositionByBallotReadyId({ brPositionId: 'missing-id' }),
    ).rejects.toThrow(
      new NotFoundException('Position not found for brPositionId=missing-id'),
    )
  })

  describe('includeFilingFee', () => {
    const positionRow = {
      id: 'pos-1',
      brPositionId: 'br-pos-1',
      brDatabaseId: 'db-1',
      state: 'CA',
      name: 'Mayor',
    }

    it('does not query Race when includeFilingFee is false', async () => {
      findUnique.mockResolvedValue(positionRow)

      const result = await service.getPositionById({
        id: 'pos-1',
        includeFilingFee: false,
      })

      expect(raceFindMany).not.toHaveBeenCalled()
      expect(result.filingFee).toBeUndefined()
      expect(result.filingRequirementsText).toBeUndefined()
    })

    it('queries Race by positionId and returns null when none match', async () => {
      findUnique.mockResolvedValue(positionRow)
      raceFindMany.mockResolvedValue([])

      const result = await service.getPositionById({
        id: 'pos-1',
        includeFilingFee: true,
      })

      expect(raceFindMany).toHaveBeenCalledWith({
        where: { positionId: 'pos-1' },
        select: {
          electionDate: true,
          isPrimary: true,
          isRunoff: true,
          filingRequirements: true,
          salary: true,
        },
      })
      expect(result.filingFee).toBeNull()
      expect(result.filingRequirementsText).toBeNull()
      expect(result.filingFeeExtractionSource).toBeNull()
    })

    it('extracts the filing fee from the matching Race row', async () => {
      findUnique.mockResolvedValue(positionRow)
      raceFindMany.mockResolvedValue([
        {
          electionDate: new Date('2030-11-05'),
          isPrimary: false,
          isRunoff: false,
          filingRequirements: 'Filing fee is $250.',
          salary: null,
        },
      ])

      const result = await service.getPositionById({
        id: 'pos-1',
        includeFilingFee: true,
      })

      expect(result.filingFee).toBe(250)
      expect(result.filingRequirementsText).toBe('Filing fee is $250.')
      expect(result.filingFeeExtractionSource).toBe('direct_dollar')
    })

    it('prefers the race matching the given electionDate exactly', async () => {
      findUnique.mockResolvedValue(positionRow)
      raceFindMany.mockResolvedValue([
        {
          electionDate: new Date('2024-11-05'),
          isPrimary: false,
          isRunoff: false,
          filingRequirements: '$500 fee',
          salary: null,
        },
        {
          electionDate: new Date('2028-11-07'),
          isPrimary: false,
          isRunoff: false,
          filingRequirements: '$1,000 fee',
          salary: null,
        },
      ])

      const result = await service.getPositionById({
        id: 'pos-1',
        includeFilingFee: true,
        electionDate: '2028-11-07',
      })

      expect(result.filingFee).toBe(1000)
    })

    it('nulls out fee but keeps raw text when race has multiple dollar amounts', async () => {
      findUnique.mockResolvedValue(positionRow)
      raceFindMany.mockResolvedValue([
        {
          electionDate: new Date('2030-11-05'),
          isPrimary: false,
          isRunoff: false,
          filingRequirements: '$300 for D/R candidates, $50 for independents.',
          salary: null,
        },
      ])

      const result = await service.getPositionById({
        id: 'pos-1',
        includeFilingFee: true,
      })

      expect(result.filingFee).toBeNull()
      expect(result.filingRequirementsText).toBe(
        '$300 for D/R candidates, $50 for independents.',
      )
      expect(result.filingFeeExtractionSource).toBe('multi_value')
    })

    it('computes pct_of_salary end-to-end through the service', async () => {
      findUnique.mockResolvedValue(positionRow)
      raceFindMany.mockResolvedValue([
        {
          electionDate: new Date('2030-11-05'),
          isPrimary: false,
          isRunoff: false,
          filingRequirements: 'Filing fee is 2% of annual salary.',
          salary: '$80,000 per year',
        },
      ])

      const result = await service.getPositionById({
        id: 'pos-1',
        includeFilingFee: true,
      })

      expect(result.filingFee).toBe(1600)
      expect(result.filingFeeExtractionSource).toBe('pct_of_salary')
    })

    it('attaches filing fee fields to the includeDistrict response shape', async () => {
      findUnique.mockResolvedValue({
        ...positionRow,
        district: {
          id: 'district-1',
          L2DistrictType: 'City',
          L2DistrictName: 'Los Angeles',
        },
      })
      raceFindMany.mockResolvedValue([
        {
          electionDate: new Date('2030-11-05'),
          isPrimary: false,
          isRunoff: false,
          filingRequirements: 'Filing fee is $125.',
          salary: null,
        },
      ])

      const result = await service.getPositionById({
        id: 'pos-1',
        includeDistrict: true,
        includeFilingFee: true,
      })

      expect(result.district).toEqual({
        id: 'district-1',
        L2DistrictType: 'City',
        L2DistrictName: 'Los Angeles',
        projectedTurnout: null,
      })
      expect(result.filingFee).toBe(125)
      expect(result.filingRequirementsText).toBe('Filing fee is $125.')
      expect(result.filingFeeExtractionSource).toBe('direct_dollar')
    })

    it('attaches filing fee fields to the includeTurnout response shape', async () => {
      vi.mocked(projectedTurnoutService.determineElectionCode).mockReturnValue(
        ElectionCode.General,
      )
      findUnique.mockResolvedValue({
        ...positionRow,
        district: {
          id: 'district-1',
          L2DistrictType: 'City',
          L2DistrictName: 'Los Angeles',
          ProjectedTurnouts: [
            {
              id: 'pt-1',
              electionYear: 2030,
              electionCode: ElectionCode.General,
            },
          ],
        },
      })
      raceFindMany.mockResolvedValue([
        {
          electionDate: new Date('2030-11-05'),
          isPrimary: false,
          isRunoff: false,
          filingRequirements: 'Filing fee is $75.',
          salary: null,
        },
      ])

      const result = await service.getPositionById({
        id: 'pos-1',
        includeDistrict: true,
        includeTurnout: true,
        includeFilingFee: true,
        electionDate: '2030-11-05',
      })

      expect(result.district?.projectedTurnout).toMatchObject({
        id: 'pt-1',
        electionYear: 2030,
        electionCode: ElectionCode.General,
      })
      expect(result.filingFee).toBe(75)
      expect(result.filingFeeExtractionSource).toBe('direct_dollar')
    })
  })

  describe('getNextElectionForPosition', () => {
    it('returns the nearest future general election date', async () => {
      findUnique.mockResolvedValue({ id: 'pos-1' })
      raceFindMany.mockResolvedValue([
        {
          electionDate: new Date('2999-11-05'),
          isPrimary: false,
          isRunoff: false,
        },
        {
          electionDate: new Date('2998-11-07'),
          isPrimary: false,
          isRunoff: false,
        },
        {
          electionDate: new Date('2000-11-07'),
          isPrimary: false,
          isRunoff: false,
        },
      ])

      const result = await service.getNextElectionForPosition('pos-1')

      expect(result.electionDate).toBe('2998-11-07')
    })

    it('queries races by the Race.positionId FK, not placeId+name', async () => {
      findUnique.mockResolvedValue({ id: 'pos-1' })
      raceFindMany.mockResolvedValue([])

      await service.getNextElectionForPosition('pos-1')

      expect(raceFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { positionId: 'pos-1' } }),
      )
    })

    it('excludes primaries and runoffs when a general exists', async () => {
      findUnique.mockResolvedValue({ id: 'pos-1' })
      raceFindMany.mockResolvedValue([
        {
          electionDate: new Date('2998-03-05'),
          isPrimary: true,
          isRunoff: false,
        },
        {
          electionDate: new Date('2998-11-07'),
          isPrimary: false,
          isRunoff: false,
        },
      ])

      const result = await service.getNextElectionForPosition('pos-1')

      expect(result.electionDate).toBe('2998-11-07')
    })

    it('returns null when the position has only past races', async () => {
      findUnique.mockResolvedValue({ id: 'pos-1' })
      raceFindMany.mockResolvedValue([
        {
          electionDate: new Date('2000-11-07'),
          isPrimary: false,
          isRunoff: false,
        },
      ])

      const result = await service.getNextElectionForPosition('pos-1')

      expect(result.electionDate).toBeNull()
    })

    it('still returns election day after UTC midnight passes on that day', async () => {
      vi.setSystemTime(new Date('2998-11-07T18:00:00Z'))
      findUnique.mockResolvedValue({ id: 'pos-1' })
      raceFindMany.mockResolvedValue([
        {
          electionDate: new Date('2998-11-07T00:00:00Z'),
          isPrimary: false,
          isRunoff: false,
        },
      ])

      const result = await service.getNextElectionForPosition('pos-1')

      expect(result.electionDate).toBe('2998-11-07')
      vi.useRealTimers()
    })

    it('returns null when the position has only primary or runoff races', async () => {
      findUnique.mockResolvedValue({ id: 'pos-1' })
      raceFindMany.mockResolvedValue([
        {
          electionDate: new Date('2998-03-05'),
          isPrimary: true,
          isRunoff: false,
        },
        {
          electionDate: new Date('2998-06-10'),
          isPrimary: false,
          isRunoff: true,
        },
      ])

      const result = await service.getNextElectionForPosition('pos-1')

      expect(result.electionDate).toBeNull()
    })

    it('returns null when the position has no races', async () => {
      findUnique.mockResolvedValue({ id: 'pos-1' })
      raceFindMany.mockResolvedValue([])

      const result = await service.getNextElectionForPosition('pos-1')

      expect(result.electionDate).toBeNull()
    })

    it('throws NotFound when the position does not exist', async () => {
      findUnique.mockResolvedValue(null)

      await expect(
        service.getNextElectionForPosition('missing'),
      ).rejects.toThrow(NotFoundException)
    })
  })
})
