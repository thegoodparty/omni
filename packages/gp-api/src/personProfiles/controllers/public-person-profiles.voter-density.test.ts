import { NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { PersonsService } from '@/electionDb/persons/persons.service'
import { VoterDensityProxyService } from '../services/voter-density-proxy.service'

// e2e for GET /v1/public-person-profiles/voter-density. Boots the real app
// (testcontainers Postgres) and mocks ONLY the election-db read, which answers
// both halves of the question — the person's district and that district's
// precomputed cells — in one call.
const service = useTestService()

const PERSON_ID = '33333333-3333-4333-8333-333333333333'
const DISTRICT_ID = '44444444-4444-4444-8444-444444444444'

/** The election-db row, as the caller expects to receive it. */
const density = (body: {
  districtId?: string | null
  coverage?: number | null
  cells?: { lat: number; lng: number; count: number }[]
}) => ({
  personId: PERSON_ID,
  districtId: body.districtId === undefined ? DISTRICT_ID : body.districtId,
  coverage: body.coverage ?? null,
  cells: body.cells ?? [],
})

const mockRead = (impl: () => unknown) =>
  vi
    .spyOn(service.app.get(PersonsService), 'getVoterDensity')
    // The stub stands in for a Prisma-backed read; its shape is asserted by
    // the assertions below rather than by the delegate's generic signature.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockImplementation(() => impl() as any)

const get = (personId: string = PERSON_ID, ip?: string) =>
  service.client.get('/v1/public-person-profiles/voter-density', {
    params: { personId },
    ...(ip ? { headers: { 'X-Forwarded-For': ip } } : {}),
  })

/** The proxy answers an identical lookup from memory for 60s. */
const densityCache = () =>
  (
    service.app.get(VoterDensityProxyService) as unknown as {
      cache: Map<string, unknown>
    }
  ).cache

describe('GET /v1/public-person-profiles/voter-density', () => {
  beforeEach(() => {
    densityCache().clear()
  })

  it('returns coverage + cells for a district with density data', async () => {
    const spy = mockRead(() =>
      Promise.resolve(
        density({
          coverage: 0.82,
          cells: [
            { lat: 43.1, lng: -108.2, count: 25 },
            { lat: 43.2, lng: -108.3, count: 11 },
          ],
        }),
      ),
    )

    const res = await get()

    expect(res.status).toBe(200)
    expect(res.data.coverage).toBe(0.82)
    expect(res.data.cells).toHaveLength(2)
    expect(res.data.cells[0]).toEqual({ lat: 43.1, lng: -108.2, count: 25 })
    expect(spy).toHaveBeenCalledWith(PERSON_ID)
    spy.mockRestore()
  })

  it('renders no map (empty cells) when the district has no density rows', async () => {
    const spy = mockRead(() =>
      Promise.resolve(density({ coverage: null, cells: [] })),
    )

    const res = await get()

    expect(res.status).toBe(200)
    expect(res.data.coverage).toBeNull()
    expect(res.data.cells).toEqual([])
    spy.mockRestore()
  })

  // Reading in process removed the network boundary that used to narrow this
  // body. The page is unauthenticated, so the response schema is now the only
  // thing keeping the rest of the election-db row out of it.
  it('serves only coverage + cells, never the row it was read from', async () => {
    const spy = mockRead(() =>
      Promise.resolve({
        ...density({ coverage: 0.4, cells: [] }),
        gpApiUserId: '1234',
        internalNote: 'not for the public',
      }),
    )

    const res = await get()

    expect(res.status).toBe(200)
    expect(Object.keys(res.data).sort()).toEqual(['cells', 'coverage'])
    spy.mockRestore()
  })

  it('404s when the person maps to no district (null districtId)', async () => {
    const spy = mockRead(() => Promise.resolve(density({ districtId: null })))

    const res = await get()
    expect(res.status).toBe(404)
    spy.mockRestore()
  })

  it('404s when election-db does not know the person', async () => {
    const spy = mockRead(() =>
      Promise.reject(new NotFoundException('Person not found')),
    )

    const res = await get()
    expect(res.status).toBe(404)
    spy.mockRestore()
  })

  it('502s (not swallowed) when the read hard-fails', async () => {
    const spy = mockRead(() => Promise.reject(new Error('connection refused')))

    const res = await get()
    expect(res.status).toBe(502)
    spy.mockRestore()
  })

  it('400s on a non-uuid personId', async () => {
    const res = await get('not-a-uuid')
    expect(res.status).toBe(400)
  })

  it('answers a repeat lookup without going upstream again', async () => {
    const spy = mockRead(() =>
      Promise.resolve(density({ coverage: 0.4, cells: [] })),
    )

    const first = await get()
    const second = await get()

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.data.coverage).toBe(0.4)
    expect(spy).toHaveBeenCalledOnce()
    spy.mockRestore()
  })

  it('does not cache a failed read', async () => {
    const failing = mockRead(() =>
      Promise.reject(new Error('connection refused')),
    )
    expect((await get()).status).toBe(502)
    failing.mockRestore()

    const recovered = mockRead(() =>
      Promise.resolve(density({ coverage: 0.9, cells: [] })),
    )
    const res = await get()

    expect(res.status).toBe(200)
    expect(res.data.coverage).toBe(0.9)
    recovered.mockRestore()
  })

  it('refuses the 31st read from one address', async () => {
    const spy = mockRead(() =>
      Promise.resolve(density({ coverage: 0.1, cells: [] })),
    )

    for (let i = 0; i < 30; i++) {
      const allowed = await get(PERSON_ID, '10.3.0.1')
      expect(allowed.status).toBe(200)
    }

    const refused = await get(PERSON_ID, '10.3.0.1')

    expect(refused.status).toBe(429)
    spy.mockRestore()
  })
})
