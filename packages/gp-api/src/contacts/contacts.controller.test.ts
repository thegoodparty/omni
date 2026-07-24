import { useTestService } from '@/test-service'
import { ContactsService } from '@/contacts/services/contacts.service'
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

describe('GET /v1/contacts authz', () => {
  it('allows a pro Win campaign owner', async () => {
    await seedOrgWithCampaign({
      slug: WIN_SLUG,
      ownerId: service.user.id,
      isPro: true,
    })
    vi.spyOn(
      service.app.get(ContactsService),
      'findContacts',
    ).mockResolvedValue(PEOPLE_PAYLOAD)

    const result = await service.client.get('/v1/contacts', {
      headers: { [ORG_SLUG_HEADER]: WIN_SLUG },
    })

    expect(result.status).toBe(200)
    expect(result.data).toEqual(PEOPLE_PAYLOAD)
  })

  it('admits a non-pro Win campaign to the base list', async () => {
    await seedOrgWithCampaign({
      slug: WIN_SLUG,
      ownerId: service.user.id,
      isPro: false,
    })
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

  it('admits a non-pro Win campaign to district stats', async () => {
    await seedOrgWithCampaign({
      slug: WIN_SLUG,
      ownerId: service.user.id,
      isPro: false,
    })
    const getDistrictStats = vi
      .spyOn(service.app.get(ContactsService), 'getDistrictStats')
      .mockResolvedValue(undefined as never)

    const result = await service.client.get('/v1/contacts/stats', {
      headers: { [ORG_SLUG_HEADER]: WIN_SLUG },
    })

    expect(result.status).toBe(200)
    expect(getDistrictStats).toHaveBeenCalled()
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

    const result = await service.client.get('/v1/contacts', {
      headers: { [ORG_SLUG_HEADER]: WIN_SLUG },
    })

    expect(result.status).toBe(404)
  })

  it('allows elected-office access', async () => {
    await service.prisma.organization.create({
      data: { slug: EO_SLUG, ownerId: service.user.id },
    })
    vi.spyOn(
      service.app.get(ContactsService),
      'findContacts',
    ).mockResolvedValue(PEOPLE_PAYLOAD)

    const result = await service.client.get('/v1/contacts', {
      headers: { [ORG_SLUG_HEADER]: EO_SLUG },
    })

    expect(result.status).toBe(200)
    expect(result.data).toEqual(PEOPLE_PAYLOAD)
  })

  it('returns the live count for an in-progress filter set (ENG-10517)', async () => {
    await seedOrgWithCampaign({
      slug: WIN_SLUG,
      ownerId: service.user.id,
      isPro: true,
    })
    const countContacts = vi
      .spyOn(service.app.get(ContactsService), 'countContacts')
      .mockResolvedValue(742)

    const result = await service.client.post(
      '/v1/contacts/count',
      { partyDemocrat: true },
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(201)
    expect(result.data).toEqual({ count: 742 })
    expect(countContacts).toHaveBeenCalledWith(
      expect.objectContaining({ partyDemocrat: true }),
      expect.objectContaining({ slug: WIN_SLUG }),
    )
  })

  it('returns the list-detail demographics/reachability/history payload (ENG-10706)', async () => {
    await seedOrgWithCampaign({
      slug: WIN_SLUG,
      ownerId: service.user.id,
      isPro: true,
    })
    const payload: Awaited<ReturnType<ContactsService['getListDetail']>> = {
      demographics: { people: 100, avgAge: 42, avgIncome: 55000 },
      reachability: {
        sms: 60,
        robocall: 60,
        phoneBanking: 60,
        doorKnocking: 30,
        polls: 60,
      },
      outreachHistory: [],
    }
    const getListDetail = vi
      .spyOn(service.app.get(ContactsService), 'getListDetail')
      .mockResolvedValue(payload)

    const result = await service.client.get(
      '/v1/contacts/list-detail?segment=42',
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(200)
    expect(result.data).toEqual(payload)
    expect(getListDetail).toHaveBeenCalledWith(
      expect.objectContaining({ segment: 42 }),
      expect.objectContaining({ slug: WIN_SLUG }),
    )
  })
})
