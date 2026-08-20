import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { ElectionApiTokenService } from '@/vendors/clerk/services/electionApiToken.service'
import { HttpService } from '@nestjs/axios'
import { NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'
import { of, throwError } from 'rxjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PositionWithOptionalDistrict } from '../types/elections.types'
import { ElectionsService } from './elections.service'

const AUTH_HEADER = { Authorization: 'Bearer mt_test' }

const makePosition = (
  turnoutValue: number | null,
): PositionWithOptionalDistrict => ({
  id: 'pos-1',
  brPositionId: 'br-pos-1',
  brDatabaseId: 'br-db-1',
  state: 'TX',
  name: 'State House 005',
  district: {
    id: 'district-1',
    state: 'TX',
    L2DistrictType: 'State_House',
    L2DistrictName: 'STATE HOUSE 005',
    projectedTurnout:
      turnoutValue !== null
        ? {
            id: 'pt-1',
            createdAt: new Date('2024-01-01'),
            updatedAt: new Date('2024-01-01'),
            electionYear: 2024,
            electionCode: 'General' as never,
            projectedTurnout: turnoutValue,
            inferenceAt: new Date('2024-01-01'),
            modelVersion: 'v1',
            districtId: 'district-1',
          }
        : null,
  },
})

// Minimal AxiosError-shaped object so `isAxiosError(error)` returns true and
// the service can read `error.response.status` / `.data.message`.
const makeAxiosError = (status: number, message: string) => ({
  isAxiosError: true,
  message: `Request failed with status code ${status}`,
  response: { status, data: { message } },
})

describe('ElectionsService', () => {
  let service: ElectionsService
  let mockHttpGet: ReturnType<typeof vi.fn>
  let mockFormattedMessage: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    process.env.ELECTION_API_URL = 'http://test-election-api'

    mockHttpGet = vi.fn()
    mockFormattedMessage = vi.fn().mockResolvedValue(undefined)

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ElectionsService,
        { provide: PinoLogger, useValue: createMockLogger() },
        {
          provide: HttpService,
          useValue: { get: mockHttpGet },
        },
        {
          provide: SlackService,
          useValue: {
            formattedMessage: mockFormattedMessage,
            errorMessage: vi.fn().mockResolvedValue(undefined),
            message: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ElectionApiTokenService,
          useValue: { authHeader: vi.fn().mockResolvedValue(AUTH_HEADER) },
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

    it('returns calculated metrics when district and turnout are present (BR ID)', async () => {
      mockHttpGet.mockReturnValue(of({ data: makePosition(1000), status: 200 }))

      const { district, projectedTurnout, winNumber, voterContactGoal } =
        await service.getPositionMatchedRaceTargetDetails(brIdParams)

      expect(district?.L2DistrictType).toBe('State_House')
      expect(district?.L2DistrictName).toBe('STATE HOUSE 005')
      expect(projectedTurnout).toBe(1000)
      expect(winNumber).toBe(501)
      expect(voterContactGoal).toBe(2505)
      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining('positions/by-ballotready-id/br-pos-1'),
        expect.objectContaining({ headers: AUTH_HEADER }),
      )
    })

    it('returns calculated metrics when district and turnout are present (GP ID)', async () => {
      mockHttpGet.mockReturnValue(of({ data: makePosition(1000), status: 200 }))

      const { district, projectedTurnout, winNumber, voterContactGoal } =
        await service.getPositionMatchedRaceTargetDetails(gpIdParams)

      expect(district?.L2DistrictType).toBe('State_House')
      expect(district?.L2DistrictName).toBe('STATE HOUSE 005')
      expect(projectedTurnout).toBe(1000)
      expect(winNumber).toBe(501)
      expect(voterContactGoal).toBe(2505)
      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining('positions/pos-1'),
        expect.objectContaining({ headers: AUTH_HEADER }),
      )
    })

    it('returns district with sentinel values when turnout is null', async () => {
      mockHttpGet.mockReturnValue(of({ data: makePosition(null), status: 200 }))

      const { district, winNumber, voterContactGoal, projectedTurnout } =
        await service.getPositionMatchedRaceTargetDetails(brIdParams)

      expect(district?.L2DistrictType).toBe('State_House')
      expect(district?.L2DistrictName).toBe('STATE HOUSE 005')
      expect(winNumber).toBe(-1)
      expect(voterContactGoal).toBe(-1)
      expect(projectedTurnout).toBe(-1)
    })

    it('throws NotFoundException when API returns position without district', async () => {
      const positionNoDistrict: PositionWithOptionalDistrict = {
        id: 'pos-1',
        brPositionId: 'br-pos-1',
        brDatabaseId: 'br-db-1',
        state: 'TX',
        name: 'State House 005',
      }
      mockHttpGet.mockReturnValue(of({ data: positionNoDistrict, status: 200 }))

      await expect(
        service.getPositionMatchedRaceTargetDetails(brIdParams),
      ).rejects.toThrow(
        new NotFoundException(
          'No position and/or associated district was found',
        ),
      )
    })

    it('throws NotFoundException when API returns null', async () => {
      mockHttpGet.mockReturnValue(of({ data: null, status: 200 }))

      await expect(
        service.getPositionMatchedRaceTargetDetails(brIdParams),
      ).rejects.toThrow(
        new NotFoundException(
          'No position and/or associated district was found',
        ),
      )
    })

    it('does not page botDev when the district match simply misses (no district)', async () => {
      const positionNoDistrict: PositionWithOptionalDistrict = {
        id: 'pos-1',
        brPositionId: 'br-pos-1',
        brDatabaseId: 'br-db-1',
        state: 'TX',
        name: 'State House 005',
      }
      mockHttpGet.mockReturnValue(of({ data: positionNoDistrict, status: 200 }))

      await expect(
        service.getPositionMatchedRaceTargetDetails(brIdParams),
      ).rejects.toBeInstanceOf(NotFoundException)
      expect(mockFormattedMessage).not.toHaveBeenCalled()
    })

    it('maps an election-api 404 to NotFoundException without paging botDev', async () => {
      mockHttpGet.mockReturnValue(
        throwError(() => makeAxiosError(404, 'Position not found for id=x')),
      )

      await expect(
        service.getPositionMatchedRaceTargetDetails(brIdParams),
      ).rejects.toBeInstanceOf(NotFoundException)
      expect(mockFormattedMessage).not.toHaveBeenCalled()
    })

    it('pages botDev and surfaces a 502 when election-api errors (genuine bug)', async () => {
      mockHttpGet.mockReturnValue(
        throwError(() =>
          makeAxiosError(500, 'The column Position.place_id does not exist'),
        ),
      )

      await expect(
        service.getPositionMatchedRaceTargetDetails(brIdParams),
      ).rejects.toMatchObject({ status: 502 })
      expect(mockFormattedMessage).toHaveBeenCalledTimes(1)
    })
  })

  describe('getPositionByBallotReadyId', () => {
    it('returns position with district when includeDistrict is true', async () => {
      const position = makePosition(1000)
      mockHttpGet.mockReturnValue(of({ data: position, status: 200 }))

      const result = await service.getPositionByBallotReadyId('br-pos-1', {
        includeDistrict: true,
      })

      expect(result).toEqual(position)
      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining('positions/by-ballotready-id/br-pos-1'),
        expect.objectContaining({
          params: { includeDistrict: true, includeTurnout: false },
        }),
      )
    })

    it('returns position without district by default', async () => {
      const position: PositionWithOptionalDistrict = {
        id: 'pos-1',
        brPositionId: 'br-pos-1',
        brDatabaseId: 'br-db-1',
        state: 'TX',
        name: 'State House 005',
      }
      mockHttpGet.mockReturnValue(of({ data: position, status: 200 }))

      const result = await service.getPositionByBallotReadyId('br-pos-1')

      expect(result).toEqual(position)
      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining('positions/by-ballotready-id/br-pos-1'),
        expect.objectContaining({
          params: { includeDistrict: false, includeTurnout: false },
        }),
      )
    })

    it('returns null when API returns null', async () => {
      mockHttpGet.mockReturnValue(of({ data: null, status: 200 }))

      const result = await service.getPositionByBallotReadyId('br-nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('resolveInternalPositionId', () => {
    it('returns the internal id when the value is a BallotReady id', async () => {
      mockHttpGet.mockReturnValue(of({ data: makePosition(1000), status: 200 }))

      const result = await service.resolveInternalPositionId('br-pos-1')

      expect(result).toBe('pos-1')
      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining('positions/by-ballotready-id/br-pos-1'),
        expect.anything(),
      )
    })

    it('falls back to the input when the BallotReady lookup throws', async () => {
      mockHttpGet.mockReturnValue(throwError(() => new Error('not found')))

      const result = await service.resolveInternalPositionId('already-internal')

      expect(result).toBe('already-internal')
    })

    it('falls back to the input when no position resolves', async () => {
      mockHttpGet.mockReturnValue(of({ data: null, status: 200 }))

      const result = await service.resolveInternalPositionId('br-nonexistent')

      expect(result).toBe('br-nonexistent')
    })
  })

  describe('getNextElectionForPosition', () => {
    it('returns the parsed next election for a position', async () => {
      mockHttpGet.mockReturnValue(
        of({ data: { electionDate: '2100-11-02' }, status: 200 }),
      )

      const result = await service.getNextElectionForPosition('pos-1')

      expect(result).toEqual({ electionDate: '2100-11-02' })
      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining('positions/pos-1/next-election'),
        expect.anything(),
      )
    })

    it('returns null for an empty positionId without calling the API', async () => {
      const result = await service.getNextElectionForPosition('')

      expect(result).toBeNull()
      expect(mockHttpGet).not.toHaveBeenCalled()
    })

    it('returns null when election-api fails', async () => {
      mockHttpGet.mockReturnValue(throwError(() => new Error('network')))

      const result = await service.getNextElectionForPosition('pos-1')

      expect(result).toBeNull()
    })
  })

  describe('searchPositions', () => {
    it('searchPositions calls /v1/positions/search with the right params and parses the response', async () => {
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
      mockHttpGet.mockReturnValue(of({ data: [sampleRow], status: 200 }))

      const result = await service.searchPositions({
        zip: '90210',
        displayOfficeLevels: ['City'],
        timeframe: 'future',
      })

      expect(result).toEqual([sampleRow])
      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining('/v1/positions/search'),
        expect.objectContaining({
          params: {
            zip: '90210',
            displayOfficeLevels: ['City'],
            timeframe: 'future',
          },
        }),
      )
    })

    it('forwards name-only queries', async () => {
      mockHttpGet.mockReturnValue(of({ data: [], status: 200 }))

      await service.searchPositions({ name: 'mayor' })

      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining('/v1/positions/search'),
        expect.objectContaining({
          params: expect.objectContaining({ name: 'mayor' }),
        }),
      )
    })

    it('forwards officeType arrays', async () => {
      mockHttpGet.mockReturnValue(of({ data: [], status: 200 }))

      await service.searchPositions({ officeType: ['Mayor', 'Sheriff'] })

      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining('/v1/positions/search'),
        expect.objectContaining({
          params: expect.objectContaining({
            officeType: ['Mayor', 'Sheriff'],
          }),
        }),
      )
    })

    it('serializes array params as repeated keys (not comma-joined)', async () => {
      mockHttpGet.mockReturnValue(of({ data: [], status: 200 }))

      await service.searchPositions({
        zip: '90210',
        displayOfficeLevels: ['Local', 'Township', 'Village'],
      })

      const callArgs = mockHttpGet.mock.calls[0] as [
        string,
        {
          paramsSerializer: (params: Record<string, unknown>) => string
        },
      ]
      const { paramsSerializer } = callArgs[1]
      const serialized = paramsSerializer({
        zip: '90210',
        displayOfficeLevels: ['Local', 'Township', 'Village'],
      })

      expect(serialized).toContain('displayOfficeLevels=Local')
      expect(serialized).toContain('displayOfficeLevels=Township')
      expect(serialized).toContain('displayOfficeLevels=Village')
      expect(serialized).not.toContain('Local%2CTownship')
      expect(serialized).not.toContain('Local,Township')
    })
  })

  describe('getZipCodesByBrPositionId', () => {
    it('calls /v1/positions/by-ballotready-id/:brPositionId/zip-codes and returns the parsed zip array', async () => {
      mockHttpGet.mockReturnValue(
        of({ data: ['90210', '90211', '90212'], status: 200 }),
      )

      const result = await service.getZipCodesByBrPositionId('br-pos-1')

      expect(result).toEqual(['90210', '90211', '90212'])
      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining(
          '/v1/positions/by-ballotready-id/br-pos-1/zip-codes',
        ),
        expect.any(Object),
      )
    })

    it('returns an empty array when the API returns null/empty', async () => {
      mockHttpGet.mockReturnValue(of({ data: [], status: 200 }))

      const result = await service.getZipCodesByBrPositionId('br-pos-1')

      expect(result).toEqual([])
    })
  })

  describe('getDistrictId', () => {
    it('returns district id when API returns results', async () => {
      mockHttpGet.mockReturnValue(
        of({ data: [{ id: 'district-uuid-1' }], status: 200 }),
      )

      const result = await service.getDistrictId('CA', 'City', 'Los Angeles')

      expect(result).toBe('district-uuid-1')
      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining('districts/list'),
        expect.objectContaining({
          params: {
            state: 'CA',
            L2DistrictType: 'City',
            L2DistrictName: 'Los Angeles',
            districtColumns: 'id',
          },
        }),
      )
    })

    it('returns null when API returns empty array', async () => {
      mockHttpGet.mockReturnValue(of({ data: [], status: 200 }))

      const result = await service.getDistrictId(
        'CA',
        'City',
        'Nonexistent City',
      )

      expect(result).toBeNull()
    })

    it('returns null when API returns null', async () => {
      mockHttpGet.mockReturnValue(of({ data: null, status: 200 }))

      const result = await service.getDistrictId('CA', 'City', 'Test')

      expect(result).toBeNull()
    })

    it('throws when API throws', async () => {
      mockHttpGet.mockImplementation(() => {
        throw new Error('Network error')
      })

      await expect(
        service.getDistrictId('CA', 'City', 'Test'),
      ).rejects.toThrow()
    })

    it('cleans district name with ## separators', async () => {
      mockHttpGet.mockReturnValue(
        of({ data: [{ id: 'district-cleaned' }], status: 200 }),
      )

      await service.getDistrictId(
        'CA',
        'State Senate',
        'Short ## Much Longer District Name',
      )

      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining('districts/list'),
        expect.objectContaining({
          params: expect.objectContaining({
            L2DistrictName: 'Much Longer District Name',
          }),
        }),
      )
    })
  })

  describe('getPersonIdByGpApiUserId', () => {
    it('returns the linked person id and passes the numeric user id as text', async () => {
      mockHttpGet.mockReturnValue(
        of({ data: [{ id: 'person-uuid-1' }], status: 200 }),
      )

      const result = await service.getPersonIdByGpApiUserId(12345)

      expect(result).toBe('person-uuid-1')
      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining('/v1/persons'),
        expect.objectContaining({
          params: { gpApiUserId: '12345', columns: 'id' },
        }),
      )
    })

    it('returns null when no person is linked to the user', async () => {
      mockHttpGet.mockReturnValue(of({ data: [], status: 200 }))

      const result = await service.getPersonIdByGpApiUserId(999)

      expect(result).toBeNull()
    })

    it('returns null (swallows) when election-api fails', async () => {
      mockHttpGet.mockImplementation(() => {
        throw new Error('boom')
      })

      const result = await service.getPersonIdByGpApiUserId(42)

      expect(result).toBeNull()
    })
  })

  describe('buildRaceTargetDetails with districtId', () => {
    it('returns metrics when election-api returns valid turnout via districtId', async () => {
      mockHttpGet.mockReturnValue(
        of({
          data: {
            projectedTurnout: 5000,
            L2DistrictType: 'City',
            L2DistrictName: 'Ward 1',
          },
          status: 200,
        }),
      )

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
      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining('projectedTurnout'),
        expect.objectContaining({
          params: { districtId: 'district-uuid', electionDate: '2024-11-05' },
        }),
      )
    })

    it('returns null when election-api returns null via districtId', async () => {
      mockHttpGet.mockReturnValue(of({ data: null, status: 200 }))

      const result = await service.buildRaceTargetDetails({
        districtId: 'district-uuid',
        electionDate: '2024-11-05',
      })

      expect(result).toBeNull()
    })

    it('returns null when election-api throws via districtId', async () => {
      mockHttpGet.mockImplementation(() => {
        throw new Error('Network error')
      })

      const result = await service.buildRaceTargetDetails({
        districtId: 'district-uuid',
        electionDate: '2024-11-05',
      })

      expect(result).toBeNull()
    })

    it('does not apply cleanDistrictName when using districtId', async () => {
      mockHttpGet.mockReturnValue(
        of({
          data: { projectedTurnout: 3000 },
          status: 200,
        }),
      )

      await service.buildRaceTargetDetails({
        districtId: 'district-uuid',
        electionDate: '2024-11-05',
      })

      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining('projectedTurnout'),
        expect.objectContaining({
          params: { districtId: 'district-uuid', electionDate: '2024-11-05' },
        }),
      )
    })

    it('does not page botDev when turnout is simply missing (no-match)', async () => {
      mockHttpGet.mockReturnValue(of({ data: null, status: 200 }))

      const result = await service.buildRaceTargetDetails({
        districtId: 'district-uuid',
        electionDate: '2024-11-05',
      })

      expect(result).toBeNull()
      expect(mockFormattedMessage).not.toHaveBeenCalled()
    })

    it('does not page botDev on an election-api 404 (no-match)', async () => {
      mockHttpGet.mockReturnValue(
        throwError(() => makeAxiosError(404, 'No projectedTurnout found')),
      )

      const result = await service.buildRaceTargetDetails({
        districtId: 'district-uuid',
        electionDate: '2024-11-05',
      })

      expect(result).toBeNull()
      expect(mockFormattedMessage).not.toHaveBeenCalled()
    })

    it('pages botDev when election-api errors (genuine bug)', async () => {
      mockHttpGet.mockReturnValue(
        throwError(() => makeAxiosError(500, 'internal error')),
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
    it('returns the issues array from the API and forwards districtId', async () => {
      const issues = [
        { label: 'Education', score: 88, priority: 'high' as const },
      ]
      mockHttpGet.mockReturnValue(of({ data: issues, status: 200 }))

      const result = await service.getVoterIssues({ districtId: 'd-1' })

      expect(result).toEqual(issues)
      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining('voter-issues'),
        expect.objectContaining({ params: { districtId: 'd-1' } }),
      )
    })

    it('returns null when the API returns null', async () => {
      mockHttpGet.mockReturnValue(of({ data: null, status: 200 }))

      const result = await service.getVoterIssues({ districtId: 'd-1' })

      expect(result).toBeNull()
    })

    it('forwards the level query param when provided', async () => {
      mockHttpGet.mockReturnValue(of({ data: [], status: 200 }))

      await service.getVoterIssues({ districtId: 'd-1', level: 'local' })

      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining('voter-issues'),
        expect.objectContaining({
          params: { districtId: 'd-1', level: 'local' },
        }),
      )
    })
  })

  describe('fetchFilingFeeByRaceHash', () => {
    it('returns null without calling the API when brHashId is empty', async () => {
      const result = await service.fetchFilingFeeByRaceHash('')

      expect(result).toBeNull()
      expect(mockHttpGet).not.toHaveBeenCalled()
    })

    it('forwards the brHashId on the URL and returns the API response', async () => {
      const response = {
        filingFee: 100,
        filingRequirementsText: '$100 filing fee',
        extractionSource: 'direct_dollar' as const,
      }
      mockHttpGet.mockReturnValue(of({ data: response, status: 200 }))

      const result = await service.fetchFilingFeeByRaceHash('br-hash-123')

      expect(result).toEqual(response)
      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining('races/by-br-hash-id/br-hash-123/filing-fee'),
        expect.anything(),
      )
    })

    it('URI-encodes brHashes that contain special characters', async () => {
      mockHttpGet.mockReturnValue(
        of({
          data: {
            filingFee: null,
            filingRequirementsText: null,
            extractionSource: null,
          },
          status: 200,
        }),
      )

      // BallotReady GraphQL Node IDs are base64 and can contain `/` and `=`.
      await service.fetchFilingFeeByRaceHash('Z2lkOi8v/ballot=')

      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining(
          `races/by-br-hash-id/${encodeURIComponent('Z2lkOi8v/ballot=')}/filing-fee`,
        ),
        expect.anything(),
      )
    })

    it('returns null and swallows errors when the API call fails', async () => {
      mockHttpGet.mockImplementation(() => {
        throw new Error('boom')
      })

      const result = await service.fetchFilingFeeByRaceHash('br-hash-1')

      expect(result).toBeNull()
    })
  })

  describe('getElectionFrequencyByBrHashId', () => {
    it('returns null without calling the API when brHashId is empty', async () => {
      const result = await service.getElectionFrequencyByBrHashId('')

      expect(result).toBeNull()
      expect(mockHttpGet).not.toHaveBeenCalled()
    })

    it('forwards the brHashId on the URL and returns the parsed cadence', async () => {
      const response = {
        frequency: [4],
        electionDate: '2024-11-05T00:00:00.000Z',
      }
      mockHttpGet.mockReturnValue(of({ data: response, status: 200 }))

      const result = await service.getElectionFrequencyByBrHashId('br-hash-123')

      expect(result).toEqual(response)
      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining('races/by-br-hash-id/br-hash-123/frequency'),
        expect.anything(),
      )
    })

    it('URI-encodes brHashes that contain special characters', async () => {
      mockHttpGet.mockReturnValue(
        of({ data: { frequency: [], electionDate: null }, status: 200 }),
      )

      await service.getElectionFrequencyByBrHashId('Z2lkOi8v/ballot=')

      expect(mockHttpGet).toHaveBeenCalledWith(
        expect.stringContaining(
          `races/by-br-hash-id/${encodeURIComponent('Z2lkOi8v/ballot=')}/frequency`,
        ),
        expect.anything(),
      )
    })

    it('returns null and swallows errors when the API call fails', async () => {
      mockHttpGet.mockImplementation(() => {
        throw new Error('boom')
      })

      const result = await service.getElectionFrequencyByBrHashId('br-hash-1')

      expect(result).toBeNull()
    })

    it('returns null when the response fails schema validation', async () => {
      // A malformed payload (frequency not an array) must not propagate a
      // half-typed object into term derivation — degrade to no enrichment.
      mockHttpGet.mockReturnValue(
        of({ data: { frequency: 4, electionDate: null }, status: 200 }),
      )

      const result = await service.getElectionFrequencyByBrHashId('br-hash-1')

      expect(result).toBeNull()
    })
  })

  describe('fetchCampaignStrategyContext', () => {
    it('returns null without calling the API when brHashId is empty', async () => {
      const mockHttpPost = vi.fn()
      Object.defineProperty(service, 'httpService', {
        get: () => ({ get: mockHttpGet, post: mockHttpPost }),
        configurable: true,
      })

      const result = await service.fetchCampaignStrategyContext('')

      expect(result).toBeNull()
      expect(mockHttpPost).not.toHaveBeenCalled()
    })

    it('POSTs to /campaign-strategy-context with brHashId in the body', async () => {
      const mockHttpPost = vi.fn().mockReturnValue(
        of({
          data: {
            candidate_count: 0,
            candidate_office: null,
            candidates: [],
            civics_win_number: null,
            contacts_needed_estimate: 100,
            general_election_date: '2026-11-03',
            number_of_seats: 1,
            office_level: null,
            office_type: null,
            official_office_name: null,
            primary_election_date: null,
            projected_turnout: 200,
            // election-api still sends this; gp-api no longer declares it. Kept
            // here on purpose so the fixture is the old producer's payload and
            // proves the extra key passes through untouched -- the property this
            // rollout depends on until the producer-side removal ships.
            projected_voter_turnout: null,
            registered_voters: 900,
            unique_cellphones: 500,
            unique_landlines: 300,
            relevant_election_date: '2026-11-03',
            state: 'CA',
            win_number_effective: 100,
            win_number_estimate: 101,
          },
          status: 200,
        }),
      )
      Object.defineProperty(service, 'httpService', {
        get: () => ({ get: mockHttpGet, post: mockHttpPost }),
        configurable: true,
      })

      const result = await service.fetchCampaignStrategyContext('Z2lk-hash')

      expect(result?.registered_voters).toBe(900)
      expect(result?.win_number_effective).toBe(100)
      expect(mockHttpPost).toHaveBeenCalledWith(
        expect.stringContaining('campaign-strategy-context'),
        { brHashId: 'Z2lk-hash' },
        { headers: AUTH_HEADER },
      )
    })

    it('returns null and swallows errors when election-api throws', async () => {
      const mockHttpPost = vi.fn().mockImplementation(() => {
        throw new Error('boom')
      })
      Object.defineProperty(service, 'httpService', {
        get: () => ({ get: mockHttpGet, post: mockHttpPost }),
        configurable: true,
      })

      const result = await service.fetchCampaignStrategyContext('Z2lk-hash')

      expect(result).toBeNull()
    })
  })
})
