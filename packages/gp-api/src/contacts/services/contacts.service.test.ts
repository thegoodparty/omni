import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { VoterFileDownloadAccessService } from '@/shared/services/voterFileDownloadAccess.service'
import { BallotReadyPositionLevel } from '@goodparty_org/contracts'
import { BadRequestException } from '@nestjs/common'
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
    let mockFeaturesService: {
      isFeatureEnabled: ReturnType<typeof vi.fn>
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
      mockFeaturesService = {
        isFeatureEnabled: vi.fn().mockResolvedValue(true),
      }

      service = new ContactsService(
        mockHttpService as never,
        mockVoterFileFilterService as never,
        mockElectionsService as never,
        mockCampaignsService as never,
        mockOrganizationsService as never,
        voterFileDownloadAccess,
        mockFeaturesService as never,
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

      it('returns a synthetic preview (no people-api call) for the default "all" segment when not pro', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockCampaignsService.findFirst.mockResolvedValue({ isPro: false })

        const result = await service.findContacts(
          { resultsPerPage: 10, page: 1, segment: 'all' },
          org,
        )

        // Non-pro must never reach people-api for real voter PII; the base list
        // is fabricated preview data the UI blurs (ENG-10508).
        expect(mockHttpService.post).not.toHaveBeenCalled()
        expect(result.people).toHaveLength(10)
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

      it('does not check access when search is not provided', async () => {
        const org = makeOrganization({
          slug: 'campaign-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })

        mockHttpService.post.mockReturnValue(
          of({ data: { people: [], pagination: {} } }),
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

        const result = await service.findContacts(
          { resultsPerPage: 10, page: 1, search: undefined, segment: 'all' },
          org,
        )

        // No campaign means no pro entitlement, so the base list must not pull
        // real voter PII from people-api — it serves the synthetic preview.
        expect(mockHttpService.post).not.toHaveBeenCalled()
        expect(result.people).toHaveLength(10)
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

        expect(result.people[0].politicalParty).toBe('Republican')
      })

      // Regression guard: the backend treats Win and Serve identically — it
      // forwards the party filter and passes politicalParty through for eo-
      // (Serve) orgs too. The Win/Serve party-visibility rule is a frontend
      // display concern (the contacts person overlay's hidePoliticalParty
      // gate), not duplicated on the backend. This locks that in so a future
      // change that strips party server-side can't silently break Serve.
      it('does not strip party or the party filter for Serve (eo-) orgs', async () => {
        const org = makeOrganization({
          slug: 'eo-mayor-1',
          overrideDistrictId: OVERRIDE_DISTRICT_ID,
        })
        mockVoterFileFilterService.findByIdAndOrganizationSlug.mockResolvedValue(
          partySegment,
        )
        mockHttpService.post.mockReturnValue(
          of({
            data: {
              people: [{ id: 'p1', politicalParty: 'Democratic' }],
              pagination: {},
            },
          }),
        )

        const result = await service.findContacts(
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
        expect(result.people[0].politicalParty).toBe('Democratic')
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
      }> = [
        { segment: 'all', filters: {} },
        { segment: 'doorKnocking', filters: {} },
        { segment: 'directMail', filters: {} },
        { segment: 'texting', filters: { hasCellPhone: true } },
        { segment: 'digitalAds', filters: { hasCellPhone: true } },
        { segment: 'phoneBanking', filters: { hasLandline: true } },
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
        'forwards the $segment channel filters to the people-api list/count query',
        async ({ segment, filters }) => {
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
            }),
            expect.any(Object),
          )
        },
      )

      it.each(channelFilters)(
        'streams the $segment channel download with CSV headers and the same filters',
        async ({ segment, filters }) => {
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
  })
})
