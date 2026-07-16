import { vi } from 'vitest'

// pino-pretty spawns a transport worker outside 'production'; skip it so the
// booted app tears down cleanly in the test runner. Must run before AppModule
// (and its logger module) is imported, hence vi.hoisted.
vi.hoisted(() => {
  process.env.NODE_ENV = 'production'
  process.env.LOG_LEVEL = 'silent'
  process.env.S2S_ALLOW_LOCALHOST = 'true'
  // PrismaService is overridden with a fake, but PeopleDownloadService builds a
  // real pg Pool in its constructor and only requires the URL to be present
  // (it connects lazily and swallows failures), so a dummy value is enough.
  process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/db'
})

import { HttpAdapterHost } from '@nestjs/core'
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { ZodValidationPipe } from 'nestjs-zod'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { PrismaService } from '../prisma/prisma.service'
import { AllExceptionsFilter } from '../shared/http-exception.filter'
import { PrismaExceptionFilter } from '../shared/prisma-exception.filter'

const DISTRICT_ID = '0e5bafca-93a9-86a5-2522-f373979720df'
const RESULTS_PER_PAGE = 10

const makeDbPerson = (index: number, overrides: Record<string, unknown> = {}) =>
  ({
    id: `person-${index}`,
    LALVOTERID: `lal-${index}`,
    State: 'WY',
    FirstName: 'Jane',
    MiddleName: null,
    LastName: `Doe${index}`,
    NameSuffix: null,
    Residence_Addresses_AddressLine: `${index} Main St`,
    Residence_Addresses_ExtraAddressLine: null,
    Residence_Addresses_City: null,
    Residence_Addresses_State: 'WY',
    Residence_Addresses_Zip: null,
    Residence_Addresses_ZipPlus4: null,
    Mailing_Addresses_AddressLine: null,
    Mailing_Addresses_ExtraAddressLine: null,
    Mailing_Addresses_City: null,
    Mailing_Addresses_State: null,
    Mailing_Addresses_Zip: null,
    Mailing_Addresses_ZipPlus4: null,
    Residence_Addresses_Latitude: null,
    Residence_Addresses_Longitude: null,
    VoterTelephones_LandlineFormatted: null,
    VoterTelephones_CellPhoneFormatted: null,
    Age: null,
    Gender: null,
    Parties_Description: null,
    Business_Owner: null,
    Education_Of_Person: null,
    Estimated_Income_Amount_Int: null,
    Homeowner_Probability_Model: null,
    Language_Code: null,
    Marital_Status: null,
    Presence_Of_Children: null,
    Veteran_Status: null,
    Voter_Status: null,
    EthnicGroups_EthnicGroup1Desc: null,
    Age_Int: null,
    VotingPerformanceEvenYearGeneral: null,
    VotingPerformanceMinorElection: null,
    ...overrides,
  }) as never

// Represents one row per matching voter/household in the DB. Reassigned per
// test; the fake Prisma below reads it so pagination is driven by real OFFSET
// arithmetic instead of hard-coded return values.
let dataset: Array<ReturnType<typeof makeDbPerson>> = []

const sqlText = (query: unknown): string => {
  const strings = (query as { strings?: readonly string[] })?.strings
  return strings ? strings.join(' ') : ''
}

// A model stub with the passthrough methods createPrismaBase binds in
// onModuleInit; only district/districtStats.findUnique carry real behavior.
const makeModel = () => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  findFirstOrThrow: vi.fn(),
  findUnique: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  count: vi.fn(),
})

const baseFakePrisma = {
  district: {
    ...makeModel(),
    findUnique: vi.fn(async () => ({
      id: DISTRICT_ID,
      type: 'City_Ward',
      name: 'CHEYENNE CITY WARD 1',
      state: 'WY',
    })),
  },
  districtStats: {
    ...makeModel(),
    // The ungrouped fast-count path reads totalConstituents; keep it in sync
    // with the dataset so pagination metadata reflects the same population the
    // data query pages over.
    findUnique: vi.fn(async () => ({
      totalConstituents: dataset.length,
      totalConstituentsWithCellPhone: 0,
    })),
  },
  $queryRaw: vi.fn(async (query: unknown) => {
    const text = sqlText(query)
    if (text.includes('voter_count')) {
      return [{ voter_count: BigInt(dataset.length) }]
    }
    const values = (query as { values?: unknown[] })?.values ?? []
    const skip = Number(values[values.length - 1] ?? 0)
    const take = Number(values[values.length - 2] ?? dataset.length)
    return dataset.slice(skip, skip + take)
  }),
}

// Any other model accessed by a PrismaBase service (e.g. Voter) just needs the
// passthrough methods to exist so onModuleInit can bind them.
const fakePrisma = new Proxy(baseFakePrisma as Record<string, unknown>, {
  get(target, prop: string) {
    if (prop in target) return target[prop]
    if (/^[a-z]/.test(prop)) return makeModel()
    return undefined
  },
})

type ListBody = {
  pagination: {
    totalResults: number
    currentPage: number
    pageSize: number
    totalPages: number
    hasNextPage: boolean
    hasPreviousPage: boolean
  }
  people: Array<{ id: string; householdId: string | null }>
}

describe('POST /v1/people (list pagination)', () => {
  let app: NestFastifyApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
      .compile()

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    )
    app.setGlobalPrefix('v1')
    app.useGlobalPipes(new ZodValidationPipe())
    const httpAdapterHost = app.get(HttpAdapterHost)
    app.useGlobalFilters(
      new PrismaExceptionFilter(),
      new AllExceptionsFilter(httpAdapterHost),
    )
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
  })

  afterAll(async () => {
    await app?.close()
  })

  const listPeople = async (
    body: Record<string, unknown>,
  ): Promise<{ statusCode: number; body: ListBody }> => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/people',
      payload: {
        districtId: DISTRICT_ID,
        filters: { filters: [], filterOperators: {} },
        resultsPerPage: RESULTS_PER_PAGE,
        ...body,
      },
    })
    return { statusCode: res.statusCode, body: res.json() as ListBody }
  }

  describe('ungrouped', () => {
    beforeAll(() => {
      dataset = Array.from({ length: 25 }, (_, i) => makeDbPerson(i))
    })

    it('returns the requested in-bounds page with matching metadata', async () => {
      const { statusCode, body } = await listPeople({ page: 2 })

      expect(statusCode).toBe(201)
      expect(body.pagination).toMatchObject({
        totalResults: 25,
        currentPage: 2,
        pageSize: 10,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true,
      })
      expect(body.people).toHaveLength(10)
      expect(body.people[0]?.id).toBe('person-10')
      expect(body.people[9]?.id).toBe('person-19')
    })

    it('out-of-bounds page clamps the offset and returns the last page', async () => {
      const { statusCode, body } = await listPeople({ page: 99 })

      expect(statusCode).toBe(201)
      expect(body.pagination.totalPages).toBe(3)
      expect(body.pagination.currentPage).toBe(3)
      expect(body.pagination.hasNextPage).toBe(false)
      expect(body.pagination.hasPreviousPage).toBe(true)
      // Rows are fetched at the clamped offset (20), so the last page (rows
      // 20..24) comes back consistent with currentPage — no divergence.
      expect(body.people).toHaveLength(5)
      expect(body.people[0]?.id).toBe('person-20')
      expect(body.people[4]?.id).toBe('person-24')
    })
  })

  describe('grouped by household', () => {
    beforeAll(() => {
      dataset = Array.from({ length: 25 }, (_, i) =>
        makeDbPerson(i, {
          householdId: `hh-${i}`,
          householdSize: 2n,
        }),
      )
    })

    it('returns the requested in-bounds page with household metadata', async () => {
      const { statusCode, body } = await listPeople({
        page: 1,
        groupByHousehold: true,
      })

      expect(statusCode).toBe(201)
      expect(body.pagination).toMatchObject({
        totalResults: 25,
        currentPage: 1,
        totalPages: 3,
      })
      expect(body.people).toHaveLength(10)
      expect(body.people[0]?.id).toBe('person-0')
      expect(body.people[0]?.householdId).toBe('hh-0')
    })

    it('out-of-bounds page clamps the offset and returns the last page', async () => {
      const { statusCode, body } = await listPeople({
        page: 99,
        groupByHousehold: true,
      })

      expect(statusCode).toBe(201)
      expect(body.pagination.totalPages).toBe(3)
      expect(body.pagination.currentPage).toBe(3)
      // Grouped path already resolves the count first and clamps the offset, so
      // the last page (rows 20..24) comes back consistent with currentPage.
      expect(body.people).toHaveLength(5)
      expect(body.people[0]?.id).toBe('person-20')
      expect(body.people[4]?.id).toBe('person-24')
    })
  })
})
