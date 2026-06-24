import { useTestService } from '@/test-service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { FeaturesService } from '@/features/services/features.service'
import { describe, expect, it, vi } from 'vitest'

const service = useTestService()

const WIN_SLUG = 'campaign-win'
const EO_SLUG = 'eo-mayor'
const OTHER_OWNER_ID = 999
const ORG_SLUG_HEADER = 'X-Organization-Slug'

const PEOPLE_PAYLOAD = {
  people: [{ LALVOTERID: 'voter-1' }],
  pagination: { totalResults: 1, currentPage: 1, totalPages: 1 },
} as unknown as Awaited<ReturnType<ContactsService['findContacts']>>

const seedOrgWithCampaign = async (opts: {
  slug: string
  ownerId: number
  isPro: boolean
}) => {
  await service.prisma.organization.create({
    data: {
      slug: opts.slug,
      ownerId: opts.ownerId,
      overrideDistrictId: 'district-uuid',
    },
  })
  await service.prisma.campaign.create({
    data: {
      userId: opts.ownerId,
      slug: `${opts.slug}-campaign`,
      organizationSlug: opts.slug,
      isPro: opts.isPro,
    },
  })
}

describe('GET /v1/contacts authz + win-voter-data gating', () => {
  it('allows a pro Win campaign owner when win-voter-data is on', async () => {
    await seedOrgWithCampaign({
      slug: WIN_SLUG,
      ownerId: service.user.id,
      isPro: true,
    })
    const features = service.app.get(FeaturesService)
    const isFeatureEnabled = vi
      .spyOn(features, 'isFeatureEnabled')
      .mockResolvedValue(true)
    vi.spyOn(
      service.app.get(ContactsService),
      'findContacts',
    ).mockResolvedValue(PEOPLE_PAYLOAD)

    const result = await service.client.get('/v1/contacts', {
      headers: { [ORG_SLUG_HEADER]: WIN_SLUG },
    })

    expect(result.status).toBe(200)
    expect(result.data).toEqual(PEOPLE_PAYLOAD)
    expect(isFeatureEnabled).toHaveBeenCalledWith({
      user: expect.objectContaining({ id: service.user.id }),
      feature: 'win-voter-data',
    })
  })

  it('admits a non-pro Win campaign to the base list when the flag is on', async () => {
    await seedOrgWithCampaign({
      slug: WIN_SLUG,
      ownerId: service.user.id,
      isPro: false,
    })
    vi.spyOn(
      service.app.get(FeaturesService),
      'isFeatureEnabled',
    ).mockResolvedValue(true)
    const findContacts = vi
      .spyOn(service.app.get(ContactsService), 'findContacts')
      .mockResolvedValue(PEOPLE_PAYLOAD)

    const result = await service.client.get('/v1/contacts', {
      headers: { [ORG_SLUG_HEADER]: WIN_SLUG },
    })

    // Non-pro Win users see the aggregates + a blurred preview; the pro gate
    // moves to the per-action paths (search/segment in findContacts, download).
    expect(result.status).toBe(200)
    expect(findContacts).toHaveBeenCalled()
  })

  it('admits a non-pro Win campaign to district stats when the flag is on', async () => {
    await seedOrgWithCampaign({
      slug: WIN_SLUG,
      ownerId: service.user.id,
      isPro: false,
    })
    vi.spyOn(
      service.app.get(FeaturesService),
      'isFeatureEnabled',
    ).mockResolvedValue(true)
    const getDistrictStats = vi
      .spyOn(service.app.get(ContactsService), 'getDistrictStats')
      .mockResolvedValue(undefined as never)

    const result = await service.client.get('/v1/contacts/stats', {
      headers: { [ORG_SLUG_HEADER]: WIN_SLUG },
    })

    expect(result.status).toBe(200)
    expect(getDistrictStats).toHaveBeenCalled()
  })

  it('makes the Win path unreachable when win-voter-data is off', async () => {
    await seedOrgWithCampaign({
      slug: WIN_SLUG,
      ownerId: service.user.id,
      isPro: true,
    })
    vi.spyOn(
      service.app.get(FeaturesService),
      'isFeatureEnabled',
    ).mockResolvedValue(false)
    const findContacts = vi
      .spyOn(service.app.get(ContactsService), 'findContacts')
      .mockResolvedValue(PEOPLE_PAYLOAD)

    const result = await service.client.get('/v1/contacts', {
      headers: { [ORG_SLUG_HEADER]: WIN_SLUG },
    })

    expect(result.status).toBe(403)
    expect(findContacts).not.toHaveBeenCalled()
  })

  it('rejects a user who does not own the organization', async () => {
    await service.prisma.user.create({
      data: { id: OTHER_OWNER_ID, clerkId: 'user_other', email: 'o@gp.org' },
    })
    await seedOrgWithCampaign({
      slug: WIN_SLUG,
      ownerId: OTHER_OWNER_ID,
      isPro: true,
    })
    const isFeatureEnabled = vi
      .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
      .mockResolvedValue(true)

    const result = await service.client.get('/v1/contacts', {
      headers: { [ORG_SLUG_HEADER]: WIN_SLUG },
    })

    expect(result.status).toBe(404)
    // The ownership guard rejects before the flag gate is reached.
    expect(isFeatureEnabled).not.toHaveBeenCalled()
  })

  it('leaves elected-office access unchanged and unflagged', async () => {
    await service.prisma.organization.create({
      data: { slug: EO_SLUG, ownerId: service.user.id },
    })
    const isFeatureEnabled = vi
      .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
      .mockResolvedValue(false)
    vi.spyOn(
      service.app.get(ContactsService),
      'findContacts',
    ).mockResolvedValue(PEOPLE_PAYLOAD)

    const result = await service.client.get('/v1/contacts', {
      headers: { [ORG_SLUG_HEADER]: EO_SLUG },
    })

    expect(result.status).toBe(200)
    expect(result.data).toEqual(PEOPLE_PAYLOAD)
    // eo- orgs bypass the win-voter-data flag entirely.
    expect(isFeatureEnabled).not.toHaveBeenCalled()
  })

  // The gate is wired on all four contacts endpoints, but only listContacts
  // is covered above. A 403 with flag off + a pro org proves the gate runs on
  // these handlers too — only assertContactsAccess reads the flag, so no
  // pre-existing pro check could produce it. Each data method is stubbed so a
  // wiring regression fails as a clean non-403 instead of a real network call.
  const SOME_UUID = '00000000-0000-0000-0000-000000000000'
  const gatedEndpoints: Array<{
    name: string
    path: string
    serviceMethod: 'downloadContacts' | 'getDistrictStats' | 'findPerson'
  }> = [
    {
      name: 'download',
      path: '/v1/contacts/download',
      serviceMethod: 'downloadContacts',
    },
    {
      name: 'stats',
      path: '/v1/contacts/stats',
      serviceMethod: 'getDistrictStats',
    },
    {
      name: 'get by id',
      path: `/v1/contacts/${SOME_UUID}`,
      serviceMethod: 'findPerson',
    },
  ]

  it.each(gatedEndpoints)(
    'gates $name behind win-voter-data',
    async ({ path, serviceMethod }) => {
      await seedOrgWithCampaign({
        slug: WIN_SLUG,
        ownerId: service.user.id,
        isPro: true,
      })
      vi.spyOn(
        service.app.get(FeaturesService),
        'isFeatureEnabled',
      ).mockResolvedValue(false)
      const method = vi
        .spyOn(service.app.get(ContactsService), serviceMethod)
        .mockResolvedValue(undefined as never)

      const result = await service.client.get(path, {
        headers: { [ORG_SLUG_HEADER]: WIN_SLUG },
      })

      expect(result.status).toBe(403)
      expect(method).not.toHaveBeenCalled()
    },
  )
})
