import { randomUUID } from 'node:crypto'
import { useTestService } from '@/test-service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { ElectionsService } from '@/elections/services/elections.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { HttpService } from '@nestjs/axios'
import { of } from 'rxjs'
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
      .mockResolvedValue({ count: 742 })

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

  it('accepts a segment-less list-detail request for the universe row (ENG-10778)', async () => {
    await seedOrgWithCampaign({
      slug: WIN_SLUG,
      ownerId: service.user.id,
      isPro: true,
    })
    const payload: Awaited<ReturnType<ContactsService['getListDetail']>> = {
      demographics: { people: 85696, avgAge: 47, avgIncome: 61000 },
      reachability: {
        sms: 60000,
        robocall: 60000,
        phoneBanking: 45000,
        doorKnocking: 30000,
        polls: 60000,
      },
      outreachHistory: [],
    }
    const getListDetail = vi
      .spyOn(service.app.get(ContactsService), 'getListDetail')
      .mockResolvedValue(payload)

    const result = await service.client.get('/v1/contacts/list-detail', {
      headers: { [ORG_SLUG_HEADER]: WIN_SLUG },
    })

    // Response validates against ListDetailContactsResponseSchema (the
    // global ZodResponseInterceptor would 500 otherwise).
    expect(result.status).toBe(200)
    expect(result.data).toEqual(payload)
    // No `segment` key at all — a bare `{}`, not `{ segment: undefined }`
    // (Zod's `.optional()` on a missing query param omits the key).
    expect(getListDetail.mock.calls[0]?.[0]).not.toHaveProperty('segment')
    expect(getListDetail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ slug: WIN_SLUG }),
    )
  })

  // DATA-2245: a Win org's congressional position routes onto the adopted
  // 2026 proposed map (Serve stays on the current map — covered at the unit
  // level in districtRouting.service.test.ts). Drives POST /v1/contacts/count
  // through the real routing path (resolveDistrictInfoFromOrg ->
  // DistrictRoutingService.routeWinDistrict), asserting the *proposed*
  // district id is what reaches VoterQueryService — the thing routing
  // actually changes. Position resolution is stubbed on ElectionsService
  // directly (the convention organizations.controller.test.ts uses); the
  // districts-list lookup behind findProposedCongressionalDistrict is left
  // to run for real against a stubbed HttpService.get, per the brief.
  it('routes a Win congressional district to the adopted 2026 map', async () => {
    // A prior test in this file leaves ContactsService.countContacts spied
    // with a canned resolved value (clearMocks only clears call history, not
    // the installed implementation, and the service instance is shared for
    // the whole file). This test needs the real countContacts implementation
    // to exercise routing, so restore it first.
    vi.spyOn(service.app.get(ContactsService), 'countContacts').mockRestore()

    const positionId = 'br-pos-oh-4'
    const currentDistrict = {
      // The ported people-db DTOs run through Zod, whose districtId is
      // z.guid() — a non-UUID placeholder like 'current-oh-4' fails
      // validation once it reaches ListPeopleDTO.
      id: randomUUID(),
      state: 'OH',
      L2DistrictType: 'US_Congressional_District',
      L2DistrictName: '4',
      projectedTurnout: null,
    }
    const proposedDistrict = {
      id: randomUUID(),
      state: 'OH',
      L2DistrictType: 'Proposed_District',
      L2DistrictName: '2026 PROPOSED CONG DIST 04 (EST.)',
      projectedTurnout: null,
    }

    vi.spyOn(
      service.app.get(ElectionsService),
      'getPositionById',
    ).mockResolvedValue({
      id: positionId,
      brPositionId: positionId,
      brDatabaseId: 'br-db-oh-4',
      state: 'OH',
      name: 'U.S. House',
      district: currentDistrict,
    })
    vi.spyOn(service.app.get(HttpService), 'get').mockReturnValue(
      of({ data: [proposedDistrict], status: 200 }) as never,
    )

    await service.prisma.organization.create({
      data: { slug: WIN_SLUG, ownerId: service.user.id, positionId },
    })
    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `${WIN_SLUG}-campaign`,
        organizationSlug: WIN_SLUG,
        isPro: true,
      },
    })

    const findPeople = vi
      .spyOn(service.app.get(VoterQueryService), 'findPeople')
      .mockResolvedValue({
        pagination: {
          totalResults: 0,
          currentPage: 1,
          pageSize: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
        people: [],
      })

    const result = await service.client.post(
      '/v1/contacts/count',
      {},
      { headers: { [ORG_SLUG_HEADER]: WIN_SLUG } },
    )

    expect(result.status).toBe(201)
    expect(findPeople).toHaveBeenCalledWith(
      expect.objectContaining({ districtId: proposedDistrict.id }),
    )
  })
})
