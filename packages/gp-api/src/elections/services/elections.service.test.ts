import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CampaignStrategyContextService } from '@/electionDb/campaignStrategyContext/campaign-strategy-context.service'
import { DistrictsService } from '@/electionDb/districts/districts.service'
import { PersonsService } from '@/electionDb/persons/persons.service'
import { PositionsService } from '@/electionDb/positions/positions.service'
import { PositionWithOptionalDistrict } from '@/electionDb/positions/positions.types'
import { ProjectedTurnoutService } from '@/electionDb/projectedTurnout/projectedTurnout.service'
import { RacesService as ElectionDbRacesService } from '@/electionDb/races/races.service'
import { VoterIssuesService } from '@/electionDb/voterIssues/voterIssues.service'
import { ZipToPositionService } from '@/electionDb/zipToPosition/zipToPosition.service'
import { ElectionsService } from './elections.service'

// The position lookup carries no turnout: it is resolved from the
// district-keyed projectedTurnout lookup instead.
const makePosition = (): PositionWithOptionalDistrict => ({
  id: 'pos-1',
  brPositionId: 'br-pos-1',
  brDatabaseId: 'br-db-1',
  state: 'TX',
  name: 'State House 005',
  level: null,
  isWinIcp: null,
  isServeIcp: null,
  district: {
    id: 'district-1',
    state: 'TX',
    L2DistrictType: 'State_House',
    L2DistrictName: 'STATE HOUSE 005',
  },
})

const makePositionWithoutDistrict = (): PositionWithOptionalDistrict => ({
  id: 'pos-1',
  brPositionId: 'br-pos-1',
  brDatabaseId: 'br-db-1',
  state: 'TX',
  name: 'State House 005',
  level: null,
  isWinIcp: null,
  isServeIcp: null,
})

describe('ElectionsService', () => {
  let service: ElectionsService
  let positions: {
    getPositionById: ReturnType<typeof vi.fn>
    getPositionByBallotReadyId: ReturnType<typeof vi.fn>
    getNextElectionForPosition: ReturnType<typeof vi.fn>
  }
  let districts: {
    findUnique: ReturnType<typeof vi.fn>
    getDistricts: ReturnType<typeof vi.fn>
    getDistrictTypes: ReturnType<typeof vi.fn>
    getDistrictNames: ReturnType<typeof vi.fn>
  }
  let zipToPosition: {
    search: ReturnType<typeof vi.fn>
    getZipCodesByBrPositionId: ReturnType<typeof vi.fn>
  }
  let voterIssues: { getVoterIssues: ReturnType<typeof vi.fn> }
  let persons: { getPersons: ReturnType<typeof vi.fn> }
  let projectedTurnout: { getProjectedTurnout: ReturnType<typeof vi.fn> }
  let races: {
    findFilingFeeByBrHashId: ReturnType<typeof vi.fn>
    findFrequencyByBrHashId: ReturnType<typeof vi.fn>
  }
  let campaignStrategyContext: {
    getCampaignStrategyContext: ReturnType<typeof vi.fn>
  }
  let mockFormattedMessage: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    positions = {
      getPositionById: vi.fn(),
      getPositionByBallotReadyId: vi.fn(),
      getNextElectionForPosition: vi.fn(),
    }
    districts = {
      findUnique: vi.fn(),
      getDistricts: vi.fn(),
      getDistrictTypes: vi.fn(),
      getDistrictNames: vi.fn(),
    }
    zipToPosition = {
      search: vi.fn(),
      getZipCodesByBrPositionId: vi.fn(),
    }
    voterIssues = { getVoterIssues: vi.fn() }
    persons = { getPersons: vi.fn() }
    projectedTurnout = { getProjectedTurnout: vi.fn() }
    races = {
      findFilingFeeByBrHashId: vi.fn(),
      findFrequencyByBrHashId: vi.fn(),
    }
    campaignStrategyContext = { getCampaignStrategyContext: vi.fn() }
    mockFormattedMessage = vi.fn().mockResolvedValue(undefined)

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ElectionsService,
        { provide: PinoLogger, useValue: createMockLogger() },
        { provide: PositionsService, useValue: positions },
        { provide: DistrictsService, useValue: districts },
        { provide: ZipToPositionService, useValue: zipToPosition },
        { provide: VoterIssuesService, useValue: voterIssues },
        { provide: PersonsService, useValue: persons },
        { provide: ProjectedTurnoutService, useValue: projectedTurnout },
        { provide: ElectionDbRacesService, useValue: races },
        {
          provide: CampaignStrategyContextService,
          useValue: campaignStrategyContext,
        },
        {
          provide: SlackService,
          useValue: {
            formattedMessage: mockFormattedMessage,
            errorMessage: vi.fn().mockResolvedValue(undefined),
            message: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile()

    service = module.get<ElectionsService>(ElectionsService)

    const mockLogger = createMockLogger()
    Object.defineProperty(service, 'logger', {
      get: () => mockLogger,
      configurable: true,
    })

    vi.clearAllMocks()
  })

  describe('getPositionMatchedRaceTargetDetails', () => {
    const brIdParams = {
      ballotreadyPositionId: 'br-pos-1',
      electionDate: '2024-11-05',
      includeTurnout: true,
      campaignId: 123,
      officeName: 'City Council',
    }

    const gpIdParams = {
      positionId: 'pos-1',
      electionDate: '2024-11-05',
      includeTurnout: true,
      campaignId: 456,
      officeName: undefined,
    }

    // Two lookups now: the position, then the district-keyed turnout.
    const mockPositionThenTurnout = (turnout: number | null) => {
      positions.getPositionByBallotReadyId.mockResolvedValue(makePosition())
      positions.getPositionById.mockResolvedValue(makePosition())
      projectedTurnout.getProjectedTurnout.mockResolvedValue(
        turnout === null ? null : { projectedTurnout: turnout },
      )
    }

    it('returns calculated metrics when district and turnout are present (BR ID)', async () => {
      mockPositionThenTurnout(1000)

      const {
        district,
        projectedTurnout: turnout,
        winNumber,
        voterContactGoal,
      } = await service.getPositionMatchedRaceTargetDetails(brIdParams)

      expect(district?.L2DistrictType).toBe('State_House')
      expect(district?.L2DistrictName).toBe('STATE HOUSE 005')
      expect(turnout).toBe(1000)
      expect(winNumber).toBe(501)
      expect(voterContactGoal).toBe(2505)
      expect(positions.getPositionByBallotReadyId).toHaveBeenCalledWith({
        brPositionId: 'br-pos-1',
        electionDate: '2024-11-05',
        includeDistrict: true,
        includeFilingFee: true,
      })
      expect(projectedTurnout.getProjectedTurnout).toHaveBeenCalledWith(
        expect.objectContaining({
          districtId: 'district-1',
          electionDate: '2024-11-05',
        }),
      )
    })

    it('returns calculated metrics when district and turnout are present (GP ID)', async () => {
      mockPositionThenTurnout(1000)

      const {
        district,
        projectedTurnout: turnout,
        winNumber,
        voterContactGoal,
      } = await service.getPositionMatchedRaceTargetDetails(gpIdParams)

      expect(district?.L2DistrictType).toBe('State_House')
      expect(district?.L2DistrictName).toBe('STATE HOUSE 005')
      expect(turnout).toBe(1000)
      expect(winNumber).toBe(501)
      expect(voterContactGoal).toBe(2505)
      expect(positions.getPositionById).toHaveBeenCalledWith({
        id: 'pos-1',
        electionDate: '2024-11-05',
        includeDistrict: true,
        includeFilingFee: true,
      })
    })

    it('returns district with sentinel values when turnout is null', async () => {
      mockPositionThenTurnout(null)

      const {
        district,
        winNumber,
        voterContactGoal,
        projectedTurnout: turnout,
      } = await service.getPositionMatchedRaceTargetDetails(brIdParams)

      expect(district?.L2DistrictType).toBe('State_House')
      expect(district?.L2DistrictName).toBe('STATE HOUSE 005')
      expect(winNumber).toBe(-1)
      expect(voterContactGoal).toBe(-1)
      expect(turnout).toBe(-1)
    })

    it('throws NotFoundException when the position has no district', async () => {
      positions.getPositionByBallotReadyId.mockResolvedValue(
        makePositionWithoutDistrict(),
      )

      await expect(
        service.getPositionMatchedRaceTargetDetails(brIdParams),
      ).rejects.toThrow(
        new NotFoundException(
          'No position and/or associated district was found',
        ),
      )
    })

    it('propagates NotFoundException when the position does not exist', async () => {
      positions.getPositionByBallotReadyId.mockRejectedValue(
        new NotFoundException('Position not found for brPositionId=x'),
      )

      await expect(
        service.getPositionMatchedRaceTargetDetails(brIdParams),
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    it('does not page botDev when the district match simply misses (no district)', async () => {
      positions.getPositionByBallotReadyId.mockResolvedValue(
        makePositionWithoutDistrict(),
      )

      await expect(
        service.getPositionMatchedRaceTargetDetails(brIdParams),
      ).rejects.toBeInstanceOf(NotFoundException)
      expect(mockFormattedMessage).not.toHaveBeenCalled()
    })

    it('does not page botDev when the position lookup 404s', async () => {
      positions.getPositionByBallotReadyId.mockRejectedValue(
        new NotFoundException('Position not found for brPositionId=x'),
      )

      await expect(
        service.getPositionMatchedRaceTargetDetails(brIdParams),
      ).rejects.toBeInstanceOf(NotFoundException)
      expect(mockFormattedMessage).not.toHaveBeenCalled()
    })

    it('pages botDev and rethrows when the lookup fails (genuine bug)', async () => {
      const boom = new Error('The column Position.place_id does not exist')
      positions.getPositionByBallotReadyId.mockRejectedValue(boom)

      await expect(
        service.getPositionMatchedRaceTargetDetails(brIdParams),
      ).rejects.toThrow(boom)
      expect(mockFormattedMessage).toHaveBeenCalledTimes(1)
    })
  })

  describe('getPositionByBallotReadyId', () => {
    it('returns position with district when includeDistrict is true', async () => {
      const position = makePosition()
      positions.getPositionByBallotReadyId.mockResolvedValue(position)

      const result = await service.getPositionByBallotReadyId('br-pos-1', {
        includeDistrict: true,
      })

      expect(result).toEqual(position)
      expect(positions.getPositionByBallotReadyId).toHaveBeenCalledWith({
        brPositionId: 'br-pos-1',
        includeDistrict: true,
      })
    })

    it('returns position without district by default', async () => {
      const position = makePositionWithoutDistrict()
      positions.getPositionByBallotReadyId.mockResolvedValue(position)

      const result = await service.getPositionByBallotReadyId('br-pos-1')

      expect(result).toEqual(position)
      expect(positions.getPositionByBallotReadyId).toHaveBeenCalledWith({
        brPositionId: 'br-pos-1',
        includeDistrict: false,
      })
    })

    it('propagates NotFoundException when no position resolves', async () => {
      positions.getPositionByBallotReadyId.mockRejectedValue(
        new NotFoundException('Position not found for brPositionId=x'),
      )

      await expect(
        service.getPositionByBallotReadyId('br-nonexistent'),
      ).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  describe('resolveInternalPositionId', () => {
    it('returns the internal id when the value is a BallotReady id', async () => {
      positions.getPositionByBallotReadyId.mockResolvedValue(makePosition())

      const result = await service.resolveInternalPositionId('br-pos-1')

      expect(result).toBe('pos-1')
      expect(positions.getPositionByBallotReadyId).toHaveBeenCalledWith(
        expect.objectContaining({ brPositionId: 'br-pos-1' }),
      )
    })

    it('falls back to the input when the BallotReady lookup throws', async () => {
      positions.getPositionByBallotReadyId.mockRejectedValue(
        new Error('not found'),
      )

      const result = await service.resolveInternalPositionId('already-internal')

      expect(result).toBe('already-internal')
    })

    it('falls back to the input when no position resolves', async () => {
      positions.getPositionByBallotReadyId.mockRejectedValue(
        new NotFoundException('Position not found for brPositionId=x'),
      )

      const result = await service.resolveInternalPositionId('br-nonexistent')

      expect(result).toBe('br-nonexistent')
    })
  })

  describe('getDistrict', () => {
    it('returns only the district columns the route used to serve', async () => {
      const district = {
        id: 'district-1',
        state: 'TX',
        L2DistrictType: 'State_House',
        L2DistrictName: 'STATE HOUSE 005',
        registeredVoters: 1234,
        uniqueCellphones: null,
        uniqueLandlines: null,
      }
      districts.findUnique.mockResolvedValue(district)

      const result = await service.getDistrict('district-1')

      expect(result).toEqual(district)
      expect(districts.findUnique).toHaveBeenCalledWith({
        where: { id: 'district-1' },
        select: expect.objectContaining({
          id: true,
          registeredVoters: true,
        }),
      })
      // createdAt/updatedAt were never on the wire and must stay off the
      // in-process result too.
      const selectArg = districts.findUnique.mock.calls[0]?.[0] as {
        select: Record<string, boolean>
      }
      expect(selectArg.select.createdAt).toBeUndefined()
      expect(selectArg.select.updatedAt).toBeUndefined()
    })

    it('throws NotFoundException when the district is unknown', async () => {
      districts.findUnique.mockResolvedValue(null)

      await expect(service.getDistrict('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      )
    })
  })

  describe('searchPositions', () => {
    const sampleRow = {
      id: 'race-1',
      brPositionId: 'br-pos-1',
      position: { name: 'Mayor', level: 'City', state: 'CA' },
      election: { electionDay: '2026-11-03' },
      isPrimary: false,
      isRunoff: false,
      city: 'Beverly Hills',
      district: null,
    }

    it('forwards the search params and parses the response', async () => {
      zipToPosition.search.mockResolvedValue([sampleRow])

      const result = await service.searchPositions({
        zip: '90210',
        displayOfficeLevels: ['City'],
        timeframe: 'future',
      })

      expect(result).toEqual([sampleRow])
      expect(zipToPosition.search).toHaveBeenCalledWith({
        zip: '90210',
        displayOfficeLevels: ['City'],
        timeframe: 'future',
      })
    })

    it('forwards name-only queries', async () => {
      zipToPosition.search.mockResolvedValue([])

      await service.searchPositions({ name: 'mayor' })

      expect(zipToPosition.search).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'mayor' }),
      )
    })

    it('forwards officeType arrays intact', async () => {
      zipToPosition.search.mockResolvedValue([])

      await service.searchPositions({ officeType: ['Mayor', 'Sheriff'] })

      expect(zipToPosition.search).toHaveBeenCalledWith(
        expect.objectContaining({ officeType: ['Mayor', 'Sheriff'] }),
      )
    })

    it('forwards multi-value displayOfficeLevels as an array', async () => {
      zipToPosition.search.mockResolvedValue([])

      await service.searchPositions({
        zip: '90210',
        displayOfficeLevels: ['Local', 'Township', 'Village'],
      })

      expect(zipToPosition.search).toHaveBeenCalledWith(
        expect.objectContaining({
          displayOfficeLevels: ['Local', 'Township', 'Village'],
        }),
      )
    })

    it('strips keys the response schema does not declare', async () => {
      // The schema used to narrow a wire payload; with no network boundary it
      // is what keeps stray database columns out of gp-api responses.
      zipToPosition.search.mockResolvedValue([
        { ...sampleRow, internalOnly: 'leak' },
      ])

      const result = await service.searchPositions({ zip: '90210' })

      expect(result[0]).not.toHaveProperty('internalOnly')
    })
  })

  describe('getZipCodesByBrPositionId', () => {
    it('looks the zips up by BR position id and parses the array', async () => {
      zipToPosition.getZipCodesByBrPositionId.mockResolvedValue([
        '90210',
        '90211',
        '90212',
      ])

      const result = await service.getZipCodesByBrPositionId('br-pos-1')

      expect(result).toEqual(['90210', '90211', '90212'])
      expect(zipToPosition.getZipCodesByBrPositionId).toHaveBeenCalledWith(
        'br-pos-1',
      )
    })

    it('returns an empty array when there are no zips', async () => {
      zipToPosition.getZipCodesByBrPositionId.mockResolvedValue([])

      const result = await service.getZipCodesByBrPositionId('br-pos-1')

      expect(result).toEqual([])
    })
  })

  describe('getDistrictId', () => {
    it('returns the district id and forwards the id-only column filter', async () => {
      districts.getDistricts.mockResolvedValue([{ id: 'district-uuid-1' }])

      const result = await service.getDistrictId('CA', 'City', 'Los Angeles')

      expect(result).toBe('district-uuid-1')
      expect(districts.getDistricts).toHaveBeenCalledWith({
        state: 'CA',
        L2DistrictType: 'City',
        L2DistrictName: 'Los Angeles',
        districtColumns: 'id',
        excludeInvalid: false,
      })
    })

    it('propagates NotFoundException when no district matches', async () => {
      // The district list lookup 404s on an empty result, exactly as the HTTP
      // route it replaced did — callers have always seen the throw.
      districts.getDistricts.mockRejectedValue(
        new NotFoundException('No districts found for query: {}'),
      )

      await expect(
        service.getDistrictId('CA', 'City', 'Nonexistent City'),
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    it('returns null when the matched row carries no id', async () => {
      districts.getDistricts.mockResolvedValue([{}])

      const result = await service.getDistrictId('CA', 'City', 'Test')

      expect(result).toBeNull()
    })

    it('throws when the lookup throws', async () => {
      districts.getDistricts.mockRejectedValue(new Error('Network error'))

      await expect(
        service.getDistrictId('CA', 'City', 'Test'),
      ).rejects.toThrow()
    })

    it('cleans district name with ## separators', async () => {
      districts.getDistricts.mockResolvedValue([{ id: 'district-cleaned' }])

      await service.getDistrictId(
        'CA',
        'State Senate',
        'Short ## Much Longer District Name',
      )

      expect(districts.getDistricts).toHaveBeenCalledWith(
        expect.objectContaining({
          L2DistrictName: 'Much Longer District Name',
        }),
      )
    })
  })

  describe('getPersonIdByGpApiUserId', () => {
    it('returns the linked person id and passes the numeric user id as text', async () => {
      persons.getPersons.mockResolvedValue([{ id: 'person-uuid-1' }])

      const result = await service.getPersonIdByGpApiUserId(12345)

      expect(result).toBe('person-uuid-1')
      expect(persons.getPersons).toHaveBeenCalledWith(
        expect.objectContaining({ gpApiUserId: '12345', columns: 'id' }),
      )
    })

    it('returns null when no person is linked to the user', async () => {
      persons.getPersons.mockResolvedValue([])

      const result = await service.getPersonIdByGpApiUserId(999)

      expect(result).toBeNull()
    })

    it('returns null (swallows) when the lookup fails', async () => {
      persons.getPersons.mockRejectedValue(new Error('boom'))

      const result = await service.getPersonIdByGpApiUserId(42)

      expect(result).toBeNull()
    })
  })

  describe('buildRaceTargetDetails with districtId', () => {
    it('returns metrics when a projected turnout row is found via districtId', async () => {
      projectedTurnout.getProjectedTurnout.mockResolvedValue({
        projectedTurnout: 5000,
        L2DistrictType: 'City',
        L2DistrictName: 'Ward 1',
      })

      const result = await service.buildRaceTargetDetails({
        districtId: 'district-uuid',
        electionDate: '2024-11-05',
      })

      expect(result).toEqual(
        expect.objectContaining({
          projectedTurnout: 5000,
          winNumber: 2501,
          voterContactGoal: 12505,
        }),
      )
      expect(projectedTurnout.getProjectedTurnout).toHaveBeenCalledWith(
        expect.objectContaining({
          districtId: 'district-uuid',
          electionDate: '2024-11-05',
        }),
      )
    })

    it('returns null when no projected turnout row exists via districtId', async () => {
      projectedTurnout.getProjectedTurnout.mockResolvedValue(null)

      const result = await service.buildRaceTargetDetails({
        districtId: 'district-uuid',
        electionDate: '2024-11-05',
      })

      expect(result).toBeNull()
    })

    it('returns null when the turnout lookup throws via districtId', async () => {
      projectedTurnout.getProjectedTurnout.mockRejectedValue(
        new Error('Network error'),
      )

      const result = await service.buildRaceTargetDetails({
        districtId: 'district-uuid',
        electionDate: '2024-11-05',
      })

      expect(result).toBeNull()
    })

    it('does not apply cleanDistrictName when using districtId', async () => {
      projectedTurnout.getProjectedTurnout.mockResolvedValue({
        projectedTurnout: 3000,
      })

      await service.buildRaceTargetDetails({
        districtId: 'district-uuid',
        electionDate: '2024-11-05',
      })

      expect(projectedTurnout.getProjectedTurnout).toHaveBeenCalledWith(
        expect.objectContaining({
          districtId: 'district-uuid',
          electionDate: '2024-11-05',
        }),
      )
    })

    it('does not page botDev when turnout is simply missing (no-match)', async () => {
      projectedTurnout.getProjectedTurnout.mockResolvedValue(null)

      const result = await service.buildRaceTargetDetails({
        districtId: 'district-uuid',
        electionDate: '2024-11-05',
      })

      expect(result).toBeNull()
      expect(mockFormattedMessage).not.toHaveBeenCalled()
    })

    it('does not page botDev on a not-found turnout lookup (no-match)', async () => {
      projectedTurnout.getProjectedTurnout.mockRejectedValue(
        new NotFoundException('No projectedTurnout found'),
      )

      const result = await service.buildRaceTargetDetails({
        districtId: 'district-uuid',
        electionDate: '2024-11-05',
      })

      expect(result).toBeNull()
      expect(mockFormattedMessage).not.toHaveBeenCalled()
    })

    it('pages botDev when the turnout lookup errors (genuine bug)', async () => {
      projectedTurnout.getProjectedTurnout.mockRejectedValue(
        new Error('internal error'),
      )

      const result = await service.buildRaceTargetDetails({
        districtId: 'district-uuid',
        electionDate: '2024-11-05',
      })

      expect(result).toBeNull()
      expect(mockFormattedMessage).toHaveBeenCalledTimes(1)
    })
  })

  describe('cleanDistrictName', () => {
    it('returns original name when no ## separator', () => {
      expect(service.cleanDistrictName('Los Angeles')).toBe('Los Angeles')
    })

    it('returns longest segment when ## separator present', () => {
      expect(service.cleanDistrictName('Short ## Much Longer Name')).toBe(
        'Much Longer Name',
      )
    })

    it('handles multiple ## segments', () => {
      expect(
        service.cleanDistrictName(
          'A ## Medium Len ## The Longest Segment Here',
        ),
      ).toBe('The Longest Segment Here')
    })

    it('trims whitespace from segments', () => {
      expect(service.cleanDistrictName('  Short  ##  Longer Name  ')).toBe(
        'Longer Name',
      )
    })

    it('filters out empty segments', () => {
      expect(service.cleanDistrictName('## ## Valid Name')).toBe('Valid Name')
    })

    it('returns original when all segments are empty', () => {
      expect(service.cleanDistrictName('## ##')).toBe('## ##')
    })
  })

  describe('getVoterIssues', () => {
    it('returns the issues and applies the route default limit', async () => {
      const issues = [
        { label: 'Education', score: 88, priority: 'high' as const },
      ]
      voterIssues.getVoterIssues.mockResolvedValue(issues)

      const result = await service.getVoterIssues({ districtId: 'd-1' })

      expect(result).toEqual(issues)
      expect(voterIssues.getVoterIssues).toHaveBeenCalledWith({
        districtId: 'd-1',
        limit: 10,
      })
    })

    it('returns an empty array when the district has no issues', async () => {
      voterIssues.getVoterIssues.mockResolvedValue([])

      const result = await service.getVoterIssues({ districtId: 'd-1' })

      expect(result).toEqual([])
    })

    it('forwards the level filter when provided', async () => {
      voterIssues.getVoterIssues.mockResolvedValue([])

      await service.getVoterIssues({ districtId: 'd-1', level: 'local' })

      expect(voterIssues.getVoterIssues).toHaveBeenCalledWith({
        districtId: 'd-1',
        limit: 10,
        level: 'local',
      })
    })
  })

  describe('fetchFilingFeeByRaceHash', () => {
    it('returns null without a lookup when brHashId is empty', async () => {
      const result = await service.fetchFilingFeeByRaceHash('')

      expect(result).toBeNull()
      expect(races.findFilingFeeByBrHashId).not.toHaveBeenCalled()
    })

    it('forwards the brHashId and returns the lookup result', async () => {
      const response = {
        filingFee: 100,
        filingRequirementsText: '$100 filing fee',
        extractionSource: 'direct_dollar' as const,
        filingOfficeAddress: null,
        filingPhoneNumber: null,
        paperworkInstructions: null,
      }
      races.findFilingFeeByBrHashId.mockResolvedValue(response)

      const result = await service.fetchFilingFeeByRaceHash('br-hash-123')

      expect(result).toEqual(response)
      expect(races.findFilingFeeByBrHashId).toHaveBeenCalledWith('br-hash-123')
    })

    it('passes hashes with special characters through verbatim', async () => {
      races.findFilingFeeByBrHashId.mockResolvedValue({
        filingFee: null,
        filingRequirementsText: null,
        extractionSource: null,
        filingOfficeAddress: null,
        filingPhoneNumber: null,
        paperworkInstructions: null,
      })

      // BallotReady GraphQL Node IDs are base64 and can contain `/` and `=`.
      await service.fetchFilingFeeByRaceHash('Z2lkOi8v/ballot=')

      expect(races.findFilingFeeByBrHashId).toHaveBeenCalledWith(
        'Z2lkOi8v/ballot=',
      )
    })

    it('returns null and swallows errors when the lookup fails', async () => {
      races.findFilingFeeByBrHashId.mockRejectedValue(new Error('boom'))

      const result = await service.fetchFilingFeeByRaceHash('br-hash-1')

      expect(result).toBeNull()
    })
  })

  describe('getElectionFrequencyByBrHashId', () => {
    it('returns null without a lookup when brHashId is empty', async () => {
      const result = await service.getElectionFrequencyByBrHashId('')

      expect(result).toBeNull()
      expect(races.findFrequencyByBrHashId).not.toHaveBeenCalled()
    })

    it('forwards the brHashId and returns the parsed cadence', async () => {
      const response = {
        frequency: [4],
        electionDate: '2024-11-05T00:00:00.000Z',
      }
      races.findFrequencyByBrHashId.mockResolvedValue(response)

      const result = await service.getElectionFrequencyByBrHashId('br-hash-123')

      expect(result).toEqual(response)
      expect(races.findFrequencyByBrHashId).toHaveBeenCalledWith('br-hash-123')
    })

    it('passes hashes with special characters through verbatim', async () => {
      races.findFrequencyByBrHashId.mockResolvedValue({
        frequency: [],
        electionDate: null,
      })

      await service.getElectionFrequencyByBrHashId('Z2lkOi8v/ballot=')

      expect(races.findFrequencyByBrHashId).toHaveBeenCalledWith(
        'Z2lkOi8v/ballot=',
      )
    })

    it('returns null and swallows errors when the lookup fails', async () => {
      races.findFrequencyByBrHashId.mockRejectedValue(new Error('boom'))

      const result = await service.getElectionFrequencyByBrHashId('br-hash-1')

      expect(result).toBeNull()
    })

    it('returns null when the result fails schema validation', async () => {
      // A malformed payload (frequency not an array) must not propagate a
      // half-typed object into term derivation — degrade to no enrichment.
      races.findFrequencyByBrHashId.mockResolvedValue({
        frequency: 4,
        electionDate: null,
      })

      const result = await service.getElectionFrequencyByBrHashId('br-hash-1')

      expect(result).toBeNull()
    })
  })

  describe('getNextElectionForPosition', () => {
    it('returns the parsed next election for a position', async () => {
      positions.getNextElectionForPosition.mockResolvedValue({
        electionDate: '2100-11-02',
      })

      const result = await service.getNextElectionForPosition('pos-1')

      expect(result).toEqual({ electionDate: '2100-11-02' })
      expect(positions.getNextElectionForPosition).toHaveBeenCalledWith('pos-1')
    })

    it('returns null for an empty positionId without a lookup', async () => {
      const result = await service.getNextElectionForPosition('')

      expect(result).toBeNull()
      expect(positions.getNextElectionForPosition).not.toHaveBeenCalled()
    })

    it('returns null when the lookup fails', async () => {
      positions.getNextElectionForPosition.mockRejectedValue(
        new NotFoundException('Position not found for id=pos-1'),
      )

      const result = await service.getNextElectionForPosition('pos-1')

      expect(result).toBeNull()
    })
  })

  describe('fetchCampaignStrategyContext', () => {
    const context = {
      candidate_count: 0,
      candidate_office: null,
      candidates: [],
      civics_win_number: null,
      contacts_needed_estimate: 100,
      election_code: 'General' as const,
      general_election_date: '2026-11-03',
      number_of_seats: 1,
      office_level: null,
      office_type: null,
      partisan_type: null,
      official_office_name: null,
      primary_election_date: null,
      projected_turnout: 200,
      projected_turnout_lower: null,
      projected_turnout_upper: null,
      registered_voters: 900,
      unique_cellphones: 500,
      unique_landlines: 300,
      relevant_election_date: '2026-11-03',
      state: 'CA',
      win_number_effective: 100,
      win_number_estimate: 101,
      win_number_lower: null,
      win_number_upper: null,
    }

    it('returns null without a lookup when brHashId is empty', async () => {
      const result = await service.fetchCampaignStrategyContext('')

      expect(result).toBeNull()
      expect(
        campaignStrategyContext.getCampaignStrategyContext,
      ).not.toHaveBeenCalled()
    })

    it('looks the context up by brHashId', async () => {
      campaignStrategyContext.getCampaignStrategyContext.mockResolvedValue(
        context,
      )

      const result = await service.fetchCampaignStrategyContext('Z2lk-hash')

      expect(result?.registered_voters).toBe(900)
      expect(result?.win_number_effective).toBe(100)
      expect(result?.election_code).toBe('General')
      expect(
        campaignStrategyContext.getCampaignStrategyContext,
      ).toHaveBeenCalledWith({ brHashId: 'Z2lk-hash' })
    })

    it('returns null and swallows errors when the lookup throws', async () => {
      campaignStrategyContext.getCampaignStrategyContext.mockRejectedValue(
        new Error('boom'),
      )

      const result = await service.fetchCampaignStrategyContext('Z2lk-hash')

      expect(result).toBeNull()
    })
  })
})
