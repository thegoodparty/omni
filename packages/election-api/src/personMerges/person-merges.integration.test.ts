import { beforeEach, describe, expect, it } from 'vitest'
import { useTestService } from '../test-service'

const service = useTestService()

// One surviving person absorbing three duplicates — the normal shape of a
// purge. Ids are ordered so the keyset cursor's tiebreak is observable.
const SURVIVOR_ID = '11111111-1111-1111-1111-111111111111'
const RETIRED_1 = 'aaaaaaaa-1111-1111-1111-111111111111'
const RETIRED_2 = 'bbbbbbbb-1111-1111-1111-111111111111'
const RETIRED_3 = 'cccccccc-1111-1111-1111-111111111111'

// The first two land in one ETL batch and therefore share a timestamp — the
// case a plain `?since=` cursor cannot page through.
const BATCH_AT = '2026-09-01T00:00:00.000Z'
const LATER_AT = '2026-09-02T00:00:00.000Z'

const seedMerges = async () => {
  await service.prisma.person.create({
    data: {
      id: SURVIVOR_ID,
      slug: 'jane-doe-11111111',
      fullName: 'Jane Doe',
      state: 'CA',
    },
  })

  await service.prisma.personMerge.createMany({
    data: [
      {
        retiredId: RETIRED_1,
        survivingId: SURVIVOR_ID,
        retiredSlug: 'jane-d-aaaaaaaa',
        retiredAt: new Date(BATCH_AT),
      },
      {
        retiredId: RETIRED_2,
        survivingId: SURVIVOR_ID,
        retiredSlug: 'j-doe-bbbbbbbb',
        retiredAt: new Date(BATCH_AT),
      },
      {
        retiredId: RETIRED_3,
        survivingId: SURVIVOR_ID,
        retiredSlug: 'jane-doe-cccccccc',
        retiredAt: new Date(LATER_AT),
      },
    ],
  })
}

describe('GET /v1/person-merges (retirement feed)', () => {
  beforeEach(seedMerges)

  it('returns every retirement in keyset order', async () => {
    const res = await service.client.get('/v1/person-merges')

    expect(res.status).toBe(200)
    expect(res.data.map((m: { retiredId: string }) => m.retiredId)).toEqual([
      RETIRED_1,
      RETIRED_2,
      RETIRED_3,
    ])
    expect(res.data[0]).toMatchObject({
      retiredId: RETIRED_1,
      survivingId: SURVIVOR_ID,
      retiredSlug: 'jane-d-aaaaaaaa',
    })
  })

  it('reports many duplicates collapsing into one survivor', async () => {
    const res = await service.client.get('/v1/person-merges')

    const survivors = new Set(
      res.data.map((m: { survivingId: string }) => m.survivingId),
    )
    expect(res.data).toHaveLength(3)
    expect(survivors).toEqual(new Set([SURVIVOR_ID]))
  })

  it('pages through a batch sharing one timestamp without skipping or repeating', async () => {
    // This is the whole reason the cursor is (retiredAt, retiredId): with a
    // timestamp alone, a consumer that stopped after RETIRED_1 would either
    // re-read it forever or skip RETIRED_2.
    const first = await service.client.get('/v1/person-merges?limit=1')
    expect(first.data.map((m: { retiredId: string }) => m.retiredId)).toEqual([
      RETIRED_1,
    ])

    const second = await service.client.get(
      `/v1/person-merges?since=${BATCH_AT}&sinceId=${RETIRED_1}&limit=1`,
    )
    expect(second.data.map((m: { retiredId: string }) => m.retiredId)).toEqual([
      RETIRED_2,
    ])

    const third = await service.client.get(
      `/v1/person-merges?since=${BATCH_AT}&sinceId=${RETIRED_2}&limit=1`,
    )
    expect(third.data.map((m: { retiredId: string }) => m.retiredId)).toEqual([
      RETIRED_3,
    ])

    const done = await service.client.get(
      `/v1/person-merges?since=${LATER_AT}&sinceId=${RETIRED_3}&limit=1`,
    )
    expect(done.data).toEqual([])
  })

  it('takes the whole boundary timestamp when resuming without a tiebreak', async () => {
    const res = await service.client.get(`/v1/person-merges?since=${BATCH_AT}`)
    expect(res.data).toHaveLength(3)
  })

  it('400s a sinceId with no since', async () => {
    const res = await service.client.get(
      `/v1/person-merges?sinceId=${RETIRED_1}`,
    )
    expect(res.status).toBe(400)
  })

  it('400s an unknown query param', async () => {
    const res = await service.client.get('/v1/person-merges?cursor=abc')
    expect(res.status).toBe(400)
  })
})

describe('GET /v1/person-merges/:retiredId', () => {
  beforeEach(seedMerges)

  it('resolves a retired id to its survivor', async () => {
    const res = await service.client.get(`/v1/person-merges/${RETIRED_1}`)

    expect(res.status).toBe(200)
    expect(res.data).toMatchObject({
      retiredId: RETIRED_1,
      survivingId: SURVIVOR_ID,
    })
  })

  it('404s an id that was never retired', async () => {
    const res = await service.client.get(`/v1/person-merges/${SURVIVOR_ID}`)
    expect(res.status).toBe(404)
  })

  it('400s a non-UUID', async () => {
    const res = await service.client.get('/v1/person-merges/not-a-uuid')
    expect(res.status).toBe(400)
  })

  it('hands back the terminal survivor, never an id that was itself purged', async () => {
    // A consumer repointing its own rows must not be sent to a dead id.
    const OLDEST = 'dddddddd-1111-1111-1111-111111111111'
    await service.prisma.personMerge.create({
      data: {
        retiredId: OLDEST,
        survivingId: RETIRED_1,
        retiredSlug: 'jane-dddddddd',
        retiredAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    })

    const res = await service.client.get(`/v1/person-merges/${OLDEST}`)

    expect(res.status).toBe(200)
    expect(res.data.survivingId).toBe(SURVIVOR_ID)
  })
})
