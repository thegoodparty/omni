import { useTestService } from '@/test-service'
import { describe, expect, it, vi } from 'vitest'

const service = useTestService()

const REMOVED_PERSON_ID = '55555555-5555-4555-8555-555555555555'
const SECOND_REMOVED_PERSON_ID = '66666666-6666-4666-8666-666666666666'
const LIVE_PERSON_ID = '77777777-7777-4777-8777-777777777777'

const REMOVED_LIST = '/v1/public-person-profiles/removed'

const seedRemoval = (personId: string, note?: string) =>
  service.prisma.personProfileRemoval.create({
    data: { personId, note: note ?? null },
  })

describe('GET /v1/public-person-profiles/removed', () => {
  it('returns every personId with a removal on record', async () => {
    await seedRemoval(REMOVED_PERSON_ID)
    await seedRemoval(SECOND_REMOVED_PERSON_ID)

    const res = await service.client.get(REMOVED_LIST)

    expect(res.status).toBe(200)
    expect(
      res.data.map((r: { personId: string }) => r.personId).sort(),
    ).toEqual([REMOVED_PERSON_ID, SECOND_REMOVED_PERSON_ID].sort())
  })

  it('returns an empty list when nothing has been removed', async () => {
    const res = await service.client.get(REMOVED_LIST)

    expect(res.status).toBe(200)
    expect(res.data).toEqual([])
  })

  it('lists a removed person who has no profile row', async () => {
    // The removal table is keyed by civics personId precisely because most
    // removals are for unclaimed people. If this feed only surfaced persons
    // with an overlay, the sitemap would advertise the ones who need it least.
    await seedRemoval(REMOVED_PERSON_ID)

    const res = await service.client.get(REMOVED_LIST)

    expect(res.status).toBe(200)
    expect(res.data).toHaveLength(1)
    expect(res.data[0].personId).toBe(REMOVED_PERSON_ID)
  })

  it('excludes a person with a live profile and no removal', async () => {
    await service.prisma.personProfile.create({
      data: {
        personId: LIVE_PERSON_ID,
        userId: service.user.id,
        publishedAt: new Date(),
      },
    })

    const res = await service.client.get(REMOVED_LIST)

    expect(res.status).toBe(200)
    expect(res.data).toEqual([])
  })

  it('carries identity + freshness only, never the ops note', async () => {
    await seedRemoval(REMOVED_PERSON_ID, 'court order re: Jane Rivera')

    const res = await service.client.get(REMOVED_LIST)

    expect(res.status).toBe(200)
    expect(Object.keys(res.data[0]).sort()).toEqual(['personId', 'updatedAt'])
    // The note is free text an ops user typed about a privacy request — the
    // one field on this table that can carry PII, on an unauthenticated route.
    expect(res.data[0].note).toBeUndefined()
    expect(res.data[0].id).toBeUndefined()
    expect(res.data[0].requestedAt).toBeUndefined()
  })

  it('serves the list without a session', async () => {
    await seedRemoval(REMOVED_PERSON_ID)

    const res = await service.client.get(REMOVED_LIST, {
      headers: { Authorization: 'Bearer not-a-valid-token' },
    })

    expect(res.status).toBe(200)
    expect(res.data).toHaveLength(1)
  })

  it('caps the query at the sitemap URL ceiling', async () => {
    await seedRemoval(REMOVED_PERSON_ID)
    // Seeding 50k rows to observe the cap is not worth the wall clock, so pin
    // it on the query instead: an unpaginated public route that drops its
    // `take` serializes the whole table into the heap.
    const findMany = vi.spyOn(service.prisma.personProfileRemoval, 'findMany')

    const res = await service.client.get(REMOVED_LIST)

    expect(res.status).toBe(200)
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50_000 }),
    )
    findMany.mockRestore()
  })
})
