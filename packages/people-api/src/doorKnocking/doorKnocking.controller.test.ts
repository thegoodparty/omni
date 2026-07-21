import { vi } from 'vitest'

// pino-pretty spawns a transport worker outside 'production'; skip it so the
// booted app tears down cleanly in the test runner. Must run before AppModule
// (and its logger module) is imported, hence vi.hoisted.
vi.hoisted(() => {
  process.env.NODE_ENV = 'production'
  process.env.LOG_LEVEL = 'silent'
  process.env.S2S_ALLOW_LOCALHOST = 'true'
  // DatabaseUrlProvider reads LOCAL_DATABASE_URL when booting; the pool connects
  // lazily and swallows failures, so a dummy value is enough here.
  process.env.LOCAL_DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/db'
})

import { HttpAdapterHost } from '@nestjs/core'
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { ZodValidationPipe } from 'nestjs-zod'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { PrismaService } from '../prisma/prisma.service'
import { AllExceptionsFilter } from '../shared/http-exception.filter'
import { PrismaExceptionFilter } from '../shared/prisma-exception.filter'

const DISTRICT_ID = '0e5bafca-93a9-86a5-2522-f373979720df'
const TARGET_ID = '11111111-1111-1111-1111-111111111111'
const OTHER_ID = '22222222-2222-2222-2222-222222222222'
const ADDRESS_KEY = '1200 W ELM ST|CHEYENNE|WY|82001'

// Rows the fake $queryRaw returns — already SELECT-aliased, reassigned per
// test.
let rows: Array<Record<string, unknown>> = []

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
  $queryRaw: vi.fn(async () => rows),
}

const fakePrisma = new Proxy(baseFakePrisma as Record<string, unknown>, {
  get(target, prop: string, receiver) {
    // PrismaBase services reach the live client through `.instance`; point it
    // back at this same fake.
    if (prop === 'instance') return receiver
    if (prop in target) return target[prop]
    if (/^[a-z]/.test(prop)) return makeModel()
    return undefined
  },
})

const evaluateRow = (id: string) => ({
  id,
  firstName: 'Marisol',
  lastName: 'Vega',
  lat: 41.14,
  lng: -104.82,
  addressKey: ADDRESS_KEY,
  displayAddress: '1200 W Elm St',
})

describe('POST /v1/door-knocking', () => {
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

  beforeEach(() => {
    rows = []
  })

  const evaluatePayload = {
    districtId: DISTRICT_ID,
    bbox: { minLat: 41.1, maxLat: 41.2, minLng: -104.9, maxLng: -104.8 },
    maxPeople: 3,
  }

  describe('evaluate', () => {
    it('returns the roster through the route', async () => {
      rows = [evaluateRow(TARGET_ID)]

      const res = await app.inject({
        method: 'POST',
        url: '/v1/door-knocking/evaluate',
        payload: evaluatePayload,
      })

      expect(res.statusCode).toBe(201)
      expect(res.json()).toEqual({
        people: [
          {
            id: TARGET_ID,
            firstName: 'Marisol',
            lastName: 'Vega',
            lat: 41.14,
            lng: -104.82,
            addressKey: ADDRESS_KEY,
            displayAddress: '1200 W Elm St',
          },
        ],
      })
    })

    it('rejects a malformed body with 400', async () => {
      const { bbox: _bbox, ...withoutBbox } = evaluatePayload
      const res = await app.inject({
        method: 'POST',
        url: '/v1/door-knocking/evaluate',
        payload: withoutBbox,
      })

      expect(res.statusCode).toBe(400)
    })

    it('rejects unknown body keys with 400 (strict schema)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/door-knocking/evaluate',
        payload: { ...evaluatePayload, limit: 10 },
      })

      expect(res.statusCode).toBe(400)
    })

    it('returns 400 when the roster exceeds maxPeople', async () => {
      rows = [
        evaluateRow(TARGET_ID),
        evaluateRow(OTHER_ID),
        evaluateRow('33333333-3333-3333-3333-333333333333'),
        evaluateRow('44444444-4444-4444-4444-444444444444'),
      ]

      const res = await app.inject({
        method: 'POST',
        url: '/v1/door-knocking/evaluate',
        payload: evaluatePayload,
      })

      expect(res.statusCode).toBe(400)
      expect(res.json().message).toContain('matched more than 3')
    })
  })

  it('rejects a presented-but-invalid S2S token (guard is wired)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/door-knocking/evaluate',
      headers: { authorization: 'Bearer not-a-real-token' },
      payload: evaluatePayload,
    })

    expect(res.statusCode).toBe(401)
  })

  describe('residents', () => {
    const residentsPayload = {
      districtId: DISTRICT_ID,
      addressKeys: [ADDRESS_KEY],
      targetPersonIds: [TARGET_ID],
    }

    it('returns grouped residents through the route', async () => {
      rows = [
        {
          id: TARGET_ID,
          firstName: 'Marisol',
          lastName: 'Vega',
          Age: '47',
          Age_Int: 47,
          Parties_Description: 'Non-Partisan',
          addressKey: ADDRESS_KEY,
        },
        {
          id: OTHER_ID,
          firstName: 'Teo',
          lastName: 'Vega',
          Age: null,
          Age_Int: null,
          Parties_Description: null,
          addressKey: ADDRESS_KEY,
        },
      ]

      const res = await app.inject({
        method: 'POST',
        url: '/v1/door-knocking/residents',
        payload: residentsPayload,
      })

      expect(res.statusCode).toBe(201)
      expect(res.json()).toEqual({
        addresses: [
          {
            addressKey: ADDRESS_KEY,
            targets: [
              {
                personId: TARGET_ID,
                firstName: 'Marisol',
                lastName: 'Vega',
                age: 47,
                politicalParty: 'Independent',
              },
            ],
            otherResidents: [
              { personId: OTHER_ID, firstName: 'Teo', lastName: 'Vega' },
            ],
          },
        ],
      })
    })

    it('rejects an empty addressKeys array with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/door-knocking/residents',
        payload: { ...residentsPayload, addressKeys: [] },
      })

      expect(res.statusCode).toBe(400)
    })
  })
})
