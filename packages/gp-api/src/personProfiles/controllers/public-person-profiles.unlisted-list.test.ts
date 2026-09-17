import { useTestService } from '@/test-service'
import { describe, expect, it, vi } from 'vitest'

const service = useTestService()

const REMOVED_PERSON_ID = '55555555-5555-4555-8555-555555555555'
const SECOND_REMOVED_PERSON_ID = '66666666-6666-4666-8666-666666666666'
const DELETED_PERSON_ID = '77777777-7777-4777-8777-777777777777'
const LIVE_PERSON_ID = '88888888-8888-4888-8888-888888888888'

const UNLISTED_LIST = '/v1/public-person-profiles/unlisted'

const seedRemoval = (personId: string, note?: string) =>
  service.prisma.personProfileRemoval.create({
    data: { personId, appliedBy: 'ops@goodparty.org', note: note ?? null },
  })

// A takedown that ops has since reverted. The row survives as the audit trail,
// which is exactly why this feed cannot match on row existence.
const seedClearedRemoval = (personId: string) =>
  service.prisma.personProfileRemoval.create({
    data: {
      personId,
      appliedBy: 'ops@goodparty.org',
      clearedAt: new Date(),
      clearedBy: 'ops@goodparty.org',
    },
  })

// PersonProfile is 1:1 with User, so every extra profile needs its own owner.
const seedProfile = async (
  personId: string,
  overrides: { publishedAt?: Date | null; deletedAt?: Date | null } = {},
) => {
  const owner = await service.prisma.user.create({
    data: { clerkId: `user_${personId}`, email: `${personId}@goodparty.org` },
  })
  return service.prisma.personProfile.create({
    data: {
      personId,
      userId: owner.id,
      publishedAt: new Date(),
      ...overrides,
    },
  })
}

const personIds = (data: Array<{ personId: string }>) =>
  data.map(({ personId }) => personId).sort()

describe('GET /v1/public-person-profiles/unlisted', () => {
  it('returns every personId with a removal on record', async () => {
    await seedRemoval(REMOVED_PERSON_ID)
    await seedRemoval(SECOND_REMOVED_PERSON_ID)

    const res = await service.client.get(UNLISTED_LIST)

    expect(res.status).toBe(200)
    expect(personIds(res.data)).toEqual(
      [REMOVED_PERSON_ID, SECOND_REMOVED_PERSON_ID].sort(),
    )
  })

  it('drops a person whose takedown was reverted', async () => {
    // Soft-clearing keeps the row forever. If this feed ignored clearedAt the
    // person would stay out of the sitemap permanently even though their page
    // renders again — an un-undoable delisting.
    await seedClearedRemoval(REMOVED_PERSON_ID)

    const res = await service.client.get(UNLISTED_LIST)

    expect(res.status).toBe(200)
    expect(res.data).toEqual([])
  })

  it('keeps an active takedown while excluding a reverted one', async () => {
    await seedRemoval(REMOVED_PERSON_ID)
    await seedClearedRemoval(SECOND_REMOVED_PERSON_ID)

    const res = await service.client.get(UNLISTED_LIST)

    expect(res.status).toBe(200)
    expect(personIds(res.data)).toEqual([REMOVED_PERSON_ID])
  })

  it('returns a person whose profile the owner deleted', async () => {
    // The deleted overlay answers 410 on the per-person route, which the
    // marketing loader renders as a 404 — a URL the sitemap must not carry.
    await seedProfile(DELETED_PERSON_ID, { deletedAt: new Date() })

    const res = await service.client.get(UNLISTED_LIST)

    expect(res.status).toBe(200)
    expect(personIds(res.data)).toEqual([DELETED_PERSON_ID])
  })

  it('returns a person who is both removed and deleted exactly once', async () => {
    await seedProfile(REMOVED_PERSON_ID, { deletedAt: new Date() })
    await seedRemoval(REMOVED_PERSON_ID)

    const res = await service.client.get(UNLISTED_LIST)

    expect(res.status).toBe(200)
    expect(res.data).toHaveLength(1)
    expect(res.data[0].personId).toBe(REMOVED_PERSON_ID)
  })

  it('excludes a published person with no removal and no deletion', async () => {
    await seedProfile(LIVE_PERSON_ID)

    const res = await service.client.get(UNLISTED_LIST)

    expect(res.status).toBe(200)
    expect(res.data).toEqual([])
  })

  it('returns an empty list when nothing is unlisted', async () => {
    const res = await service.client.get(UNLISTED_LIST)

    expect(res.status).toBe(200)
    expect(res.data).toEqual([])
  })

  it('lists an unlisted person who has no profile row', async () => {
    // The removal table is keyed by civics personId precisely because most
    // removals are for unclaimed people. If this feed only surfaced persons
    // with an overlay, the sitemap would advertise the ones who need it least.
    await seedRemoval(REMOVED_PERSON_ID)

    const res = await service.client.get(UNLISTED_LIST)

    expect(res.status).toBe(200)
    expect(res.data).toHaveLength(1)
    expect(res.data[0].personId).toBe(REMOVED_PERSON_ID)
  })

  it('carries the personId only', async () => {
    await seedRemoval(REMOVED_PERSON_ID, 'court order re: Jane Rivera')
    await seedProfile(DELETED_PERSON_ID, { deletedAt: new Date() })

    const res = await service.client.get(UNLISTED_LIST)

    expect(res.status).toBe(200)
    expect(res.data).toHaveLength(2)
    for (const row of res.data) {
      expect(Object.keys(row)).toEqual(['personId'])
    }
    // The note is free text an ops user typed about a privacy request — the
    // one field on that table that can carry PII, on an unauthenticated route.
    expect(res.data.some((row: { note?: string }) => row.note)).toBe(false)
  })

  it('serves the list without a session', async () => {
    await seedRemoval(REMOVED_PERSON_ID)

    const res = await service.client.get(UNLISTED_LIST, {
      headers: { Authorization: 'Bearer not-a-valid-token' },
    })

    expect(res.status).toBe(200)
    expect(res.data).toHaveLength(1)
  })

  it('caps both sides of the union at the sitemap URL ceiling', async () => {
    await seedRemoval(REMOVED_PERSON_ID)
    await seedProfile(DELETED_PERSON_ID, { deletedAt: new Date() })
    // Seeding 50k rows to observe the cap is not worth the wall clock, so pin
    // it on the queries instead: an unpaginated public route that drops its
    // `take` serializes whole tables into the heap.
    const removals = vi.spyOn(service.prisma.personProfileRemoval, 'findMany')
    const profiles = vi.spyOn(service.prisma.personProfile, 'findMany')

    const res = await service.client.get(UNLISTED_LIST)

    expect(res.status).toBe(200)
    expect(removals).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50_000 }),
    )
    expect(profiles).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50_000 }),
    )
    removals.mockRestore()
    profiles.mockRestore()
  })
})
