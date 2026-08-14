import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { VoterFileDownloadAccessService } from '@/shared/services/voterFileDownloadAccess.service'
import { BallotReadyPositionLevel } from '@goodparty_org/contracts'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { Campaign, Organization, VoterFileFilter } from '../../generated/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactsService } from './contacts.service'
import { VOTER_DATA_UNAVAILABLE_ERROR_CODE } from '../contacts.types'
import {
  AggregatesDTO,
  DownloadPeopleDTO,
  ListPeopleDTO,
} from '@/peopleDb/schemas/people.schema'

const PRO_FEATURE_MSG =
  'Search and segments are only available for pro campaigns'
// The ported people-db services run their DTOs through Zod, whose districtId
// field is z.guid() — every district id fixture below must be GUID-shaped
// (unlike the retired httpService path, which never validated these).
const OVERRIDE_DISTRICT_ID = '11111111-1111-1111-1111-111111111111'
const POSITION_DISTRICT_ID = '22222222-2222-2222-2222-222222222222'
const ELIGIBLE_DISTRICT_ID = '33333333-3333-3333-3333-333333333333'
const PROPOSED_DISTRICT_ID = '44444444-4444-4444-4444-444444444444'
const POSITION_ID_FIXTURE = 'position-uuid'
const PERSON_ID_1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const PERSON_ID_2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const PERSON_ID_3 = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

// A district that carries L2 location data, so the real download-access rule
// (VoterFileDownloadAccessService.canDownload) treats the campaign as eligible.
const ELIGIBLE_DISTRICT = {
  id: ELIGIBLE_DISTRICT_ID,
  state: 'CA',
  l2Type: 'City',
  l2Name: 'Springfield',
}

const makeOrganization = (
  overrides: Partial<Organization> = {},
): Organization =>
  ({
    slug: 'campaign-1',
    ownerId: 100,
    positionId: null,
    overrideDistrictId: null,
    customPositionName: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Organization

const makeCampaign = (overrides: Partial<Campaign> = {}): Campaign =>
  ({
    id: 1,
    slug: 'test-campaign',
    organizationSlug: 'campaign-1',
    isPro: true,
    canDownloadFederal: false,
    details: {},
    ...overrides,
  }) as Campaign

const EMPTY_PAGE = {
  people: [],
  pagination: {
    totalResults: 0,
    currentPage: 1,
    pageSize: 10,
    totalPages: 0,
    hasNextPage: false,
    hasPreviousPage: false,
  },
}

// `<Dto>.create`'s declared parameter type is `unknown` (nestjs-zod), so a
// spy's captured call arg needs a narrowing helper to read the pre-transform
// `filters` field back out.
const filtersOf = (arg: unknown): unknown =>
  (arg as { filters?: unknown } | undefined)?.filters

describe('ContactsService', () => {
  describe('findContacts and downloadContacts', () => {
    let service: ContactsService
    let mockVoterFileFilterService: {
      findByIdAndOrganizationSlug: ReturnType<typeof vi.fn>
      findOutreachesByVoterFileFilterId: ReturnType<typeof vi.fn>
    }
    let mockElectionsService: {
      cleanDistrictName: ReturnType<typeof vi.fn>
      getPositionById: ReturnType<typeof vi.fn>
    }
    let mockCampaignsService: {
      findFirst: ReturnType<typeof vi.fn>
    }
    let mockOrganizationsService: {
      getDistrictAndBallotLevelForOrgSlug: ReturnType<typeof vi.fn>
    }
    let voterFileDownloadAccess: VoterFileDownloadAccessService
    let mockSupportStatusService: {
      statusForPeople: ReturnType<typeof vi.fn>
    }
    let mockContactStatusService: {
      currentStatusForPeople: ReturnType<typeof vi.fn>
      changeStatus: ReturnType<typeof vi.fn>
    }
    let mockContactInteractionTextService: {
      latestOptOutAt: ReturnType<typeof vi.fn>
    }
    let mockActivityConditionResolutionService: {
      resolveIdFilter: ReturnType<typeof vi.fn>
    }
    let mockVoterQueryService: {
      findPeople: ReturnType<typeof vi.fn>
      getAggregates: ReturnType<typeof vi.fn>
      samplePeople: ReturnType<typeof vi.fn>
      findPerson: ReturnType<typeof vi.fn>
    }
    let mockVoterDownloadService: {
      streamPeopleCsv: ReturnType<typeof vi.fn>
    }
    let mockStatsService: {
      getStats: ReturnType<typeof vi.fn>
    }
    let mockContactsMadeResolutionService: {
      resolveContactsMade: ReturnType<typeof vi.fn>
    }
    let mockRouteWinDistrict: ReturnType<typeof vi.fn>
    let mockDistrictRoutingService: {
      routeWinDistrict: ReturnType<typeof vi.fn>
    }

    beforeEach(() => {
      mockVoterFileFilterService = {
        findByIdAndOrganizationSlug: vi.fn().mockResolvedValue(null),
        findOutreachesByVoterFileFilterId: vi.fn().mockResolvedValue([]),
      }
      mockElectionsService = {
        cleanDistrictName: vi.fn((name: string) => name),
        getPositionById: vi.fn().mockResolvedValue(null),
      }
      mockCampaignsService = {
        findFirst: vi.fn().mockResolvedValue(null),
      }
      mockOrganizationsService = {
        getDistrictAndBallotLevelForOrgSlug: vi.fn().mockResolvedValue({
          district: ELIGIBLE_DISTRICT,
          ballotLevel: null,
        }),
      }

      // Drive the real eligibility rule rather than mocking canDownload away,
      // so the federal/state tests verify the actual download-gate logic.
      voterFileDownloadAccess = new VoterFileDownloadAccessService({
        message: vi.fn(),
      } as never)
      ;(voterFileDownloadAccess as unknown as { logger: PinoLogger }).logger =
        createMockLogger()
      mockSupportStatusService = {
        statusForPeople: vi.fn().mockResolvedValue(new Map()),
      }
      mockContactStatusService = {
        currentStatusForPeople: vi.fn().mockResolvedValue(new Map()),
        changeStatus: vi.fn(),
      }
      mockContactInteractionTextService = {
        latestOptOutAt: vi.fn().mockResolvedValue(null),
      }
      mockActivityConditionResolutionService = {
        resolveIdFilter: vi.fn().mockResolvedValue({ kind: 'none' }),
      }
      mockVoterQueryService = {
        findPeople: vi.fn().mockResolvedValue(EMPTY_PAGE),
        getAggregates: vi.fn(),
        samplePeople: vi.fn(),
        findPerson: vi.fn(),
      }
      mockVoterDownloadService = {
        streamPeopleCsv: vi.fn().mockResolvedValue(undefined),
      }
      mockStatsService = {
        getStats: vi.fn(),
      }
      mockContactsMadeResolutionService = {
        resolveContactsMade: vi.fn().mockResolvedValue({ kind: 'none' }),
      }
      mockRouteWinDistrict = vi.fn(async (_slug: string, current) => current)
      mockDistrictRoutingService = {
        routeWinDistrict: mockRouteWinDistrict,
      }

      service = new ContactsService(
        mockVoterFileFilterService as never,
        mockElectionsService as never,
        mockCampaignsService as never,
        mockOrganizationsService as never,
        voterFileDownloadAccess,
        mockSupportStatusService as never,
        mockContactStatusService as never,
        mockContactInteractionTextService as never,
        mockActivityConditionResolutionService as never,
        mockVoterQueryService as never,
        mockVoterDownloadService as never,
        mockStatsService as never,
        mockContactsMadeResolutionService as never,
        mockDistrictRoutingService as never,
        createMockLogger(),
      )
      vi.clearAllMocks()
    })

    describe('findContacts (search)', () => {
      it('throws when search is used and organization is not pro', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue({ isPro: false })

        await expect(
          service.findContacts(
            { resultsPerPage: 10, page: 1, search: 'smith', segment: 'all' },
            org,
          ),
        ).rejects.toThrow(BadRequestException)
        await expect(
          service.findContacts(
            { resultsPerPage: 10, page: 1, search: 'smith', segment: 'all' },
            org,
          ),
        ).rejects.toThrow(PRO_FEATURE_MSG)
      })

      it('throws when a named segment is used and organization is not pro', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue({ isPro: false })

        await expect(
          service.findContacts(
            { resultsPerPage: 10, page: 1, segment: 'texting' },
            org,
          ),
        ).rejects.toThrow(BadRequestException)
        await expect(
          service.findContacts(
            { resultsPerPage: 10, page: 1, segment: 'texting' },
            org,
          ),
        ).rejects.toThrow(PRO_FEATURE_MSG)
      })

      it('returns a synthetic preview with the real total when not pro', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue({ isPro: false })
        mockStatsService.getStats.mockResolvedValue({
          districtId: OVERRIDE_DISTRICT_ID,
          totalConstituents: 1234,
          buckets: {},
        })

        const result = await service.findContacts(
          { resultsPerPage: 10, page: 1, segment: 'all' },
          org,
        )

        // No real voter PII: the people-db list query is never made. Only
        // the aggregate stats call runs, to keep the real total truthful so
        // the unblurred stat card doesn't regress (ENG-10508).
        expect(mockVoterQueryService.findPeople).not.toHaveBeenCalled()
        expect(result.people).toHaveLength(10)
        expect(result.pagination.totalResults).toBe(1234)
      })

      it('allows search when organization is an elected office (eo- slug)', async () => {
        const org = makeOrganization({
          slug: 'eo-office-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })

        await expect(
          service.findContacts(
            { resultsPerPage: 10, page: 1, search: 'smith', segment: 'all' },
            org,
          ),
        ).resolves.toBeDefined()
      })

      it('allows search when campaign is pro (isPro) even with a non-EO org', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue({ isPro: true })

        await expect(
          service.findContacts(
            { resultsPerPage: 10, page: 1, search: 'smith', segment: 'all' },
            org,
          ),
        ).resolves.toBeDefined()
      })

      it('does not check the search/pro gate when search is not provided', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        // Non-pro (no campaign) base list takes the synthetic-preview path,
        // which reads the aggregate stats for the real total.
        mockStatsService.getStats.mockResolvedValue({
          districtId: OVERRIDE_DISTRICT_ID,
          totalConstituents: 10,
          buckets: {},
        })

        await expect(
          service.findContacts(
            {
              resultsPerPage: 10,
              page: 1,
              search: undefined,
              segment: 'all',
            },
            org,
          ),
        ).resolves.toBeDefined()
      })
    })

    describe('downloadContacts', () => {
      const makeMockReply = (headersSent = false) => {
        const flushHeaders = vi.fn()
        const setHeader = vi.fn()
        const on = vi.fn()
        return {
          flushHeaders,
          setHeader,
          on,
          res: { raw: { headersSent, flushHeaders, setHeader, on } } as never,
        }
      }

      it('throws when organization is not pro and never touches response headers', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue({ isPro: false })
        const { res, flushHeaders, setHeader } = makeMockReply()

        await expect(
          service.downloadContacts({ segment: 'all' }, res, org),
        ).rejects.toThrow(BadRequestException)
        await expect(
          service.downloadContacts({ segment: 'all' }, res, org),
        ).rejects.toThrow('Campaign is not pro')

        // Critical: pre-flight failures must NOT leave Content-Disposition,
        // Set-Cookie, or a flushed 200 on the wire — otherwise the browser
        // saves the JSON error body as `contacts.csv` and the client cookie
        // poll falsely flips to "Download started".
        expect(setHeader).not.toHaveBeenCalled()
        expect(flushHeaders).not.toHaveBeenCalled()
        expect(mockVoterDownloadService.streamPeopleCsv).not.toHaveBeenCalled()
      })

      it('allows download when campaign is pro (isPro) even with a non-EO org', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue({ isPro: true })
        const { res } = makeMockReply()

        await expect(
          service.downloadContacts({ segment: 'all' }, res, org),
        ).resolves.toBeUndefined()
        expect(mockVoterDownloadService.streamPeopleCsv).toHaveBeenCalledOnce()
      })

      it('allows download when organization is an elected office', async () => {
        const org = makeOrganization({
          slug: 'eo-office-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        const { res } = makeMockReply()

        await expect(
          service.downloadContacts({ segment: 'all' }, res, org),
        ).resolves.toBeUndefined()
        expect(mockVoterDownloadService.streamPeopleCsv).toHaveBeenCalledOnce()
      })
    })

    describe('countVoterFilePeople', () => {
      it('counts for a NON-pro campaign — the voter-file endpoint is gated by its controller guard, not pro', async () => {
        const org = makeOrganization({
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue({
          isPro: false,
          details: {},
        })
        mockVoterQueryService.findPeople.mockResolvedValue({
          people: [],
          pagination: { totalResults: 1234 },
        })

        const count = await service.countVoterFilePeople(
          { hasCellPhone: true },
          false,
          org,
        )

        expect(count).toBe(1234)
        expect(mockVoterQueryService.findPeople).toHaveBeenCalledWith(
          expect.objectContaining({
            districtId: OVERRIDE_DISTRICT_ID,
            resultsPerPage: 1,
            page: 1,
            groupByHousehold: false,
          }),
        )
      })

      it('forwards groupByHousehold so doorKnocking counts households', async () => {
        const org = makeOrganization({
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue({
          isPro: true,
          details: {},
        })
        mockVoterQueryService.findPeople.mockResolvedValue({
          people: [],
          pagination: { totalResults: 7 },
        })

        await service.countVoterFilePeople({}, true, org)

        expect(mockVoterQueryService.findPeople).toHaveBeenCalledWith(
          expect.objectContaining({ groupByHousehold: true }),
        )
      })

      it('propagates a people-db failure without swallowing it', async () => {
        const org = makeOrganization({
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue({
          isPro: true,
          details: {},
        })
        mockVoterQueryService.findPeople.mockRejectedValue(
          new Error('connection refused'),
        )

        // No BadGatewayException wrapper anymore — DB errors are left to
        // propagate to gp-api's global exception filter (rules.mdc Rule 3).
        await expect(
          service.countVoterFilePeople({}, false, org),
        ).rejects.toThrow('connection refused')
      })
    })

    describe('downloadVoterFilePeople', () => {
      it('streams the people-db CSV for a NON-pro campaign', async () => {
        const org = makeOrganization({
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue({
          isPro: false,
          details: {},
        })
        const res = {
          raw: {
            headersSent: false,
            flushHeaders: vi.fn(),
            setHeader: vi.fn(),
            on: vi.fn(),
          },
        } as never

        await service.downloadVoterFilePeople(
          { hasLandline: true },
          false,
          org,
          res,
        )

        expect(mockVoterDownloadService.streamPeopleCsv).toHaveBeenCalledWith(
          expect.objectContaining({
            districtId: OVERRIDE_DISTRICT_ID,
            groupByHousehold: false,
            excludeColumns: undefined,
          }),
          res,
          expect.any(Object),
        )
      })

      it('excludes the party column for an elected-office org', async () => {
        const org = makeOrganization({
          slug: 'eo-office-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        const res = {
          raw: {
            headersSent: false,
            flushHeaders: vi.fn(),
            setHeader: vi.fn(),
            on: vi.fn(),
          },
        } as never

        await service.downloadVoterFilePeople({}, false, org, res)

        expect(mockVoterDownloadService.streamPeopleCsv).toHaveBeenCalledWith(
          expect.objectContaining({
            excludeColumns: ['Parties_Description'],
          }),
          res,
          expect.any(Object),
        )
      })
    })

    describe('organization-based district resolution', () => {
      it('uses overrideDistrictId when present on organization', async () => {
        const org = makeOrganization({
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
          positionId: POSITION_ID_FIXTURE,
        })
        // Pro: only the real fetch path forwards the districtId to the
        // people-db query; non-pro short-circuits to the synthetic preview.
        mockCampaignsService.findFirst.mockResolvedValue({ isPro: true })

        await service.findContacts(
          { resultsPerPage: 10, page: 1, search: undefined, segment: 'all' },
          org,
        )

        expect(mockVoterQueryService.findPeople).toHaveBeenCalledWith(
          expect.objectContaining({ districtId: OVERRIDE_DISTRICT_ID }),
        )
        expect(mockElectionsService.getPositionById).not.toHaveBeenCalled()
      })

      it('falls back to position district when overrideDistrictId is null', async () => {
        const org = makeOrganization({
          positionId: POSITION_ID_FIXTURE,
        })
        mockCampaignsService.findFirst.mockResolvedValue({ isPro: true })

        mockElectionsService.getPositionById.mockResolvedValue({
          id: POSITION_ID_FIXTURE,
          district: {
            id: POSITION_DISTRICT_ID,
            L2DistrictType: 'State_Senate',
            L2DistrictName: 'District 1',
          },
        })

        await service.findContacts(
          { resultsPerPage: 10, page: 1, search: undefined, segment: 'all' },
          org,
        )

        expect(mockElectionsService.getPositionById).toHaveBeenCalledWith(
          POSITION_ID_FIXTURE,
          { includeDistrict: true },
        )
        expect(mockVoterQueryService.findPeople).toHaveBeenCalledWith(
          expect.objectContaining({ districtId: POSITION_DISTRICT_ID }),
        )
      })

      it('throws when position has no district', async () => {
        const org = makeOrganization({ positionId: POSITION_ID_FIXTURE })
        mockElectionsService.getPositionById.mockResolvedValue({
          id: POSITION_ID_FIXTURE,
          state: 'WY',
          district: null,
        })

        await expect(
          service.findContacts(
            {
              resultsPerPage: 10,
              page: 1,
              search: undefined,
              segment: 'all',
            },
            org,
          ),
        ).rejects.toThrow(
          'Organization does not have sufficient data to resolve district',
        )
      })

      it('throws when org has no positionId and no overrideDistrictId', async () => {
        const org = makeOrganization()

        await expect(
          service.findContacts(
            {
              resultsPerPage: 10,
              page: 1,
              search: undefined,
              segment: 'all',
            },
            org,
          ),
        ).rejects.toThrow(
          'Organization does not have sufficient data to resolve district',
        )
      })

      it('uses overrideDistrictId for getDistrictStats', async () => {
        const org = makeOrganization({
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockStatsService.getStats.mockResolvedValue({
          districtId: OVERRIDE_DISTRICT_ID,
          totalConstituents: 500,
          buckets: {},
        })

        await service.getDistrictStats(org)

        expect(mockStatsService.getStats).toHaveBeenCalledWith(
          expect.objectContaining({ districtId: OVERRIDE_DISTRICT_ID }),
        )
      })

      it('uses overrideDistrictId for findPerson', async () => {
        const org = makeOrganization({
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue({ isPro: true })
        mockVoterQueryService.findPerson.mockResolvedValue({
          id: 'person-1',
          firstName: 'Test',
        })

        await service.findPerson('person-1', org)

        expect(mockVoterQueryService.findPerson).toHaveBeenCalledWith(
          'person-1',
          expect.objectContaining({ districtId: OVERRIDE_DISTRICT_ID }),
        )
      })

      it('throws on findPerson when the campaign is not pro', async () => {
        const org = makeOrganization({
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue({ isPro: false })

        await expect(service.findPerson('person-1', org)).rejects.toThrow(
          BadRequestException,
        )
        expect(mockVoterQueryService.findPerson).not.toHaveBeenCalled()
      })

      it('uses overrideDistrictId for downloadContacts', async () => {
        const org = makeOrganization({
          slug: 'eo-office-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        const res = {
          raw: {
            headersSent: false,
            flushHeaders: vi.fn(),
            setHeader: vi.fn(),
            on: vi.fn(),
          },
        } as never

        await service.downloadContacts({ segment: 'all' }, res, org)

        expect(mockVoterDownloadService.streamPeopleCsv).toHaveBeenCalledWith(
          expect.objectContaining({ districtId: OVERRIDE_DISTRICT_ID }),
          res,
          expect.any(Object),
        )
      })
    })

    describe('voter-data eligibility (Win federal/state alignment)', () => {
      const getErrorBody = async (promise: Promise<unknown>) => {
        try {
          await promise
          throw new Error('expected promise to reject')
        } catch (err) {
          expect(err).toBeInstanceOf(BadRequestException)
          return (err as BadRequestException).getResponse() as {
            errorCode?: string
          }
        }
      }

      it('tags an unresolved district with a stable error code', async () => {
        const org = makeOrganization()

        const body = await getErrorBody(
          service.findContacts(
            { resultsPerPage: 10, page: 1, search: undefined, segment: 'all' },
            org,
          ),
        )

        expect(body.errorCode).toBe(VOTER_DATA_UNAVAILABLE_ERROR_CODE)
        expect(VOTER_DATA_UNAVAILABLE_ERROR_CODE).toBe('VOTER_DATA_UNAVAILABLE')
      })

      it('rejects a FEDERAL campaign without canDownloadFederal or L2 data', async () => {
        const org = makeOrganization({
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(
          makeCampaign({
            canDownloadFederal: false,
            details: { ballotLevel: BallotReadyPositionLevel.FEDERAL },
          }),
        )
        mockOrganizationsService.getDistrictAndBallotLevelForOrgSlug.mockResolvedValue(
          { district: null, ballotLevel: BallotReadyPositionLevel.FEDERAL },
        )

        const body = await getErrorBody(
          service.findContacts(
            { resultsPerPage: 10, page: 1, search: undefined, segment: 'all' },
            org,
          ),
        )

        expect(body.errorCode).toBe(VOTER_DATA_UNAVAILABLE_ERROR_CODE)
        expect(mockVoterQueryService.findPeople).not.toHaveBeenCalled()
      })

      it('allows a FEDERAL campaign that has canDownloadFederal', async () => {
        const org = makeOrganization({
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(
          makeCampaign({
            canDownloadFederal: true,
            details: { ballotLevel: BallotReadyPositionLevel.FEDERAL },
          }),
        )
        mockOrganizationsService.getDistrictAndBallotLevelForOrgSlug.mockResolvedValue(
          { district: null, ballotLevel: BallotReadyPositionLevel.FEDERAL },
        )

        await expect(
          service.findContacts(
            { resultsPerPage: 10, page: 1, search: undefined, segment: 'all' },
            org,
          ),
        ).resolves.toBeDefined()
        expect(mockVoterQueryService.findPeople).toHaveBeenCalledTimes(1)
      })

      it('does not gate elected-office orgs on eligibility', async () => {
        const org = makeOrganization({
          slug: 'eo-office-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(
          makeCampaign({
            canDownloadFederal: false,
            details: { ballotLevel: BallotReadyPositionLevel.FEDERAL },
          }),
        )

        await expect(
          service.findContacts(
            { resultsPerPage: 10, page: 1, search: undefined, segment: 'all' },
            org,
          ),
        ).resolves.toBeDefined()
        expect(
          mockOrganizationsService.getDistrictAndBallotLevelForOrgSlug,
        ).not.toHaveBeenCalled()
      })
    })

    describe('org-only path (no campaign in org)', () => {
      it('returns a synthetic preview for an org with no linked campaign', async () => {
        const org = makeOrganization({
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(null)
        mockStatsService.getStats.mockResolvedValue({
          districtId: OVERRIDE_DISTRICT_ID,
          totalConstituents: 42,
          buckets: {},
        })

        const result = await service.findContacts(
          { resultsPerPage: 10, page: 1, search: undefined, segment: 'all' },
          org,
        )

        // No campaign means no pro entitlement, so the base list must not
        // pull real voter PII from people-db — it serves the synthetic
        // preview.
        expect(mockVoterQueryService.findPeople).not.toHaveBeenCalled()
        expect(result.people).toHaveLength(10)
        expect(result.pagination.totalResults).toBe(42)
      })
    })

    describe('political party exposure (Win vs Serve)', () => {
      const partySegment = {
        id: 7,
        name: 'Democrats',
        partyDemocrat: true,
      } as VoterFileFilter

      it('forwards the political-party filter to the people-db query for Win', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockVoterFileFilterService.findByIdAndOrganizationSlug.mockResolvedValue(
          partySegment,
        )
        const createSpy = vi.spyOn(ListPeopleDTO, 'create')

        await service.findContacts(
          { resultsPerPage: 10, page: 1, search: undefined, segment: '7' },
          org,
        )

        expect(createSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            filters: { politicalParty: { eq: 'Democratic' } },
          }),
        )
      })

      it('returns the people-db politicalParty field unchanged for Win', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockVoterQueryService.findPeople.mockResolvedValue({
          people: [{ id: 'p1', politicalParty: 'Republican' }],
          pagination: {},
        })

        const result = await service.findContacts(
          { resultsPerPage: 10, page: 1, search: undefined, segment: 'all' },
          org,
        )

        expect(result.people[0]?.politicalParty).toBe('Republican')
      })

      // Server-enforced Serve party-visibility rule (ENG-10696). Win keeps the
      // old, unfiltered behavior (asserted above); an `eo-` org now (1) never
      // sees `politicalParty` in a response, and (2) gets a 400 — not a
      // silently-stripped 200 — for any request whose filter resolves to a
      // party condition, on list, count, and download alike. The typeahead UI
      // calls this same `findContacts` path, so this list coverage doubles as
      // typeahead coverage — there is no separate typeahead route.
      it('strips politicalParty from the list/typeahead response for a Serve (eo-) org', async () => {
        const org = makeOrganization({
          slug: 'eo-mayor-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockVoterQueryService.findPeople.mockResolvedValue({
          people: [{ id: 'p1', politicalParty: 'Democratic' }],
          pagination: {},
        })

        const result = await service.findContacts(
          { resultsPerPage: 10, page: 1, search: undefined, segment: 'all' },
          org,
        )

        expect(result.people[0]).not.toHaveProperty('politicalParty')
      })

      it('rejects a party-segment list request for a Serve (eo-) org with 400, without calling people-db', async () => {
        const org = makeOrganization({
          slug: 'eo-mayor-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockVoterFileFilterService.findByIdAndOrganizationSlug.mockResolvedValue(
          partySegment,
        )

        await expect(
          service.findContacts(
            { resultsPerPage: 10, page: 1, search: undefined, segment: '7' },
            org,
          ),
        ).rejects.toThrow(BadRequestException)
        expect(mockVoterQueryService.findPeople).not.toHaveBeenCalled()
      })

      it('rejects a party-filter count request for a Serve (eo-) org with 400, without calling people-db', async () => {
        const org = makeOrganization({
          slug: 'eo-mayor-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })

        await expect(
          service.countContacts({ partyDemocrat: true }, org),
        ).rejects.toThrow(BadRequestException)
        expect(mockVoterQueryService.findPeople).not.toHaveBeenCalled()
      })

      it('rejects a party-segment download request for a Serve (eo-) org with 400, without calling people-db', async () => {
        const org = makeOrganization({
          slug: 'eo-mayor-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockVoterFileFilterService.findByIdAndOrganizationSlug.mockResolvedValue(
          partySegment,
        )
        const res = {
          raw: {
            headersSent: false,
            flushHeaders: vi.fn(),
            setHeader: vi.fn(),
            on: vi.fn(),
          },
        } as never

        await expect(
          service.downloadContacts({ segment: '7' }, res, org),
        ).rejects.toThrow(BadRequestException)
        expect(mockVoterDownloadService.streamPeopleCsv).not.toHaveBeenCalled()
      })

      // ENG-10830: Serve downloads must omit party, turnout propensity, and
      // vote history columns entirely (not ship them blank).
      it('excludes party, turnout propensity, and vote history columns from a Serve (eo-) org CSV download', async () => {
        const org = makeOrganization({
          slug: 'eo-mayor-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        const res = {
          raw: {
            headersSent: false,
            flushHeaders: vi.fn(),
            setHeader: vi.fn(),
            on: vi.fn(),
          },
        } as never

        await service.downloadContacts({ segment: 'all' }, res, org)

        expect(mockVoterDownloadService.streamPeopleCsv).toHaveBeenCalledWith(
          expect.objectContaining({
            excludeColumns: [
              'Parties_Description',
              'Residence_HHParties_Description',
              'VoterParties_Change_Changed_Party',
              'VotingPerformanceEvenYearGeneral',
              'VotingPerformanceEvenYearPrimary',
              'VotingPerformanceEvenYearGeneralAndPrimary',
              'General_2026',
              'General_2024',
              'General_2022',
              'General_2020',
              'Primary_2026',
              'Primary_2024',
              'Primary_2022',
              'Primary_2020',
            ],
          }),
          res,
          expect.any(Object),
        )
      })

      it('does not exclude any column from a Win org CSV download', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        const res = {
          raw: {
            headersSent: false,
            flushHeaders: vi.fn(),
            setHeader: vi.fn(),
            on: vi.fn(),
          },
        } as never

        await service.downloadContacts({ segment: 'all' }, res, org)

        expect(mockVoterDownloadService.streamPeopleCsv).toHaveBeenCalledWith(
          expect.objectContaining({ excludeColumns: undefined }),
          res,
          expect.any(Object),
        )
      })
    })

    describe('findPerson — party strip + supportStatus wiring (ENG-10696)', () => {
      it('strips politicalParty for a Serve (eo-) org', async () => {
        const org = makeOrganization({
          slug: 'eo-mayor-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockVoterQueryService.findPerson.mockResolvedValue({
          id: 'p1',
          politicalParty: 'Republican',
        })

        const result = await service.findPerson('p1', org)

        expect(result).not.toHaveProperty('politicalParty')
      })

      it('keeps politicalParty for a Win org', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockVoterQueryService.findPerson.mockResolvedValue({
          id: 'p1',
          politicalParty: 'Republican',
        })

        const result = await service.findPerson('p1', org)

        expect(result.politicalParty).toBe('Republican')
      })

      it('attaches the supportStatus rollup returned by SupportStatusService', async () => {
        const org = makeOrganization({
          slug: 'eo-mayor-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockVoterQueryService.findPerson.mockResolvedValue({ id: 'p1' })
        mockSupportStatusService.statusForPeople.mockResolvedValue(
          new Map([['p1', 'supporter']]),
        )

        const result = await service.findPerson('p1', org)

        expect(mockSupportStatusService.statusForPeople).toHaveBeenCalledWith(
          'eo-mayor-1',
          ['p1'],
        )
        expect(result.supportStatus).toBe('supporter')
      })

      it('attaches optedOutAt as the ISO string of the latest opt-out', async () => {
        const org = makeOrganization({
          slug: 'eo-mayor-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockVoterQueryService.findPerson.mockResolvedValue({ id: 'p1' })
        mockContactInteractionTextService.latestOptOutAt.mockResolvedValue(
          new Date('2026-07-01T12:00:00Z'),
        )

        const result = await service.findPerson('p1', org)

        expect(
          mockContactInteractionTextService.latestOptOutAt,
        ).toHaveBeenCalledWith('eo-mayor-1', 'p1')
        expect(result.optedOutAt).toBe('2026-07-01T12:00:00.000Z')
      })

      it('attaches optedOutAt as null when the person never opted out', async () => {
        const org = makeOrganization({
          slug: 'eo-mayor-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockVoterQueryService.findPerson.mockResolvedValue({ id: 'p1' })
        mockContactInteractionTextService.latestOptOutAt.mockResolvedValue(null)

        const result = await service.findPerson('p1', org)

        expect(result.optedOutAt).toBeNull()
      })

      it('defaults to unknown when SupportStatusService has no entry for the person', async () => {
        const org = makeOrganization({
          slug: 'eo-mayor-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockVoterQueryService.findPerson.mockResolvedValue({ id: 'p1' })
        mockSupportStatusService.statusForPeople.mockResolvedValue(new Map())

        const result = await service.findPerson('p1', org)

        expect(result.supportStatus).toBe('unknown')
      })
    })

    // A list saved from a search result set persists its search term and must
    // re-apply it when selected, so the saved view reproduces the searched-down
    // set (ENG-10518). A live search the request carries always takes priority.
    describe('saved-list stored search (ENG-10518)', () => {
      const searchSegment = {
        id: 31,
        name: 'Smith voters',
        search: 'smith',
      } as VoterFileFilter

      it('re-applies a saved list search to the people-db query when the request has no search', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockVoterFileFilterService.findByIdAndOrganizationSlug.mockResolvedValue(
          searchSegment,
        )

        await service.findContacts(
          { resultsPerPage: 10, page: 1, search: undefined, segment: '31' },
          org,
        )

        expect(mockVoterQueryService.findPeople).toHaveBeenCalledWith(
          expect.objectContaining({ search: 'smith' }),
        )
      })

      it('lets a live request search override the saved list search', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockVoterFileFilterService.findByIdAndOrganizationSlug.mockResolvedValue(
          searchSegment,
        )

        await service.findContacts(
          { resultsPerPage: 10, page: 1, search: 'jones', segment: '31' },
          org,
        )

        expect(mockVoterQueryService.findPeople).toHaveBeenCalledWith(
          expect.objectContaining({ search: 'jones' }),
        )
      })

      it('does not invent a search for a built-in segment with no stored search', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())

        await service.findContacts(
          {
            resultsPerPage: 10,
            page: 1,
            search: undefined,
            segment: 'texting',
          },
          org,
        )

        expect(mockVoterQueryService.findPeople).toHaveBeenCalledWith(
          expect.objectContaining({ search: undefined }),
        )
      })
    })

    // Win channel downloads/counts on the people-db query engine (ENG-10424).
    // Each built-in channel maps to a boolean filter set; the list/count path
    // and the download path must forward the SAME filters so the count Win
    // sees matches the downloaded row count (both run the same
    // buildVoterWhereSql).
    describe('Win channel -> people-db filter mapping', () => {
      const channelFilters: Array<{
        segment: string
        filters: Record<string, true>
        groupByHousehold: boolean
      }> = [
        { segment: 'all', filters: {}, groupByHousehold: false },
        // Door knocking de-dupes by physical household (ENG-10522); no other
        // channel does.
        { segment: 'doorKnocking', filters: {}, groupByHousehold: true },
        { segment: 'directMail', filters: {}, groupByHousehold: false },
        {
          segment: 'texting',
          filters: { hasCellPhone: true },
          groupByHousehold: false,
        },
        {
          segment: 'digitalAds',
          filters: { hasCellPhone: true },
          groupByHousehold: false,
        },
        {
          segment: 'phoneBanking',
          filters: { hasLandline: true },
          groupByHousehold: false,
        },
      ]

      const makeDownloadReply = () => ({
        raw: {
          headersSent: false,
          flushHeaders: vi.fn(),
          setHeader: vi.fn(),
          on: vi.fn(),
        },
      })

      it.each(channelFilters)(
        'forwards the $segment channel filters + grouping to the people-db list/count query',
        async ({ segment, filters, groupByHousehold }) => {
          const org = makeOrganization({
            slug: 'campaign-1',
            overrideDistrictId: OVERRIDE_DISTRICT_ID,
          })
          mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
          const createSpy = vi.spyOn(ListPeopleDTO, 'create')

          await service.findContacts(
            { resultsPerPage: 10, page: 1, search: undefined, segment },
            org,
          )

          expect(createSpy).toHaveBeenCalledWith(
            expect.objectContaining({
              districtId: OVERRIDE_DISTRICT_ID,
              filters,
              groupByHousehold,
            }),
          )
        },
      )

      it.each(channelFilters)(
        'streams the $segment channel download with the same filters + grouping',
        async ({ segment, filters, groupByHousehold }) => {
          const org = makeOrganization({
            slug: 'eo-office-1',
            overrideDistrictId: OVERRIDE_DISTRICT_ID,
          })
          const res = makeDownloadReply()
          const createSpy = vi.spyOn(DownloadPeopleDTO, 'create')

          await service.downloadContacts({ segment }, res as never, org)

          expect(createSpy).toHaveBeenCalledWith(
            expect.objectContaining({
              districtId: OVERRIDE_DISTRICT_ID,
              filters,
              groupByHousehold,
            }),
          )
          expect(mockVoterDownloadService.streamPeopleCsv).toHaveBeenCalledWith(
            expect.objectContaining({ groupByHousehold }),
            res,
            expect.objectContaining({ filename: 'contacts.csv' }),
          )
        },
      )

      it('door knocking reports fewer contacts than all by grouping households', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())

        // Stand in for people-db: households < voters for the same district.
        // The total it returns depends on whether grouping was requested, so
        // a wiring regression that drops the flag would make the two counts
        // equal and fail this test (real numbers, not a "called" assertion).
        const VOTER_COUNT = 500
        const HOUSEHOLD_COUNT = 180
        mockVoterQueryService.findPeople.mockImplementation(
          (dto: { groupByHousehold?: boolean }) =>
            Promise.resolve({
              people: [],
              pagination: {
                totalResults: dto.groupByHousehold
                  ? HOUSEHOLD_COUNT
                  : VOTER_COUNT,
              },
            }),
        )

        const all = await service.findContacts(
          { resultsPerPage: 10, page: 1, search: undefined, segment: 'all' },
          org,
        )
        const doorKnocking = await service.findContacts(
          {
            resultsPerPage: 10,
            page: 1,
            search: undefined,
            segment: 'doorKnocking',
          },
          org,
        )

        expect(all.pagination.totalResults).toBe(VOTER_COUNT)
        expect(doorKnocking.pagination.totalResults).toBe(HOUSEHOLD_COUNT)
        expect(doorKnocking.pagination.totalResults).toBeLessThan(
          all.pagination.totalResults,
        )
      })

      it('surfaces the people-db total as the channel count', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockVoterQueryService.findPeople.mockResolvedValue({
          people: [],
          pagination: { totalResults: 1234 },
        })

        const result = await service.findContacts(
          {
            resultsPerPage: 10,
            page: 1,
            search: undefined,
            segment: 'texting',
          },
          org,
        )

        expect(result.pagination.totalResults).toBe(1234)
        expect(Number.isInteger(result.pagination.totalResults)).toBe(true)
      })

      it('sends identical filters on the count and download paths for a channel', async () => {
        const org = makeOrganization({
          slug: 'eo-office-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        const listCreateSpy = vi.spyOn(ListPeopleDTO, 'create')
        await service.findContacts(
          {
            resultsPerPage: 10,
            page: 1,
            search: undefined,
            segment: 'texting',
          },
          org,
        )
        const listFilters = filtersOf(listCreateSpy.mock.calls[0]?.[0])

        const downloadCreateSpy = vi.spyOn(DownloadPeopleDTO, 'create')
        await service.downloadContacts(
          { segment: 'texting' },
          makeDownloadReply() as never,
          org,
        )
        const downloadFilters = filtersOf(downloadCreateSpy.mock.calls[0]?.[0])

        expect(listFilters).toEqual({ hasCellPhone: true })
        expect(downloadFilters).toEqual(listFilters)
      })
    })

    describe('countContacts (live segment builder count, ENG-10517)', () => {
      it('throws when the organization is not pro', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue({ isPro: false })

        await expect(
          service.countContacts({ partyDemocrat: true }, org),
        ).rejects.toThrow(BadRequestException)
        expect(mockVoterQueryService.findPeople).not.toHaveBeenCalled()
      })

      it('returns the people-db total for the in-progress filter set', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockVoterQueryService.findPeople.mockResolvedValue({
          people: [],
          pagination: { totalResults: 1234 },
        })
        const createSpy = vi.spyOn(ListPeopleDTO, 'create')

        const result = await service.countContacts({ partyDemocrat: true }, org)

        expect(result).toEqual({ count: 1234 })
        // The translated filter set reaches the people-db query, and only
        // one row is requested so no real voter rows are loaded just to read
        // the total.
        expect(createSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            districtId: OVERRIDE_DISTRICT_ID,
            resultsPerPage: 1,
            filters: { politicalParty: { eq: 'Democratic' } },
          }),
        )
      })

      it('surfaces VOTER_DATA_UNAVAILABLE when the district cannot resolve', async () => {
        const org = makeOrganization({ slug: 'campaign-1' })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())

        await expect(
          service.countContacts({ partyDemocrat: true }, org),
        ).rejects.toMatchObject({
          response: { errorCode: VOTER_DATA_UNAVAILABLE_ERROR_CODE },
        })
        expect(mockVoterQueryService.findPeople).not.toHaveBeenCalled()
      })
    })

    describe('findContactsForFilter (Peerly phone-list capture, ENG-10728)', () => {
      it('throws when the organization is not pro', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue({ isPro: false })

        await expect(
          service.findContactsForFilter(
            { partyDemocrat: true },
            { resultsPerPage: 1000, page: 1 },
            org,
          ),
        ).rejects.toThrow(BadRequestException)
        expect(mockVoterQueryService.findPeople).not.toHaveBeenCalled()
      })

      it('pages through the people-db query with the requested resultsPerPage/page', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockVoterQueryService.findPeople.mockResolvedValue({
          people: [{ id: PERSON_ID_1, cellPhone: '5551234567' }],
          pagination: { totalResults: 1, hasNextPage: false },
        })
        const createSpy = vi.spyOn(ListPeopleDTO, 'create')

        const result = await service.findContactsForFilter(
          { partyDemocrat: true },
          { resultsPerPage: 1000, page: 2 },
          org,
        )

        expect(result.people).toHaveLength(1)
        expect(createSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            districtId: OVERRIDE_DISTRICT_ID,
            resultsPerPage: 1000,
            page: 2,
            filters: { politicalParty: { eq: 'Democratic' } },
          }),
        )
      })

      it('short-circuits to an empty page without calling people-db when the activity-condition resolution is empty', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockActivityConditionResolutionService.resolveIdFilter.mockResolvedValue(
          { kind: 'empty' },
        )

        const result = await service.findContactsForFilter(
          {
            activityConditions: [
              {
                outreachType: 'text',
                outreachId: null,
                actions: ['responded'],
              },
            ],
          },
          { resultsPerPage: 1000, page: 1 },
          org,
        )

        expect(result.people).toEqual([])
        expect(mockVoterQueryService.findPeople).not.toHaveBeenCalled()
      })

      it('merges a resolved id filter into the outgoing people-db filters', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockActivityConditionResolutionService.resolveIdFilter.mockResolvedValue(
          { kind: 'filter', idFilter: { in: [PERSON_ID_1, PERSON_ID_2] } },
        )
        const createSpy = vi.spyOn(ListPeopleDTO, 'create')

        await service.findContactsForFilter(
          { supportStatus: ['supporter'] },
          { resultsPerPage: 1000, page: 1 },
          org,
        )

        expect(createSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            filters: { id: { in: [PERSON_ID_1, PERSON_ID_2] } },
          }),
        )
      })

      it('rejects a party filter for an elected-office organization', async () => {
        const org = makeOrganization({
          slug: 'eo-office-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })

        await expect(
          service.findContactsForFilter(
            { partyDemocrat: true },
            { resultsPerPage: 1000, page: 1 },
            org,
          ),
        ).rejects.toThrow(BadRequestException)
        expect(mockVoterQueryService.findPeople).not.toHaveBeenCalled()
      })
    })

    describe('getListDetail (list-detail demographics/reachability, ENG-10706)', () => {
      const savedFilter = {
        id: 42,
        activityConditions: [],
        supportStatus: [],
      } as unknown as VoterFileFilter

      const aggregatesResponse = (
        count: number,
        avgAge: number | null = null,
        avgIncome: number | null = null,
      ) => ({
        count,
        avgAge,
        avgIncome,
      })

      it('throws when the organization is not pro, before looking up the list', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue({ isPro: false })

        await expect(
          service.getListDetail({ segment: 42 }, org),
        ).rejects.toThrow(BadRequestException)
        expect(
          mockVoterFileFilterService.findByIdAndOrganizationSlug,
        ).not.toHaveBeenCalled()
        expect(mockVoterQueryService.getAggregates).not.toHaveBeenCalled()
      })

      it('404s when the list does not belong to this org (or does not exist)', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockVoterFileFilterService.findByIdAndOrganizationSlug.mockResolvedValue(
          null,
        )

        await expect(
          service.getListDetail({ segment: 999 }, org),
        ).rejects.toThrow(NotFoundException)
        expect(
          mockVoterFileFilterService.findByIdAndOrganizationSlug,
        ).toHaveBeenCalledWith(999, 'campaign-1')
        expect(mockVoterQueryService.getAggregates).not.toHaveBeenCalled()
      })

      it('returns zero demographics/reachability without calling people-db when the resolution is empty', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockVoterFileFilterService.findByIdAndOrganizationSlug.mockResolvedValue(
          savedFilter,
        )
        mockActivityConditionResolutionService.resolveIdFilter.mockResolvedValue(
          { kind: 'empty' },
        )
        mockVoterFileFilterService.findOutreachesByVoterFileFilterId.mockResolvedValue(
          [
            {
              id: 1,
              name: 'Text blast',
              outreachType: 'text',
              status: null,
              date: null,
              createdAt: new Date('2026-01-15T10:00:00.000Z'),
            },
          ],
        )

        const result = await service.getListDetail({ segment: 42 }, org)

        expect(mockVoterQueryService.getAggregates).not.toHaveBeenCalled()
        expect(result.demographics).toEqual({
          people: 0,
          avgAge: null,
          avgIncome: null,
        })
        expect(result.reachability).toEqual({
          sms: 0,
          robocall: 0,
          phoneBanking: 0,
          doorKnocking: 0,
          polls: 0,
        })
        // Outreach history is independent of person-membership — it still
        // comes back even when the resolved id set is empty.
        expect(result.outreachHistory).toEqual([
          {
            id: 1,
            name: 'Text blast',
            outreachType: 'text',
            status: null,
            date: null,
            createdAt: new Date('2026-01-15T10:00:00.000Z'),
          },
        ])
      })

      it('runs base/cellphone/landline/address aggregate calls in parallel and maps reachability channels', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockVoterFileFilterService.findByIdAndOrganizationSlug.mockResolvedValue(
          savedFilter,
        )
        mockActivityConditionResolutionService.resolveIdFilter.mockResolvedValue(
          { kind: 'none' },
        )
        mockVoterQueryService.getAggregates
          .mockResolvedValueOnce(aggregatesResponse(100, 42, 55000))
          .mockResolvedValueOnce(aggregatesResponse(60))
          // Distinct from the cellphone count so a phoneBanking/sms mix-up
          // (both reading the same mocked value) would fail this assertion.
          .mockResolvedValueOnce(aggregatesResponse(45))
          .mockResolvedValueOnce(aggregatesResponse(30))
        const createSpy = vi.spyOn(AggregatesDTO, 'create')

        const result = await service.getListDetail({ segment: 42 }, org)

        expect(result.demographics).toEqual({
          people: 100,
          avgAge: 42,
          avgIncome: 55000,
        })
        expect(result.reachability).toEqual({
          sms: 60,
          // Robocall/telemarketing reach landlines, not cell phones — same
          // aggregate phoneBanking uses, distinct from the cellphone/sms
          // count (ENG-10798).
          robocall: 45,
          // phoneBanking mirrors segmentsToFiltersMap.const.ts: landline-only,
          // not the cellphone count sms/robocall use.
          phoneBanking: 45,
          doorKnocking: 30,
          // Polls are delivered by text, so they mirror the sms count.
          polls: 60,
        })

        expect(mockVoterQueryService.getAggregates).toHaveBeenCalledTimes(4)
        const filtersByCall = createSpy.mock.calls.map((call) =>
          filtersOf(call[0]),
        )
        expect(filtersByCall[0]).toEqual({})
        expect(filtersByCall[1]).toEqual({ hasCellPhone: true })
        expect(filtersByCall[2]).toEqual({ hasLandline: true })
        expect(filtersByCall[3]).toEqual({ hasAddress: true })
      })

      it('merges a resolved activity-condition id filter into every outgoing aggregate call', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockVoterFileFilterService.findByIdAndOrganizationSlug.mockResolvedValue(
          savedFilter,
        )
        mockActivityConditionResolutionService.resolveIdFilter.mockResolvedValue(
          { kind: 'filter', idFilter: { in: [PERSON_ID_1, PERSON_ID_2] } },
        )
        mockVoterQueryService.getAggregates.mockResolvedValue(
          aggregatesResponse(2),
        )
        const createSpy = vi.spyOn(AggregatesDTO, 'create')

        await service.getListDetail({ segment: 42 }, org)

        const filtersByCall = createSpy.mock.calls.map((call) =>
          filtersOf(call[0]),
        )
        for (const filters of filtersByCall) {
          expect(filters).toMatchObject({
            id: { in: [PERSON_ID_1, PERSON_ID_2] },
          })
        }
      })

      it('rejects a party-filtered list for an elected-office organization', async () => {
        const org = makeOrganization({ slug: 'eo-mayor' })
        mockVoterFileFilterService.findByIdAndOrganizationSlug.mockResolvedValue(
          { ...savedFilter, partyDemocrat: true },
        )

        await expect(
          service.getListDetail({ segment: 42 }, org),
        ).rejects.toThrow(BadRequestException)
        expect(mockVoterQueryService.getAggregates).not.toHaveBeenCalled()
      })

      // ENG-10778: the universe row's detail (no segment param) — same
      // aggregates shape as a saved list, over the whole unfiltered district.
      describe('universe mode (no segment)', () => {
        it('throws when the organization is not pro, without looking up any list', async () => {
          const org = makeOrganization({
            slug: 'campaign-1',
            overrideDistrictId: OVERRIDE_DISTRICT_ID,
          })
          mockCampaignsService.findFirst.mockResolvedValue({ isPro: false })

          await expect(service.getListDetail({}, org)).rejects.toThrow(
            BadRequestException,
          )
          expect(
            mockVoterFileFilterService.findByIdAndOrganizationSlug,
          ).not.toHaveBeenCalled()
          expect(mockVoterQueryService.getAggregates).not.toHaveBeenCalled()
        })

        it('runs the aggregate calls over empty (unfiltered) filters and returns an empty outreach history', async () => {
          const org = makeOrganization({
            slug: 'campaign-1',
            overrideDistrictId: OVERRIDE_DISTRICT_ID,
          })
          mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
          mockVoterQueryService.getAggregates
            .mockResolvedValueOnce(aggregatesResponse(85696, 47, 61000))
            .mockResolvedValueOnce(aggregatesResponse(60000))
            .mockResolvedValueOnce(aggregatesResponse(45000))
            .mockResolvedValueOnce(aggregatesResponse(30000))
          const createSpy = vi.spyOn(AggregatesDTO, 'create')

          const result = await service.getListDetail({}, org)

          expect(
            mockVoterFileFilterService.findByIdAndOrganizationSlug,
          ).not.toHaveBeenCalled()
          // No filter row backs this mode, so there's no id to look
          // outreach history up by.
          expect(
            mockVoterFileFilterService.findOutreachesByVoterFileFilterId,
          ).not.toHaveBeenCalled()
          expect(result.demographics).toEqual({
            people: 85696,
            avgAge: 47,
            avgIncome: 61000,
          })
          expect(result.reachability).toEqual({
            sms: 60000,
            // Robocall/telemarketing reach landlines, not cell phones
            // (ENG-10798).
            robocall: 45000,
            phoneBanking: 45000,
            doorKnocking: 30000,
            polls: 60000,
          })
          expect(result.outreachHistory).toEqual([])

          const filtersByCall = createSpy.mock.calls.map((call) =>
            filtersOf(call[0]),
          )
          expect(filtersByCall[0]).toEqual({})
          expect(filtersByCall[1]).toEqual({ hasCellPhone: true })
          expect(filtersByCall[2]).toEqual({ hasLandline: true })
          expect(filtersByCall[3]).toEqual({ hasAddress: true })
        })
      })
    })

    // Wiring-level coverage (mocked resolution service) — the resolution
    // engine's own set-composition math is covered end-to-end in
    // activityConditionResolution.service.test.ts. This block only asserts
    // that findContacts/countContacts/downloadContacts honor whatever the
    // resolution service returns.
    describe('activity-condition/support-status resolution wiring (ENG-10704)', () => {
      const customSegment = { id: 42, name: 'Custom list' } as VoterFileFilter

      it('findContacts short-circuits to an empty page without calling people-db', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockVoterFileFilterService.findByIdAndOrganizationSlug.mockResolvedValue(
          customSegment,
        )
        mockActivityConditionResolutionService.resolveIdFilter.mockResolvedValue(
          { kind: 'empty' },
        )

        const result = await service.findContacts(
          { resultsPerPage: 10, page: 1, search: undefined, segment: '42' },
          org,
        )

        expect(mockVoterQueryService.findPeople).not.toHaveBeenCalled()
        expect(result.people).toEqual([])
        expect(result.pagination).toEqual({
          totalResults: 0,
          currentPage: 1,
          pageSize: 10,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        })
      })

      it('findContacts merges a resolved id filter into the people-db request', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockVoterFileFilterService.findByIdAndOrganizationSlug.mockResolvedValue(
          customSegment,
        )
        mockActivityConditionResolutionService.resolveIdFilter.mockResolvedValue(
          { kind: 'filter', idFilter: { in: [PERSON_ID_1, PERSON_ID_2] } },
        )
        const createSpy = vi.spyOn(ListPeopleDTO, 'create')

        await service.findContacts(
          { resultsPerPage: 10, page: 1, search: undefined, segment: '42' },
          org,
        )

        expect(createSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            filters: expect.objectContaining({
              id: { in: [PERSON_ID_1, PERSON_ID_2] },
            }),
          }),
        )
      })

      it('countContacts returns 0 without calling people-db when the resolution is empty', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockActivityConditionResolutionService.resolveIdFilter.mockResolvedValue(
          { kind: 'empty' },
        )

        const result = await service.countContacts(
          {
            activityConditions: [
              {
                outreachType: 'text',
                outreachId: null,
                actions: ['responded'],
              },
            ],
          },
          org,
        )

        expect(result).toEqual({ count: 0 })
        expect(mockVoterQueryService.findPeople).not.toHaveBeenCalled()
      })

      it('countContacts merges a resolved id filter into the outgoing filters', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockActivityConditionResolutionService.resolveIdFilter.mockResolvedValue(
          { kind: 'filter', idFilter: { notIn: [PERSON_ID_3] } },
        )
        mockVoterQueryService.findPeople.mockResolvedValue({
          people: [],
          pagination: { totalResults: 7 },
        })
        const createSpy = vi.spyOn(ListPeopleDTO, 'create')

        const result = await service.countContacts(
          { supportStatus: ['unknown'] },
          org,
        )

        expect(result).toEqual({ count: 7 })
        expect(createSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            filters: { id: { notIn: [PERSON_ID_3] } },
          }),
        )
      })

      it('downloadContacts writes an empty CSV response without calling people-db when the resolution is empty', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockVoterFileFilterService.findByIdAndOrganizationSlug.mockResolvedValue(
          customSegment,
        )
        mockActivityConditionResolutionService.resolveIdFilter.mockResolvedValue(
          { kind: 'empty' },
        )
        const setHeader = vi.fn()
        const flushHeaders = vi.fn()
        const end = vi.fn()
        const res = {
          raw: {
            headersSent: false,
            setHeader,
            flushHeaders,
            end,
            on: vi.fn(),
          },
        } as never

        await service.downloadContacts({ segment: '42' }, res, org)

        expect(mockVoterDownloadService.streamPeopleCsv).not.toHaveBeenCalled()
        expect(setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv')
        expect(setHeader).toHaveBeenCalledWith(
          'Content-Disposition',
          'attachment; filename="contacts.csv"',
        )
        expect(flushHeaders).toHaveBeenCalledTimes(1)
        expect(end).toHaveBeenCalledTimes(1)
      })
    })

    describe('Win district routing', () => {
      const currentCongressional = {
        id: POSITION_DISTRICT_ID,
        state: 'OH',
        L2DistrictType: 'US_Congressional_District',
        L2DistrictName: '4',
      }

      const proposedCongressional = {
        id: PROPOSED_DISTRICT_ID,
        state: 'OH',
        L2DistrictType: 'Proposed_District',
        L2DistrictName: '2026 PROPOSED CONG DIST 04 (EST.)',
      }

      it('returns the override district id without routing', async () => {
        const org = makeOrganization({
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
          positionId: POSITION_ID_FIXTURE,
        })

        const result = await service.resolveEligibleDistrictId(org)

        expect(result).toBe(OVERRIDE_DISTRICT_ID)
        expect(mockRouteWinDistrict).not.toHaveBeenCalled()
        expect(mockElectionsService.getPositionById).not.toHaveBeenCalled()
      })

      it('routes the position district for a Win org', async () => {
        mockElectionsService.getPositionById.mockResolvedValue({
          id: POSITION_ID_FIXTURE,
          district: currentCongressional,
        })
        mockRouteWinDistrict.mockResolvedValue(proposedCongressional)

        const org = makeOrganization({ positionId: POSITION_ID_FIXTURE })

        expect(await service.resolveEligibleDistrictId(org)).toBe(
          PROPOSED_DISTRICT_ID,
        )
        expect(mockRouteWinDistrict).toHaveBeenCalledWith(
          org.slug,
          currentCongressional,
        )
      })

      it('keeps the current district when routing declines to swap', async () => {
        mockElectionsService.getPositionById.mockResolvedValue({
          id: POSITION_ID_FIXTURE,
          district: currentCongressional,
        })
        mockRouteWinDistrict.mockResolvedValue(currentCongressional)

        const org = makeOrganization({ positionId: POSITION_ID_FIXTURE })

        expect(await service.resolveEligibleDistrictId(org)).toBe(
          POSITION_DISTRICT_ID,
        )
      })
    })
  })
})
