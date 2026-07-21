import { HttpService } from '@nestjs/axios'
import { of } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'

// ENG-10752: the count route runs the same convertVoterFileFilterToFilters
// translation the saved-segment list/download paths use, so pinning the
// forwarded people-api payload here pins the query bounds for all of them —
// new keys carry the mutually exclusive bounds, retired keys keep the exact
// bounds existing saved filters were created with.
describe('POST /v1/contacts/count age filter bounds', () => {
  const setupOrg = async (suffix: string) => {
    const slug = `eo-age-bounds-${suffix}-${Date.now()}`
    await service.prisma.organization.create({
      data: {
        slug,
        ownerId: service.user.id,
        overrideDistrictId: `district-age-bounds-${suffix}`,
      },
    })
    return slug
  }

  const spyOnPeopleApi = () =>
    vi
      .spyOn(service.app.get(HttpService), 'post')
      .mockReturnValue(
        of({ data: { pagination: { totalResults: 3 } } }) as never,
      )

  it('forwards a new age key with its mutually exclusive bounds', async () => {
    const slug = await setupOrg('new')
    const postSpy = spyOnPeopleApi()

    const response = await service.client.post(
      '/v1/contacts/count',
      { age25_34: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    expect(response.status).toBe(201)
    expect(response.data).toEqual({ count: 3 })
    expect(postSpy).toHaveBeenCalledTimes(1)
    expect(postSpy.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ filters: { ageInt: { gte: 25, lte: 34 } } }),
    )
  })

  it('forwards a retired age key with its original overlapping bounds', async () => {
    const slug = await setupOrg('legacy')
    const postSpy = spyOnPeopleApi()

    const response = await service.client.post(
      '/v1/contacts/count',
      { age18_25: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    expect(response.status).toBe(201)
    expect(response.data).toEqual({ count: 3 })
    expect(postSpy).toHaveBeenCalledTimes(1)
    expect(postSpy.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ filters: { ageInt: { gte: 18, lte: 25 } } }),
    )
  })

  it('persists and reads back a saved filter carrying the new age columns', async () => {
    const slug = await setupOrg('saved')

    const created = await service.client.post(
      '/v1/voters/voter-file/filter',
      { name: 'Seniors', age65Plus: true, age50_64: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    expect(created.status).toBe(201)
    expect(created.data.age65Plus).toBe(true)
    expect(created.data.age50_64).toBe(true)
    expect(created.data.age18_25).toBe(false)

    const row = await service.prisma.voterFileFilter.findUniqueOrThrow({
      where: { id: created.data.id },
    })
    expect(row.age65Plus).toBe(true)
    expect(row.age50_64).toBe(true)
  })
})
