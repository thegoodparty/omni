import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { VoterFileDownloadAccessService } from '@/shared/services/voterFileDownloadAccess.service'
import {
  ListDetailContactsResponseSchema,
  PeopleListResponseSchema,
  PersonSchema,
} from '@goodparty_org/contracts'
import { HttpStatus } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { Organization } from '../../generated/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ContactsService } from './contacts.service'
import { VOTER_DATA_UNAVAILABLE_ERROR_CODE } from '../contacts.types'
import type { PeopleListResponse, PersonOutput } from '../schemas/person.schema'

// Task 3.2 (superseded): people-db is now the SOLE contacts path — the
// USE_LOCAL_PEOPLE_DB flag and the legacy people-api HTTP client are gone.
// This file asserts (a) each people-facing ContactsService method calls the
// correct ported people-db service (VoterQueryService/VoterDownloadService/
// StatsService) with the transformed DTO, and (b) the returned shape
// validates against the relevant @goodparty_org/contracts schema.
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
}

// The actual on-wire shape from this service's local StatsService.getStats
// (see report — this doesn't match contacts.types.ts's aspirational
// StatsResponse type). No contracts Zod schema exists for it, so these tests
// assert routing + pass-through only.
const FIXTURE_STATS = {
  districtId: OVERRIDE_DISTRICT_ID,
  totalConstituents: 5000,
  totalConstituentsWithCellPhone: 4000,
  buckets: {},
}

describe('ContactsService — people-db (sole path)', () => {
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
    findStats: ReturnType<typeof vi.fn>
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
      findStats: vi.fn(),
    }
    const mockContactStatusService = {
      currentStatusForPeople: vi.fn().mockResolvedValue(new Map()),
      changeStatus: vi.fn(),
    }
    const mockContactsMadeResolutionService = {
      resolveContactsMade: vi.fn().mockResolvedValue({ kind: 'none' }),
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
      createMockLogger(),
    )
  })

  describe('findContacts', () => {
    it('calls VoterQueryService.findPeople and validates PeopleListResponse', async () => {
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
      expect(PeopleListResponseSchema.safeParse(result).success).toBe(true)
    })
  })

  describe('countContacts', () => {
    it('calls VoterQueryService.findPeople with resultsPerPage: 1', async () => {
      const org = makeOrganization()
      mockVoterQueryService.findPeople.mockResolvedValue(FIXTURE_PAGE)

      const result = await service.countContacts({}, org)

      expect(result).toEqual({
        count: FIXTURE_PAGE.pagination.totalResults,
      })
      expect(mockVoterQueryService.findPeople).toHaveBeenCalledWith(
        expect.objectContaining({
          districtId: OVERRIDE_DISTRICT_ID,
          resultsPerPage: 1,
          page: 1,
        }),
      )
    })
  })

  describe('findContactsForFilter', () => {
    it('calls VoterQueryService.findPeople and validates PeopleListResponse', async () => {
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
      expect(PeopleListResponseSchema.safeParse(result).success).toBe(true)
    })
  })

  // fetchPeopleAggregates is private; drive it through getListDetail's
  // universe-detail path (no segment), which fans out to it four times
  // (base + cellphone + landline + address).
  describe('list-detail aggregates (fetchPeopleAggregates)', () => {
    it('calls VoterQueryService.getAggregates and validates ListDetailContactsResponse', async () => {
      const org = makeOrganization()
      mockVoterQueryService.getAggregates.mockResolvedValue(FIXTURE_AGGREGATES)

      const result = await service.getListDetail({ segment: undefined }, org)

      expect(mockVoterQueryService.getAggregates).toHaveBeenCalledTimes(4)
      expect(mockVoterQueryService.getAggregates).toHaveBeenCalledWith(
        expect.objectContaining({ districtId: OVERRIDE_DISTRICT_ID }),
      )
      expect(ListDetailContactsResponseSchema.safeParse(result).success).toBe(
        true,
      )
    })
  })

  describe('sampleContacts', () => {
    it('calls VoterQueryService.samplePeople and validates Person[]', async () => {
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
      expect(z.array(PersonSchema).safeParse(result).success).toBe(true)
    })
  })

  describe('findPerson', () => {
    it('calls VoterQueryService.findPerson and validates Person', async () => {
      const org = makeOrganization()
      mockVoterQueryService.findPerson.mockResolvedValue(FIXTURE_PERSON)

      const result = await service.findPerson('person-1', org)

      expect(mockVoterQueryService.findPerson).toHaveBeenCalledWith(
        'person-1',
        expect.objectContaining({ districtId: OVERRIDE_DISTRICT_ID }),
      )
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

    it('calls VoterDownloadService.streamPeopleCsv with contacts.csv + gp_download cookie', async () => {
      const org = makeOrganization()
      mockVoterDownloadService.streamPeopleCsv.mockResolvedValue(undefined)
      const res = makeMockReply()

      await service.downloadContacts({ segment: 'all' }, res as never, org)

      expect(mockVoterDownloadService.streamPeopleCsv).toHaveBeenCalledWith(
        expect.objectContaining({
          districtId: OVERRIDE_DISTRICT_ID,
          groupByHousehold: false,
          // Serve (eo-) downloads drop party + turnout propensity + vote
          // history columns via projection (ENG-10830).
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
        expect.objectContaining({
          filename: 'contacts.csv',
          extraHeaders: expect.objectContaining({
            'Set-Cookie': expect.stringMatching(/^gp_download=/),
          }),
        }),
      )
    })
  })

  describe('countVoterFilePeople', () => {
    it('calls VoterQueryService.findPeople with the transformed filter shape', async () => {
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
    })
  })

  describe('fetchStatsByDistrictId', () => {
    it('calls StatsService.findStats', async () => {
      mockStatsService.findStats.mockResolvedValue(FIXTURE_STATS)

      const result = await service.fetchStatsByDistrictId(OVERRIDE_DISTRICT_ID)

      expect(mockStatsService.findStats).toHaveBeenCalledWith(
        expect.objectContaining({ districtId: OVERRIDE_DISTRICT_ID }),
      )
      expect(result).toEqual(FIXTURE_STATS)
    })

    it('throws VOTER_DATA_UNAVAILABLE when the district has no stats row', async () => {
      mockStatsService.findStats.mockResolvedValue(null)

      await expect(
        service.fetchStatsByDistrictId(OVERRIDE_DISTRICT_ID),
      ).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
        response: { errorCode: VOTER_DATA_UNAVAILABLE_ERROR_CODE },
      })
    })
  })
})
