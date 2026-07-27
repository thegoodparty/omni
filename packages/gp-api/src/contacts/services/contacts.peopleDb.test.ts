import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { VoterFileDownloadAccessService } from '@/shared/services/voterFileDownloadAccess.service'
import {
  ListDetailContactsResponseSchema,
  PeopleListResponseSchema,
  PersonSchema,
} from '@goodparty_org/contracts'
import { PinoLogger } from 'nestjs-pino'
import { Organization } from '../../generated/prisma'
import { of } from 'rxjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ContactsService } from './contacts.service'
import type { PeopleListResponse, PersonOutput } from '../schemas/person.schema'

// Task 3.2: parity tests for the USE_LOCAL_PEOPLE_DB=true branch wired in
// Task 3.1. contacts.service.test.ts covers the existing httpService (flag
// off) path exhaustively; this file mocks the ported people-db services
// (VoterQueryService/VoterDownloadService/StatsService) and asserts (a) the
// flag routes to the local service instead of httpService, (b) the default
// (flag off) behavior is unchanged, and (c) the returned shape validates
// against the relevant @goodparty_org/contracts schema.
vi.mock('@nestjs/axios', () => ({
  HttpService: vi.fn(),
}))

// A real-looking GUID: the ported services actually run their DTOs
// (ListPeopleDTO.create, AggregatesDTO.create, ...) through Zod, whose
// districtId field is z.guid() — unlike the httpService-only path, a
// non-UUID placeholder would throw here.
const OVERRIDE_DISTRICT_ID = '11111111-1111-1111-1111-111111111111'

const makeOrganization = (
  overrides: Partial<Organization> = {},
): Organization =>
  ({
    slug: 'eo-office-1',
    ownerId: 100,
    positionId: null,
    overrideDistrictId: OVERRIDE_DISTRICT_ID,
    customPositionName: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Organization

const FIXTURE_PERSON: PersonOutput = {
  id: 'person-1',
  lalVoterId: 'LAL-1',
  firstName: 'Jane',
  middleName: null,
  lastName: 'Doe',
  nameSuffix: null,
  age: 42,
  state: 'CA',
  address: {
    line1: '123 Main St',
    line2: null,
    city: 'Springfield',
    state: 'CA',
    zip: '90210',
    zipPlus4: null,
    latitude: null,
    longitude: null,
  },
  cellPhone: '555-0100',
  landline: null,
  gender: 'Female',
  politicalParty: 'Democratic',
  registeredVoter: 'Yes',
  estimatedIncomeAmount: 50000,
  voterStatus: 'Super',
  maritalStatus: 'Married',
  hasChildrenUnder18: 'No',
  veteranStatus: null,
  homeowner: 'Yes',
  businessOwner: null,
  levelOfEducation: 'College Degree',
  ethnicityGroup: 'European',
  language: 'English',
}

const FIXTURE_PAGE: PeopleListResponse = {
  pagination: {
    totalResults: 1,
    currentPage: 1,
    pageSize: 50,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
  people: [FIXTURE_PERSON],
}

const FIXTURE_AGGREGATES = {
  count: 10,
  avgAge: 45,
  avgIncome: 60000,
  fenced: false,
}

// The actual on-wire shape from both people-api's controller and this
// service's local StatsService.getStats (see report — this doesn't match
// contacts.types.ts's aspirational StatsResponse type). No contracts Zod
// schema exists for it, so these tests assert routing + pass-through only.
const FIXTURE_STATS = {
  districtId: OVERRIDE_DISTRICT_ID,
  totalConstituents: 5000,
  totalConstituentsWithCellPhone: 4000,
  buckets: {},
}

describe('ContactsService — USE_LOCAL_PEOPLE_DB parity', () => {
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

  beforeEach(() => {
    delete process.env.USE_LOCAL_PEOPLE_DB

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
        district: null,
        ballotLevel: null,
      }),
    }
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
    mockVoterQueryService = {
      findPeople: vi.fn(),
      getAggregates: vi.fn(),
      samplePeople: vi.fn(),
      findPerson: vi.fn(),
    }
    mockVoterDownloadService = {
      streamPeopleCsv: vi.fn(),
    }
    mockStatsService = {
      getStats: vi.fn(),
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
      mockVoterQueryService as never,
      mockVoterDownloadService as never,
      mockStatsService as never,
      createMockLogger(),
    )
    vi.clearAllMocks()
  })

  describe('findContacts', () => {
    it('uses VoterQueryService.findPeople when USE_LOCAL_PEOPLE_DB=true and validates PeopleListResponse', async () => {
      process.env.USE_LOCAL_PEOPLE_DB = 'true'
      const org = makeOrganization()
      mockVoterQueryService.findPeople.mockResolvedValue(FIXTURE_PAGE)

      const result = await service.findContacts(
        { resultsPerPage: 10, page: 1, search: undefined, segment: 'all' },
        org,
      )

      expect(mockVoterQueryService.findPeople).toHaveBeenCalledOnce()
      expect(mockVoterQueryService.findPeople).toHaveBeenCalledWith(
        expect.objectContaining({
          districtId: OVERRIDE_DISTRICT_ID,
          resultsPerPage: 10,
          page: 1,
        }),
      )
      expect(mockHttpService.post).not.toHaveBeenCalled()
      expect(PeopleListResponseSchema.safeParse(result).success).toBe(true)
    })

    it('uses httpService when USE_LOCAL_PEOPLE_DB is off (default)', async () => {
      const org = makeOrganization()
      mockHttpService.post.mockReturnValue(of({ data: FIXTURE_PAGE }))

      const result = await service.findContacts(
        { resultsPerPage: 10, page: 1, search: undefined, segment: 'all' },
        org,
      )

      expect(mockHttpService.post).toHaveBeenCalledOnce()
      expect(mockVoterQueryService.findPeople).not.toHaveBeenCalled()
      expect(PeopleListResponseSchema.safeParse(result).success).toBe(true)
    })
  })

  describe('countContacts', () => {
    it('uses VoterQueryService.findPeople when USE_LOCAL_PEOPLE_DB=true', async () => {
      process.env.USE_LOCAL_PEOPLE_DB = 'true'
      const org = makeOrganization()
      mockVoterQueryService.findPeople.mockResolvedValue(FIXTURE_PAGE)

      const count = await service.countContacts({}, org)

      expect(count).toBe(FIXTURE_PAGE.pagination.totalResults)
      expect(mockVoterQueryService.findPeople).toHaveBeenCalledWith(
        expect.objectContaining({
          districtId: OVERRIDE_DISTRICT_ID,
          resultsPerPage: 1,
          page: 1,
        }),
      )
      expect(mockHttpService.post).not.toHaveBeenCalled()
    })

    it('uses httpService when USE_LOCAL_PEOPLE_DB is off (default)', async () => {
      const org = makeOrganization()
      mockHttpService.post.mockReturnValue(of({ data: FIXTURE_PAGE }))

      const count = await service.countContacts({}, org)

      expect(count).toBe(FIXTURE_PAGE.pagination.totalResults)
      expect(mockHttpService.post).toHaveBeenCalledOnce()
      expect(mockVoterQueryService.findPeople).not.toHaveBeenCalled()
    })
  })

  describe('findContactsForFilter', () => {
    it('uses VoterQueryService.findPeople when USE_LOCAL_PEOPLE_DB=true and validates PeopleListResponse', async () => {
      process.env.USE_LOCAL_PEOPLE_DB = 'true'
      const org = makeOrganization()
      mockVoterQueryService.findPeople.mockResolvedValue(FIXTURE_PAGE)

      const result = await service.findContactsForFilter(
        {},
        { resultsPerPage: 25, page: 2 },
        org,
      )

      expect(mockVoterQueryService.findPeople).toHaveBeenCalledWith(
        expect.objectContaining({
          districtId: OVERRIDE_DISTRICT_ID,
          resultsPerPage: 25,
          page: 2,
        }),
      )
      expect(mockHttpService.post).not.toHaveBeenCalled()
      expect(PeopleListResponseSchema.safeParse(result).success).toBe(true)
    })
  })

  // fetchPeopleAggregates is private; drive it through getListDetail's
  // universe-detail path (no segment), which fans out to it four times
  // (base + cellphone + landline + address).
  describe('list-detail aggregates (fetchPeopleAggregates)', () => {
    it('uses VoterQueryService.getAggregates when USE_LOCAL_PEOPLE_DB=true and validates ListDetailContactsResponse', async () => {
      process.env.USE_LOCAL_PEOPLE_DB = 'true'
      const org = makeOrganization()
      mockVoterQueryService.getAggregates.mockResolvedValue(FIXTURE_AGGREGATES)

      const result = await service.getListDetail({ segment: undefined }, org)

      expect(mockVoterQueryService.getAggregates).toHaveBeenCalledTimes(4)
      expect(mockVoterQueryService.getAggregates).toHaveBeenCalledWith(
        expect.objectContaining({ districtId: OVERRIDE_DISTRICT_ID }),
      )
      expect(mockHttpService.post).not.toHaveBeenCalled()
      expect(ListDetailContactsResponseSchema.safeParse(result).success).toBe(
        true,
      )
    })

    it('uses httpService when USE_LOCAL_PEOPLE_DB is off (default)', async () => {
      const org = makeOrganization()
      mockHttpService.post.mockReturnValue(of({ data: FIXTURE_AGGREGATES }))

      const result = await service.getListDetail({ segment: undefined }, org)

      expect(mockHttpService.post).toHaveBeenCalledTimes(4)
      expect(mockVoterQueryService.getAggregates).not.toHaveBeenCalled()
      expect(ListDetailContactsResponseSchema.safeParse(result).success).toBe(
        true,
      )
    })
  })

  describe('sampleContacts', () => {
    it('uses VoterQueryService.samplePeople when USE_LOCAL_PEOPLE_DB=true and validates Person[]', async () => {
      process.env.USE_LOCAL_PEOPLE_DB = 'true'
      const org = makeOrganization()
      mockVoterQueryService.samplePeople.mockResolvedValue([FIXTURE_PERSON])

      const result = await service.sampleContacts(
        { size: 25, excludeIds: [] },
        org,
      )

      expect(mockVoterQueryService.samplePeople).toHaveBeenCalledWith(
        expect.objectContaining({
          districtId: OVERRIDE_DISTRICT_ID,
          size: 25,
          hasCellPhone: true,
        }),
      )
      expect(mockHttpService.post).not.toHaveBeenCalled()
      expect(z.array(PersonSchema).safeParse(result).success).toBe(true)
    })

    it('uses httpService when USE_LOCAL_PEOPLE_DB is off (default)', async () => {
      const org = makeOrganization()
      mockHttpService.post.mockReturnValue(of({ data: [FIXTURE_PERSON] }))

      const result = await service.sampleContacts(
        { size: 25, excludeIds: [] },
        org,
      )

      expect(mockHttpService.post).toHaveBeenCalledOnce()
      expect(mockVoterQueryService.samplePeople).not.toHaveBeenCalled()
      expect(z.array(PersonSchema).safeParse(result).success).toBe(true)
    })
  })

  describe('findPerson', () => {
    it('uses VoterQueryService.findPerson when USE_LOCAL_PEOPLE_DB=true and validates Person', async () => {
      process.env.USE_LOCAL_PEOPLE_DB = 'true'
      const org = makeOrganization()
      mockVoterQueryService.findPerson.mockResolvedValue(FIXTURE_PERSON)

      const result = await service.findPerson('person-1', org)

      expect(mockVoterQueryService.findPerson).toHaveBeenCalledWith(
        'person-1',
        expect.objectContaining({ districtId: OVERRIDE_DISTRICT_ID }),
      )
      expect(mockHttpService.get).not.toHaveBeenCalled()
      expect(PersonSchema.safeParse(result).success).toBe(true)
    })

    it('uses httpService when USE_LOCAL_PEOPLE_DB is off (default)', async () => {
      const org = makeOrganization()
      mockHttpService.get.mockReturnValue(of({ data: FIXTURE_PERSON }))

      const result = await service.findPerson('person-1', org)

      expect(mockHttpService.get).toHaveBeenCalledOnce()
      expect(mockVoterQueryService.findPerson).not.toHaveBeenCalled()
      expect(PersonSchema.safeParse(result).success).toBe(true)
    })
  })

  // streamPeopleDownload is private; drive it through downloadContacts.
  describe('downloadContacts (streamPeopleDownload)', () => {
    const makeMockReply = () => ({
      raw: {
        headersSent: false,
        flushHeaders: vi.fn(),
        setHeader: vi.fn(),
        on: vi.fn(),
      },
    })

    it('uses VoterDownloadService.streamPeopleCsv when USE_LOCAL_PEOPLE_DB=true', async () => {
      process.env.USE_LOCAL_PEOPLE_DB = 'true'
      const org = makeOrganization()
      mockVoterDownloadService.streamPeopleCsv.mockResolvedValue(undefined)
      const res = makeMockReply()

      await service.downloadContacts({ segment: 'all' }, res as never, org)

      expect(mockVoterDownloadService.streamPeopleCsv).toHaveBeenCalledWith(
        expect.objectContaining({
          districtId: OVERRIDE_DISTRICT_ID,
          groupByHousehold: false,
          excludeColumns: ['Parties_Description'],
        }),
        res,
      )
      expect(mockHttpService.post).not.toHaveBeenCalled()
    })

    it('uses httpService when USE_LOCAL_PEOPLE_DB is off (default)', async () => {
      const org = makeOrganization()
      const mockStream = {
        destroyed: false,
        pipe: vi.fn(),
        destroy: vi.fn(),
        on: vi.fn((event: string, cb: (err?: Error) => void) => {
          if (event === 'end') setImmediate(() => cb())
        }),
      }
      mockHttpService.post.mockReturnValue(of({ data: mockStream }))
      const res = makeMockReply()

      await service.downloadContacts({ segment: 'all' }, res as never, org)

      expect(mockHttpService.post).toHaveBeenCalledOnce()
      expect(mockVoterDownloadService.streamPeopleCsv).not.toHaveBeenCalled()
    })
  })

  describe('countVoterFilePeople', () => {
    it('uses VoterQueryService.findPeople when USE_LOCAL_PEOPLE_DB=true', async () => {
      process.env.USE_LOCAL_PEOPLE_DB = 'true'
      const org = makeOrganization()
      mockVoterQueryService.findPeople.mockResolvedValue(FIXTURE_PAGE)

      const count = await service.countVoterFilePeople(
        { hasCellPhone: true },
        false,
        org,
      )

      expect(count).toBe(FIXTURE_PAGE.pagination.totalResults)
      // The DTO's filters field goes through the ported filters.schema
      // transform (raw {hasCellPhone: true} -> {filters, filterOperators,
      // filterValues}), so assert the transformed shape rather than the
      // pre-transform input.
      expect(mockVoterQueryService.findPeople).toHaveBeenCalledWith(
        expect.objectContaining({
          districtId: OVERRIDE_DISTRICT_ID,
          groupByHousehold: false,
          filters: expect.objectContaining({ filters: ['hasCellPhone'] }),
        }),
      )
      expect(mockHttpService.post).not.toHaveBeenCalled()
    })

    it('uses httpService when USE_LOCAL_PEOPLE_DB is off (default)', async () => {
      const org = makeOrganization()
      mockHttpService.post.mockReturnValue(of({ data: FIXTURE_PAGE }))

      const count = await service.countVoterFilePeople(
        { hasCellPhone: true },
        false,
        org,
      )

      expect(count).toBe(FIXTURE_PAGE.pagination.totalResults)
      expect(mockHttpService.post).toHaveBeenCalledOnce()
      expect(mockVoterQueryService.findPeople).not.toHaveBeenCalled()
    })
  })

  describe('fetchStatsByDistrictId', () => {
    it('uses StatsService.getStats when USE_LOCAL_PEOPLE_DB=true', async () => {
      process.env.USE_LOCAL_PEOPLE_DB = 'true'
      mockStatsService.getStats.mockResolvedValue(FIXTURE_STATS)

      const result = await service.fetchStatsByDistrictId(OVERRIDE_DISTRICT_ID)

      expect(mockStatsService.getStats).toHaveBeenCalledWith(
        expect.objectContaining({ districtId: OVERRIDE_DISTRICT_ID }),
      )
      expect(mockHttpService.get).not.toHaveBeenCalled()
      expect(result).toEqual(FIXTURE_STATS)
    })

    it('uses httpService when USE_LOCAL_PEOPLE_DB is off (default)', async () => {
      mockHttpService.get.mockReturnValue(of({ data: FIXTURE_STATS }))

      const result = await service.fetchStatsByDistrictId(OVERRIDE_DISTRICT_ID)

      expect(mockHttpService.get).toHaveBeenCalledOnce()
      expect(mockStatsService.getStats).not.toHaveBeenCalled()
      expect(result).toEqual(FIXTURE_STATS)
    })
  })
})
