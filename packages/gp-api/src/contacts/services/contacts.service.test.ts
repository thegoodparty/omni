import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { VoterFileDownloadAccessService } from '@/shared/services/voterFileDownloadAccess.service'
import { BallotReadyPositionLevel } from '@goodparty_org/contracts'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { Campaign, Organization, VoterFileFilter } from '../../generated/prisma'
import { of } from 'rxjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactsService } from './contacts.service'
import { VOTER_DATA_UNAVAILABLE_ERROR_CODE } from '../contacts.types'

vi.mock('@nestjs/axios', () => ({
  HttpService: vi.fn(),
}))

const PRO_FEATURE_MSG =
  'Search and segments are only available for pro campaigns'
const OVERRIDE_DISTRICT_ID = 'override-district-uuid'
const POSITION_ID_FIXTURE = 'position-uuid'
const PEOPLE_V1_PATH = '/v1/people'

// A district that carries L2 location data, so the real download-access rule
// (VoterFileDownloadAccessService.canDownload) treats the campaign as eligible.
const ELIGIBLE_DISTRICT = {
  id: 'eligible-district-uuid',
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

describe('ContactsService', () => {
  describe('findContacts and downloadContacts', () => {
    let service: ContactsService
    let mockHttpService: {
      post: ReturnType<typeof vi.fn>
      get: ReturnType<typeof vi.fn>
    }
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
    let mockContactInteractionTextService: {
      latestOptOutAt: ReturnType<typeof vi.fn>
    }
    let mockActivityConditionResolutionService: {
      resolveIdFilter: ReturnType<typeof vi.fn>
    }

    beforeEach(() => {
      mockHttpService = {
        post: vi
          .fn()
          .mockReturnValue(of({ data: { people: [], pagination: {} } })),
        get: vi.fn(),
      }
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
      mockContactInteractionTextService = {
        latestOptOutAt: vi.fn().mockResolvedValue(null),
      }
      mockActivityConditionResolutionService = {
        resolveIdFilter: vi.fn().mockResolvedValue({ kind: 'none' }),
      }

      service = new ContactsService(
        mockHttpService as never,
        mockVoterFileFilterService as never,
        mockElectionsService as never,
        mockCampaignsService as never,
        mockOrganizationsService as never,
        voterFileDownloadAccess,
        mockSupportStatusService as never,
        mockContactInteractionTextService as never,
        mockActivityConditionResolutionService as never,
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
        mockHttpService.get.mockReturnValue(
          of({
            data: {
              districtId: OVERRIDE_DISTRICT_ID,
              totalConstituents: 1234,
              buckets: {},
            },
          }),
        )

        const result = await service.findContacts(
          { resultsPerPage: 10, page: 1, segment: 'all' },
          org,
        )

        // No real voter PII: the people-rows POST is never made. Only the
        // aggregate stats GET runs, to keep the real total truthful so the
        // unblurred stat card doesn't regress (ENG-10508).
        expect(mockHttpService.post).not.toHaveBeenCalled()
        expect(result.people).toHaveLength(10)
        expect(result.pagination.totalResults).toBe(1234)
      })

      it('allows search when organization is an elected office (eo- slug)', async () => {
        const org = makeOrganization({
          slug: 'eo-office-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })

        mockHttpService.post.mockReturnValue(
          of({ data: { people: [], pagination: {} } }),
        )

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

        mockHttpService.post.mockReturnValue(
          of({ data: { people: [], pagination: {} } }),
        )

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
        mockHttpService.get.mockReturnValue(
          of({
            data: {
              districtId: OVERRIDE_DISTRICT_ID,
              totalConstituents: 10,
              buckets: {},
            },
          }),
        )

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
      const makeMockStream = () => ({
        destroyed: false,
        pipe: vi.fn(),
        destroy: vi.fn(),
        on: vi.fn((event: string, cb: (err?: Error) => void) => {
          if (event === 'end') setImmediate(() => cb())
        }),
      })

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
      })

      it('throws when the upstream people-api call fails and never touches response headers', async () => {
        const org = makeOrganization({
          slug: 'eo-office-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockHttpService.post.mockImplementationOnce(() => {
          throw new Error('upstream blew up')
        })
        const { res, flushHeaders, setHeader } = makeMockReply()

        await expect(
          service.downloadContacts({ segment: 'all' }, res, org),
        ).rejects.toThrow('Failed to download contacts from people API')

        expect(setHeader).not.toHaveBeenCalled()
        expect(flushHeaders).not.toHaveBeenCalled()
      })

      it('allows download when campaign is pro (isPro) even with a non-EO org', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue({ isPro: true })

        mockHttpService.post.mockReturnValue(of({ data: makeMockStream() }))
        const { res } = makeMockReply()

        await expect(
          service.downloadContacts({ segment: 'all' }, res, org),
        ).resolves.toBeUndefined()
      })

      it('allows download when organization is an elected office', async () => {
        const org = makeOrganization({
          slug: 'eo-office-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockHttpService.post.mockReturnValue(of({ data: makeMockStream() }))
        const { res } = makeMockReply()

        await expect(
          service.downloadContacts({ segment: 'all' }, res, org),
        ).resolves.toBeUndefined()
      })

      it('sets download headers (Content-Type, Content-Disposition, Set-Cookie) and flushes once the upstream stream is ready, then pipes', async () => {
        const org = makeOrganization({
          slug: 'eo-office-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        const mockStream = makeMockStream()
        mockHttpService.post.mockReturnValue(of({ data: mockStream }))
        const { res, flushHeaders, setHeader } = makeMockReply()

        await service.downloadContacts({ segment: 'all' }, res, org)

        expect(setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv')
        expect(setHeader).toHaveBeenCalledWith(
          'Content-Disposition',
          'attachment; filename="contacts.csv"',
        )
        // Cookie must be present, name=gp_download with a UUID value, and
        // include Secure (production hygiene) + SameSite=Lax (the cookie
        // travels on a top-level GET download navigation).
        const cookieCall = setHeader.mock.calls.find(
          (call) => call[0] === 'Set-Cookie',
        )
        expect(cookieCall).toBeDefined()
        const cookieValue = cookieCall?.[1] as string
        expect(cookieValue).toMatch(
          /^gp_download=[0-9a-f-]{36};.*Path=\/.*Max-Age=30.*SameSite=Lax.*Secure/,
        )

        expect(flushHeaders).toHaveBeenCalledTimes(1)
        expect(mockStream.pipe).toHaveBeenCalledTimes(1)
      })

      it('skips flushHeaders when headers were already sent but still pipes the body', async () => {
        const org = makeOrganization({
          slug: 'eo-office-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        const mockStream = makeMockStream()
        mockHttpService.post.mockReturnValue(of({ data: mockStream }))
        const { res, flushHeaders } = makeMockReply(true)

        await service.downloadContacts({ segment: 'all' }, res, org)

        // Negative + positive: an early-return regression that bails on the
        // whole pipe path can no longer pass this test.
        expect(flushHeaders).not.toHaveBeenCalled()
        expect(mockStream.pipe).toHaveBeenCalledTimes(1)
      })

      it('absorbs upstream stream errors after headers are flushed (logs, destroys, does not reject)', async () => {
        const org = makeOrganization({
          slug: 'eo-office-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        // Capture event handlers as they are registered so we can fire
        // 'error' AFTER pipe + flushHeaders have run.
        const handlers: Record<string, ((err?: Error) => void) | undefined> = {}
        const mockStream = {
          destroyed: false,
          pipe: vi.fn(),
          destroy: vi.fn(),
          on: vi.fn((event: string, cb: (err?: Error) => void) => {
            handlers[event] = cb
          }),
        }
        mockHttpService.post.mockReturnValue(of({ data: mockStream }))

        // res.raw needs `destroy` + `destroyed` for the post-headers cleanup
        // path. The service must call `res.raw.destroy(err)` instead of
        // letting the rejection bubble to the Nest exception filter (which
        // would call `httpAdapter.reply` on an already-committed response).
        const flushHeaders = vi.fn()
        const setHeader = vi.fn()
        const on = vi.fn()
        const destroy = vi.fn()
        const res = {
          raw: {
            headersSent: false,
            destroyed: false,
            flushHeaders,
            setHeader,
            on,
            destroy,
          },
        } as never

        const completion = service.downloadContacts(
          { segment: 'all' },
          res,
          org,
        )

        // Wait for the service to register the upstream 'error' listener
        // (segment + district resolution are async).
        await vi.waitFor(() => {
          expect(handlers.error).toBeDefined()
        })

        // Sanity: by the time we're firing 'error', headers MUST already be
        // committed to the wire — otherwise the bug we are guarding against
        // (filter writing JSON over committed headers) doesn't apply.
        expect(flushHeaders).toHaveBeenCalledTimes(1)
        expect(setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv')

        const upstreamError = new Error('people-api connection reset')
        handlers.error!(upstreamError)

        await expect(completion).resolves.toBeUndefined()
        // Both ends torn down, no rejection escapes to Nest's exception filter.
        expect(mockStream.destroy).toHaveBeenCalledTimes(1)
        expect(destroy).toHaveBeenCalledTimes(1)
        expect(destroy).toHaveBeenCalledWith(upstreamError)
      })

      it('destroys the upstream stream when the client closes the connection mid-download', async () => {
        const org = makeOrganization({
          slug: 'eo-office-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        const mockStream = makeMockStream()
        // Override 'end' so the resolver isn't auto-fired; we want the
        // res.raw 'close' handler to drive resolution.
        mockStream.on = vi.fn()
        mockHttpService.post.mockReturnValue(of({ data: mockStream }))
        const { res, on: rawOn } = makeMockReply()

        const completion = service.downloadContacts(
          { segment: 'all' },
          res,
          org,
        )

        // `downloadContacts` resolves the segment + district asynchronously
        // before constructing the streaming Promise, so wait until the
        // service has wired its `'close'` listener on res.raw.
        await vi.waitFor(() => {
          expect(rawOn.mock.calls.some((call) => call[0] === 'close')).toBe(
            true,
          )
        })
        const closeCall = rawOn.mock.calls.find((call) => call[0] === 'close')
        const closeHandler = closeCall?.[1] as () => void
        closeHandler()

        await expect(completion).resolves.toBeUndefined()
        expect(mockStream.destroy).toHaveBeenCalledTimes(1)
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
        mockHttpService.post.mockReturnValue(
          of({ data: { people: [], pagination: { totalResults: 1234 } } }),
        )

        const count = await service.countVoterFilePeople(
          { hasCellPhone: true },
          false,
          org,
        )

        expect(count).toBe(1234)
        expect(mockHttpService.post).toHaveBeenCalledWith(
          expect.stringContaining(PEOPLE_V1_PATH),
          expect.objectContaining({
            districtId: OVERRIDE_DISTRICT_ID,
            resultsPerPage: 1,
            page: 1,
            filters: { hasCellPhone: true },
            groupByHousehold: false,
          }),
          expect.anything(),
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
        mockHttpService.post.mockReturnValue(
          of({ data: { people: [], pagination: { totalResults: 7 } } }),
        )

        await service.countVoterFilePeople({}, true, org)

        expect(mockHttpService.post).toHaveBeenCalledWith(
          expect.stringContaining(PEOPLE_V1_PATH),
          expect.objectContaining({ groupByHousehold: true }),
          expect.anything(),
        )
      })

      it('throws BadGateway when people-api fails', async () => {
        const org = makeOrganization({
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue({
          isPro: true,
          details: {},
        })
        mockHttpService.post.mockImplementation(() => {
          throw new Error('connection refused')
        })

        await expect(
          service.countVoterFilePeople({}, false, org),
        ).rejects.toThrow('Failed to count from people API')
      })
    })

    describe('downloadVoterFilePeople', () => {
      it('streams the people-api CSV for a NON-pro campaign', async () => {
        const org = makeOrganization({
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue({
          isPro: false,
          details: {},
        })
        const mockStream = {
          destroyed: false,
          pipe: vi.fn(),
          destroy: vi.fn(),
          on: vi.fn((event: string, cb: (err?: Error) => void) => {
            if (event === 'end') setImmediate(() => cb())
          }),
        }
        mockHttpService.post.mockReturnValue(of({ data: mockStream }))
        const flushHeaders = vi.fn()
        const setHeader = vi.fn()
        const res = {
          raw: { headersSent: false, flushHeaders, setHeader, on: vi.fn() },
        } as never

        await service.downloadVoterFilePeople(
          { hasLandline: true },
          false,
          org,
          res,
        )

        expect(mockHttpService.post).toHaveBeenCalledWith(
          expect.stringContaining('/v1/people/download'),
          expect.objectContaining({
            districtId: OVERRIDE_DISTRICT_ID,
            filters: { hasLandline: true },
            groupByHousehold: false,
            excludeColumns: undefined,
          }),
          expect.objectContaining({ responseType: 'stream' }),
        )
        expect(setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv')
        expect(mockStream.pipe).toHaveBeenCalledTimes(1)
      })

      it('excludes the party column for an elected-office org', async () => {
        const org = makeOrganization({
          slug: 'eo-office-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        const mockStream = {
          destroyed: false,
          pipe: vi.fn(),
          destroy: vi.fn(),
          on: vi.fn((event: string, cb: (err?: Error) => void) => {
            if (event === 'end') setImmediate(() => cb())
          }),
        }
        mockHttpService.post.mockReturnValue(of({ data: mockStream }))
        const res = {
          raw: {
            headersSent: false,
            flushHeaders: vi.fn(),
            setHeader: vi.fn(),
            on: vi.fn(),
          },
        } as never

        await service.downloadVoterFilePeople({}, false, org, res)

        expect(mockHttpService.post).toHaveBeenCalledWith(
          expect.stringContaining('/v1/people/download'),
          expect.objectContaining({
            excludeColumns: ['Parties_Description'],
          }),
          expect.objectContaining({ responseType: 'stream' }),
        )
      })
    })

    describe('organization-based district resolution', () => {
      it('uses overrideDistrictId when present on organization', async () => {
        const org = makeOrganization({
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
          positionId: POSITION_ID_FIXTURE,
        })
        // Pro: only the real fetch path forwards the districtId to people-api;
        // non-pro short-circuits to the synthetic preview.
        mockCampaignsService.findFirst.mockResolvedValue({ isPro: true })

        mockHttpService.post.mockReturnValue(
          of({ data: { people: [], pagination: {} } }),
        )

        await service.findContacts(
          { resultsPerPage: 10, page: 1, search: undefined, segment: 'all' },
          org,
        )

        expect(mockHttpService.post).toHaveBeenCalledWith(
          expect.stringContaining(PEOPLE_V1_PATH),
          expect.objectContaining({
            districtId: OVERRIDE_DISTRICT_ID,
          }),
          expect.any(Object),
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
            id: 'position-district-uuid',
            L2DistrictType: 'State_Senate',
            L2DistrictName: 'District 1',
          },
        })
        mockHttpService.post.mockReturnValue(
          of({ data: { people: [], pagination: {} } }),
        )

        await service.findContacts(
          { resultsPerPage: 10, page: 1, search: undefined, segment: 'all' },
          org,
        )

        expect(mockElectionsService.getPositionById).toHaveBeenCalledWith(
          POSITION_ID_FIXTURE,
          { includeDistrict: true },
        )
        expect(mockHttpService.post).toHaveBeenCalledWith(
          expect.stringContaining(PEOPLE_V1_PATH),
          expect.objectContaining({
            districtId: 'position-district-uuid',
          }),
          expect.any(Object),
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

        mockHttpService.get.mockReturnValue(
          of({
            data: {
              districtId: OVERRIDE_DISTRICT_ID,
              totalConstituents: 500,
              buckets: {},
            },
          }),
        )

        await service.getDistrictStats(org)

        expect(mockHttpService.get).toHaveBeenCalledWith(
          expect.stringContaining(`${PEOPLE_V1_PATH}/stats`),
          expect.objectContaining({
            params: { districtId: OVERRIDE_DISTRICT_ID },
          }),
        )
      })

      it('uses overrideDistrictId for findPerson', async () => {
        const org = makeOrganization({
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue({ isPro: true })

        mockHttpService.get.mockReturnValue(
          of({
            data: { id: 'person-1', firstName: 'Test' },
          }),
        )

        await service.findPerson('person-1', org)

        expect(mockHttpService.get).toHaveBeenCalledWith(
          expect.stringContaining(`${PEOPLE_V1_PATH}/person-1`),
          expect.objectContaining({
            params: { districtId: OVERRIDE_DISTRICT_ID },
          }),
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
        expect(mockHttpService.get).not.toHaveBeenCalled()
      })

      it('uses overrideDistrictId for downloadContacts', async () => {
        const org = makeOrganization({
          slug: 'eo-office-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })

        const mockStream = {
          destroyed: false,
          pipe: vi.fn(),
          destroy: vi.fn(),
          on: vi.fn((event: string, cb: (err?: Error) => void) => {
            if (event === 'end') setImmediate(() => cb())
          }),
        }
        mockHttpService.post.mockReturnValue(of({ data: mockStream }))
        const res = {
          raw: {
            headersSent: false,
            flushHeaders: vi.fn(),
            setHeader: vi.fn(),
            on: vi.fn(),
          },
        } as never

        await service.downloadContacts({ segment: 'all' }, res, org)

        expect(mockHttpService.post).toHaveBeenCalledWith(
          expect.stringContaining(`${PEOPLE_V1_PATH}/download`),
          expect.objectContaining({
            districtId: OVERRIDE_DISTRICT_ID,
          }),
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
        expect(mockHttpService.post).not.toHaveBeenCalled()
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
        expect(mockHttpService.post).toHaveBeenCalledTimes(1)
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
        mockHttpService.get.mockReturnValue(
          of({
            data: {
              districtId: OVERRIDE_DISTRICT_ID,
              totalConstituents: 42,
              buckets: {},
            },
          }),
        )

        const result = await service.findContacts(
          { resultsPerPage: 10, page: 1, search: undefined, segment: 'all' },
          org,
        )

        // No campaign means no pro entitlement, so the base list must not pull
        // real voter PII from people-api — it serves the synthetic preview.
        expect(mockHttpService.post).not.toHaveBeenCalled()
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

      it('forwards the political-party filter to people-api for Win', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockVoterFileFilterService.findByIdAndOrganizationSlug.mockResolvedValue(
          partySegment,
        )
        mockHttpService.post.mockReturnValue(
          of({ data: { people: [], pagination: {} } }),
        )

        await service.findContacts(
          { resultsPerPage: 10, page: 1, search: undefined, segment: '7' },
          org,
        )

        expect(mockHttpService.post).toHaveBeenCalledWith(
          expect.stringContaining(PEOPLE_V1_PATH),
          expect.objectContaining({
            filters: expect.objectContaining({
              politicalParty: { eq: 'Democratic' },
            }),
          }),
          expect.any(Object),
        )
      })

      it('returns the people-api politicalParty field unchanged for Win', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockHttpService.post.mockReturnValue(
          of({
            data: {
              people: [{ id: 'p1', politicalParty: 'Republican' }],
              pagination: {},
            },
          }),
        )

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
        mockHttpService.post.mockReturnValue(
          of({
            data: {
              people: [{ id: 'p1', politicalParty: 'Democratic' }],
              pagination: {},
            },
          }),
        )

        const result = await service.findContacts(
          { resultsPerPage: 10, page: 1, search: undefined, segment: 'all' },
          org,
        )

        expect(result.people[0]).not.toHaveProperty('politicalParty')
      })

      it('rejects a party-segment list request for a Serve (eo-) org with 400, without calling people-api', async () => {
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
        expect(mockHttpService.post).not.toHaveBeenCalled()
      })

      it('rejects a party-filter count request for a Serve (eo-) org with 400, without calling people-api', async () => {
        const org = makeOrganization({
          slug: 'eo-mayor-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })

        await expect(
          service.countContacts({ partyDemocrat: true }, org),
        ).rejects.toThrow(BadRequestException)
        expect(mockHttpService.post).not.toHaveBeenCalled()
      })

      it('rejects a party-segment download request for a Serve (eo-) org with 400, without calling people-api', async () => {
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
        expect(mockHttpService.post).not.toHaveBeenCalled()
      })

      // ENG-10830: Serve downloads must omit party, turnout propensity, and
      // vote history columns entirely (not ship them blank).
      it('excludes party, turnout propensity, and vote history columns from a Serve (eo-) org CSV download', async () => {
        const org = makeOrganization({
          slug: 'eo-mayor-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        const stream = {
          destroyed: false,
          pipe: vi.fn(),
          destroy: vi.fn(),
          on: vi.fn((event: string, cb: (err?: Error) => void) => {
            if (event === 'end') setImmediate(() => cb())
          }),
        }
        mockHttpService.post.mockReturnValue(of({ data: stream }))
        const res = {
          raw: {
            headersSent: false,
            flushHeaders: vi.fn(),
            setHeader: vi.fn(),
            on: vi.fn(),
          },
        } as never

        await service.downloadContacts({ segment: 'all' }, res, org)

        expect(mockHttpService.post).toHaveBeenCalledWith(
          expect.stringContaining(`${PEOPLE_V1_PATH}/download`),
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
          expect.any(Object),
        )
      })

      it('does not exclude any column from a Win org CSV download', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        const stream = {
          destroyed: false,
          pipe: vi.fn(),
          destroy: vi.fn(),
          on: vi.fn((event: string, cb: (err?: Error) => void) => {
            if (event === 'end') setImmediate(() => cb())
          }),
        }
        mockHttpService.post.mockReturnValue(of({ data: stream }))
        const res = {
          raw: {
            headersSent: false,
            flushHeaders: vi.fn(),
            setHeader: vi.fn(),
            on: vi.fn(),
          },
        } as never

        await service.downloadContacts({ segment: 'all' }, res, org)

        expect(mockHttpService.post).toHaveBeenCalledWith(
          expect.stringContaining(`${PEOPLE_V1_PATH}/download`),
          expect.objectContaining({ excludeColumns: undefined }),
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
        mockHttpService.get.mockReturnValue(
          of({ data: { id: 'p1', politicalParty: 'Republican' } }),
        )

        const result = await service.findPerson('p1', org)

        expect(result).not.toHaveProperty('politicalParty')
      })

      it('keeps politicalParty for a Win org', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockHttpService.get.mockReturnValue(
          of({ data: { id: 'p1', politicalParty: 'Republican' } }),
        )

        const result = await service.findPerson('p1', org)

        expect(result.politicalParty).toBe('Republican')
      })

      it('attaches the supportStatus rollup returned by SupportStatusService', async () => {
        const org = makeOrganization({
          slug: 'eo-mayor-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockHttpService.get.mockReturnValue(of({ data: { id: 'p1' } }))
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
        mockHttpService.get.mockReturnValue(of({ data: { id: 'p1' } }))
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
        mockHttpService.get.mockReturnValue(of({ data: { id: 'p1' } }))
        mockContactInteractionTextService.latestOptOutAt.mockResolvedValue(null)

        const result = await service.findPerson('p1', org)

        expect(result.optedOutAt).toBeNull()
      })

      it('defaults to unknown when SupportStatusService has no entry for the person', async () => {
        const org = makeOrganization({
          slug: 'eo-mayor-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockHttpService.get.mockReturnValue(of({ data: { id: 'p1' } }))
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

      it('re-applies a saved list search to the people-api query when the request has no search', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockVoterFileFilterService.findByIdAndOrganizationSlug.mockResolvedValue(
          searchSegment,
        )
        mockHttpService.post.mockReturnValue(
          of({ data: { people: [], pagination: {} } }),
        )

        await service.findContacts(
          { resultsPerPage: 10, page: 1, search: undefined, segment: '31' },
          org,
        )

        expect(mockHttpService.post).toHaveBeenCalledWith(
          expect.stringContaining(PEOPLE_V1_PATH),
          expect.objectContaining({ search: 'smith' }),
          expect.any(Object),
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
        mockHttpService.post.mockReturnValue(
          of({ data: { people: [], pagination: {} } }),
        )

        await service.findContacts(
          { resultsPerPage: 10, page: 1, search: 'jones', segment: '31' },
          org,
        )

        expect(mockHttpService.post).toHaveBeenCalledWith(
          expect.stringContaining(PEOPLE_V1_PATH),
          expect.objectContaining({ search: 'jones' }),
          expect.any(Object),
        )
      })

      it('does not invent a search for a built-in segment with no stored search', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockHttpService.post.mockReturnValue(
          of({ data: { people: [], pagination: {} } }),
        )

        await service.findContacts(
          {
            resultsPerPage: 10,
            page: 1,
            search: undefined,
            segment: 'texting',
          },
          org,
        )

        const body = mockHttpService.post.mock.calls[0]?.[1] as {
          search?: string
        }
        expect(body.search).toBeUndefined()
      })
    })

    // Win channel downloads/counts on people-api (ENG-10424). Each built-in
    // channel maps to a people-api boolean filter set; the list/count path and
    // the download path must forward the SAME filters so the count Win sees
    // matches the downloaded row count (both run people-api's identical
    // buildVoterWhereSql).
    describe('Win channel -> people-api filter mapping', () => {
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

      const makeDownloadStream = () => ({
        destroyed: false,
        pipe: vi.fn(),
        destroy: vi.fn(),
        on: vi.fn((event: string, cb: (err?: Error) => void) => {
          if (event === 'end') setImmediate(() => cb())
        }),
      })

      const makeDownloadReply = () => ({
        raw: {
          headersSent: false,
          flushHeaders: vi.fn(),
          setHeader: vi.fn(),
          on: vi.fn(),
        },
      })

      it.each(channelFilters)(
        'forwards the $segment channel filters + grouping to the people-api list/count query',
        async ({ segment, filters, groupByHousehold }) => {
          const org = makeOrganization({
            slug: 'campaign-1',
            overrideDistrictId: OVERRIDE_DISTRICT_ID,
          })
          mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
          mockHttpService.post.mockReturnValue(
            of({ data: { people: [], pagination: { totalResults: 0 } } }),
          )

          await service.findContacts(
            { resultsPerPage: 10, page: 1, search: undefined, segment },
            org,
          )

          expect(mockHttpService.post).toHaveBeenCalledWith(
            expect.stringContaining(PEOPLE_V1_PATH),
            expect.objectContaining({
              districtId: OVERRIDE_DISTRICT_ID,
              filters,
              groupByHousehold,
            }),
            expect.any(Object),
          )
        },
      )

      it.each(channelFilters)(
        'streams the $segment channel download with CSV headers and the same filters + grouping',
        async ({ segment, filters, groupByHousehold }) => {
          const org = makeOrganization({
            slug: 'eo-office-1',
            overrideDistrictId: OVERRIDE_DISTRICT_ID,
          })
          const stream = makeDownloadStream()
          mockHttpService.post.mockReturnValue(of({ data: stream }))
          const res = makeDownloadReply()

          await service.downloadContacts({ segment }, res as never, org)

          expect(mockHttpService.post).toHaveBeenCalledWith(
            expect.stringContaining(`${PEOPLE_V1_PATH}/download`),
            expect.objectContaining({
              districtId: OVERRIDE_DISTRICT_ID,
              filters,
              groupByHousehold,
            }),
            expect.objectContaining({ responseType: 'stream' }),
          )
          expect(res.raw.setHeader).toHaveBeenCalledWith(
            'Content-Type',
            'text/csv',
          )
          expect(res.raw.setHeader).toHaveBeenCalledWith(
            'Content-Disposition',
            'attachment; filename="contacts.csv"',
          )
          // No buffering: the upstream pg COPY stream is piped straight to the
          // client response rather than collected into memory.
          expect(stream.pipe).toHaveBeenCalledTimes(1)
        },
      )

      it('door knocking reports fewer contacts than all by grouping households', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())

        // Stand in for people-api: households < voters for the same district.
        // The total it returns depends on whether grouping was requested, so a
        // wiring regression that drops the flag would make the two counts
        // equal and fail this test (real numbers, not a "called" assertion).
        const VOTER_COUNT = 500
        const HOUSEHOLD_COUNT = 180
        mockHttpService.post.mockImplementation(
          (_url: string, body: { groupByHousehold?: boolean }) =>
            of({
              data: {
                people: [],
                pagination: {
                  totalResults: body.groupByHousehold
                    ? HOUSEHOLD_COUNT
                    : VOTER_COUNT,
                },
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

      it('surfaces the people-api total as the channel count', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockHttpService.post.mockReturnValue(
          of({
            data: { people: [], pagination: { totalResults: 1234 } },
          }),
        )

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
        mockHttpService.post.mockReturnValue(
          of({ data: { people: [], pagination: { totalResults: 0 } } }),
        )
        await service.findContacts(
          {
            resultsPerPage: 10,
            page: 1,
            search: undefined,
            segment: 'texting',
          },
          org,
        )
        const listBody = mockHttpService.post.mock.calls.find((call) =>
          String(call[0]).endsWith(PEOPLE_V1_PATH),
        )?.[1] as { filters: Record<string, true> }

        mockHttpService.post.mockReturnValue(of({ data: makeDownloadStream() }))
        await service.downloadContacts(
          { segment: 'texting' },
          makeDownloadReply() as never,
          org,
        )
        const downloadBody = mockHttpService.post.mock.calls.find((call) =>
          String(call[0]).endsWith(`${PEOPLE_V1_PATH}/download`),
        )?.[1] as { filters: Record<string, true> }

        expect(listBody.filters).toEqual({ hasCellPhone: true })
        expect(downloadBody.filters).toEqual(listBody.filters)
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
        expect(mockHttpService.post).not.toHaveBeenCalled()
      })

      it('returns the people-api total for the in-progress filter set', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockHttpService.post.mockReturnValue(
          of({ data: { people: [], pagination: { totalResults: 1234 } } }),
        )

        const result = await service.countContacts({ partyDemocrat: true }, org)

        expect(result).toEqual({ count: 1234, fenced: false })
        // The translated filter set reaches people-api, and only one row is
        // requested so no real voter rows are loaded just to read the total.
        expect(mockHttpService.post).toHaveBeenCalledWith(
          expect.stringContaining(PEOPLE_V1_PATH),
          expect.objectContaining({
            districtId: OVERRIDE_DISTRICT_ID,
            resultsPerPage: 1,
            filters: { politicalParty: { eq: 'Democratic' } },
          }),
          expect.any(Object),
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
        expect(mockHttpService.post).not.toHaveBeenCalled()
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
        expect(mockHttpService.post).not.toHaveBeenCalled()
      })

      it('pages through people-api with the requested resultsPerPage/page', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockHttpService.post.mockReturnValue(
          of({
            data: {
              people: [{ id: 'p-1', cellPhone: '5551234567' }],
              pagination: { totalResults: 1, hasNextPage: false },
            },
          }),
        )

        const result = await service.findContactsForFilter(
          { partyDemocrat: true },
          { resultsPerPage: 1000, page: 2 },
          org,
        )

        expect(result.people).toHaveLength(1)
        expect(mockHttpService.post).toHaveBeenCalledWith(
          expect.stringContaining(PEOPLE_V1_PATH),
          expect.objectContaining({
            districtId: OVERRIDE_DISTRICT_ID,
            resultsPerPage: 1000,
            page: 2,
            filters: { politicalParty: { eq: 'Democratic' } },
          }),
          expect.any(Object),
        )
      })

      it('short-circuits to an empty page without calling people-api when the activity-condition resolution is empty', async () => {
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
        expect(mockHttpService.post).not.toHaveBeenCalled()
      })

      it('merges a resolved id filter into the outgoing people-api filters', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockActivityConditionResolutionService.resolveIdFilter.mockResolvedValue(
          { kind: 'filter', idFilter: { in: ['p-1', 'p-2'] } },
        )
        mockHttpService.post.mockReturnValue(
          of({ data: { people: [], pagination: { totalResults: 0 } } }),
        )

        await service.findContactsForFilter(
          { supportStatus: ['supporter'] },
          { resultsPerPage: 1000, page: 1 },
          org,
        )

        expect(mockHttpService.post).toHaveBeenCalledWith(
          expect.stringContaining(PEOPLE_V1_PATH),
          expect.objectContaining({
            filters: { id: { in: ['p-1', 'p-2'] } },
          }),
          expect.any(Object),
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
        expect(mockHttpService.post).not.toHaveBeenCalled()
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
        fenced?: boolean,
      ) =>
        of({
          data: {
            count,
            avgAge,
            avgIncome,
            ...(fenced !== undefined ? { fenced } : {}),
          },
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
        expect(mockHttpService.post).not.toHaveBeenCalled()
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
        expect(mockHttpService.post).not.toHaveBeenCalled()
      })

      it('returns zero demographics/reachability without calling people-api when the resolution is empty', async () => {
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

        expect(mockHttpService.post).not.toHaveBeenCalled()
        expect(result.demographics).toEqual({
          people: 0,
          avgAge: null,
          avgIncome: null,
          fenced: false,
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
        mockHttpService.post
          .mockReturnValueOnce(aggregatesResponse(100, 42, 55000))
          .mockReturnValueOnce(aggregatesResponse(60))
          // Distinct from the cellphone count so a phoneBanking/sms mix-up
          // (both reading the same mocked value) would fail this assertion.
          .mockReturnValueOnce(aggregatesResponse(45))
          .mockReturnValueOnce(aggregatesResponse(30))

        const result = await service.getListDetail({ segment: 42 }, org)

        expect(result.demographics).toEqual({
          people: 100,
          avgAge: 42,
          avgIncome: 55000,
          fenced: false,
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
          fenced: {
            sms: undefined,
            robocall: undefined,
            phoneBanking: undefined,
            doorKnocking: undefined,
            polls: undefined,
          },
        })

        expect(mockHttpService.post).toHaveBeenCalledTimes(4)
        const bodies = mockHttpService.post.mock.calls.map(
          (call) => call[1] as { filters: Record<string, unknown> },
        )
        expect(bodies[0]?.filters).toEqual({})
        expect(bodies[1]?.filters).toEqual({ hasCellPhone: true })
        expect(bodies[2]?.filters).toEqual({ hasLandline: true })
        expect(bodies[3]?.filters).toEqual({ hasAddress: true })
      })

      it('marks demographics as fenced when the base aggregates call reports fenced: true (ENG-10775)', async () => {
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
        mockHttpService.post
          .mockReturnValueOnce(aggregatesResponse(10000, 41, 48000, true))
          .mockReturnValueOnce(aggregatesResponse(6000))
          .mockReturnValueOnce(aggregatesResponse(4500))
          .mockReturnValueOnce(aggregatesResponse(3000))

        const result = await service.getListDetail({ segment: 42 }, org)

        expect(result.demographics).toEqual({
          people: 10000,
          avgAge: 41,
          avgIncome: 48000,
          fenced: true,
        })
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
          { kind: 'filter', idFilter: { in: ['p-1', 'p-2'] } },
        )
        mockHttpService.post.mockReturnValue(aggregatesResponse(2))

        await service.getListDetail({ segment: 42 }, org)

        const bodies = mockHttpService.post.mock.calls.map(
          (call) => call[1] as { filters: Record<string, unknown> },
        )
        for (const body of bodies) {
          expect(body.filters).toMatchObject({ id: { in: ['p-1', 'p-2'] } })
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
        expect(mockHttpService.post).not.toHaveBeenCalled()
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
          expect(mockHttpService.post).not.toHaveBeenCalled()
        })

        it('runs the aggregate calls over empty (unfiltered) filters and returns an empty outreach history', async () => {
          const org = makeOrganization({
            slug: 'campaign-1',
            overrideDistrictId: OVERRIDE_DISTRICT_ID,
          })
          mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
          mockHttpService.post
            .mockReturnValueOnce(aggregatesResponse(85696, 47, 61000))
            .mockReturnValueOnce(aggregatesResponse(60000))
            .mockReturnValueOnce(aggregatesResponse(45000))
            .mockReturnValueOnce(aggregatesResponse(30000))

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
            fenced: false,
          })
          expect(result.reachability).toEqual({
            sms: 60000,
            // Robocall/telemarketing reach landlines, not cell phones
            // (ENG-10798).
            robocall: 45000,
            phoneBanking: 45000,
            doorKnocking: 30000,
            polls: 60000,
            fenced: {
              sms: undefined,
              robocall: undefined,
              phoneBanking: undefined,
              doorKnocking: undefined,
              polls: undefined,
            },
          })
          expect(result.outreachHistory).toEqual([])

          const bodies = mockHttpService.post.mock.calls.map(
            (call) => call[1] as { filters: Record<string, unknown> },
          )
          expect(bodies[0]?.filters).toEqual({})
          expect(bodies[1]?.filters).toEqual({ hasCellPhone: true })
          expect(bodies[2]?.filters).toEqual({ hasLandline: true })
          expect(bodies[3]?.filters).toEqual({ hasAddress: true })
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

      it('findContacts short-circuits to an empty page without calling people-api', async () => {
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

        expect(mockHttpService.post).not.toHaveBeenCalled()
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

      it('findContacts merges a resolved id filter into the people-api request', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockVoterFileFilterService.findByIdAndOrganizationSlug.mockResolvedValue(
          customSegment,
        )
        mockActivityConditionResolutionService.resolveIdFilter.mockResolvedValue(
          { kind: 'filter', idFilter: { in: ['p-1', 'p-2'] } },
        )
        mockHttpService.post.mockReturnValue(
          of({ data: { people: [], pagination: {} } }),
        )

        await service.findContacts(
          { resultsPerPage: 10, page: 1, search: undefined, segment: '42' },
          org,
        )

        expect(mockHttpService.post).toHaveBeenCalledWith(
          expect.stringContaining(PEOPLE_V1_PATH),
          expect.objectContaining({
            filters: expect.objectContaining({
              id: { in: ['p-1', 'p-2'] },
            }),
          }),
          expect.any(Object),
        )
      })

      it('countContacts returns 0 without calling people-api when the resolution is empty', async () => {
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

        expect(result).toEqual({ count: 0, fenced: false })
        expect(mockHttpService.post).not.toHaveBeenCalled()
      })

      it('countContacts merges a resolved id filter into the outgoing filters', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue(makeCampaign())
        mockActivityConditionResolutionService.resolveIdFilter.mockResolvedValue(
          { kind: 'filter', idFilter: { notIn: ['p-3'] } },
        )
        mockHttpService.post.mockReturnValue(
          of({ data: { people: [], pagination: { totalResults: 7 } } }),
        )

        const result = await service.countContacts(
          { supportStatus: ['unknown'] },
          org,
        )

        expect(result).toEqual({ count: 7, fenced: false })
        expect(mockHttpService.post).toHaveBeenCalledWith(
          expect.stringContaining(PEOPLE_V1_PATH),
          expect.objectContaining({
            filters: { id: { notIn: ['p-3'] } },
          }),
          expect.any(Object),
        )
      })

      it('downloadContacts writes an empty CSV response without calling people-api when the resolution is empty', async () => {
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

        expect(mockHttpService.post).not.toHaveBeenCalled()
        expect(setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv')
        expect(setHeader).toHaveBeenCalledWith(
          'Content-Disposition',
          'attachment; filename="contacts.csv"',
        )
        expect(flushHeaders).toHaveBeenCalledTimes(1)
        expect(end).toHaveBeenCalledTimes(1)
      })
    })
  })
})
