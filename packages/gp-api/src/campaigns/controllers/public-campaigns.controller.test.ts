import { useTestService } from '@/test-service'
import { ClerkUserEnricherService } from '@/vendors/clerk/services/clerk-user-enricher.service'
import { WebsiteStatus } from '../../generated/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const service = useTestService()

const MONICA_SLUG = 'monica-alponte'
const MONICA_RACE = 'race-monica'
const MONICA = { firstName: 'Monica', lastName: 'Alponte' }
const MONICA_PHOTO = 'https://clerk.example/monica.jpg'

const seedCampaign = async (args: {
  id: number
  slug: string
  raceId: string
  isActive: boolean
  details?: {
    party?: string
    einNumber?: string
    subscriptionId?: string
    campaignCommittee?: string
    officeTermLength?: string | number | null
    customIssues?: Array<Record<string, string | number>>
  }
}) => {
  const organizationSlug = `org-${args.id}`
  await service.prisma.organization.create({
    data: { slug: organizationSlug, ownerId: service.user.id },
  })
  return service.prisma.campaign.create({
    data: {
      id: args.id,
      organizationSlug,
      userId: service.user.id,
      slug: args.slug,
      isActive: args.isActive,
      // PrismaJson.CampaignDetails declares officeTermLength as a string and
      // customIssues as all-string records. It is a shadow type over a JSON
      // column, not a constraint, and production disagrees with it on both
      // counts — which is the whole reason these cases exist. Seed the shape
      // the column actually holds.
      details: {
        raceId: args.raceId,
        ...args.details,
      } as PrismaJson.CampaignDetails,
    },
  })
}

const find = (params: {
  raceId?: string
  firstName?: string
  lastName?: string
}) => service.client.get('/v1/public-campaigns', { params })

describe('GET /v1/public-campaigns', () => {
  // The endpoint resolves the candidate's avatar through Clerk; by default
  // pass the owner through untouched so the seeded (photo-less) state stands.
  beforeEach(() => {
    const enricher = service.app.get(ClerkUserEnricherService)
    vi.spyOn(enricher, 'enrichUser').mockImplementation(async (user) => user)
  })

  it('returns the active campaign matching raceId + candidate name', async () => {
    await seedCampaign({
      id: 1,
      slug: MONICA_SLUG,
      raceId: MONICA_RACE,
      isActive: true,
    })

    const res = await find({
      raceId: MONICA_RACE,
      ...MONICA,
    })

    expect(res.status).toBe(200)
    expect(res.data.slug).toBe(MONICA_SLUG)
  })

  it('404s when no campaign matches the raceId (unclaimed)', async () => {
    const res = await find({
      raceId: 'race-ariel',
      firstName: 'Ariel',
      lastName: 'Rofeim',
    })

    expect(res.status).toBe(404)
  })

  it('404s when the matching campaign is not active', async () => {
    await seedCampaign({
      id: 2,
      slug: MONICA_SLUG,
      raceId: MONICA_RACE,
      isActive: false,
    })

    const res = await find({
      raceId: MONICA_RACE,
      ...MONICA,
    })

    expect(res.status).toBe(404)
  })

  it('404s when raceId matches but the name does not match the slug', async () => {
    await seedCampaign({
      id: 3,
      slug: MONICA_SLUG,
      raceId: MONICA_RACE,
      isActive: true,
    })

    const res = await find({
      raceId: MONICA_RACE,
      firstName: 'Someone',
      lastName: 'Else',
    })

    expect(res.status).toBe(404)
  })

  it('matches a campaign whose slug carries a collision counter (mike-vick1)', async () => {
    await seedCampaign({
      id: 10,
      slug: 'mike-vick1',
      raceId: 'race-vick',
      isActive: true,
    })

    const res = await find({
      raceId: 'race-vick',
      firstName: 'Mike',
      lastName: 'Vick',
    })

    expect(res.status).toBe(200)
    expect(res.data.slug).toBe('mike-vick1')
  })

  // Exercises the stripping path itself: the counter is stripped off `vic2`,
  // and the resulting `vic` must still not satisfy a lookup for `vick`.
  it('does not let the collision-counter fallback match an unrelated last name', async () => {
    await seedCampaign({
      id: 11,
      slug: 'mike-vic2',
      raceId: 'race-vic2',
      isActive: true,
    })

    const res = await find({
      raceId: 'race-vic2',
      firstName: 'Mike',
      lastName: 'Vick',
    })

    expect(res.status).toBe(404)
  })

  it('disambiguates by first name when two active campaigns share raceId + last name', async () => {
    await seedCampaign({
      id: 4,
      slug: 'john-smith',
      raceId: 'race-smith',
      isActive: true,
    })
    await seedCampaign({
      id: 5,
      slug: 'jane-smith',
      raceId: 'race-smith',
      isActive: true,
    })

    const res = await find({
      raceId: 'race-smith',
      firstName: 'Jane',
      lastName: 'Smith',
    })

    expect(res.status).toBe(200)
    expect(res.data.slug).toBe('jane-smith')
  })

  it('strips sensitive details fields from the public response', async () => {
    await seedCampaign({
      id: 6,
      slug: MONICA_SLUG,
      raceId: MONICA_RACE,
      isActive: true,
      details: {
        party: 'Independent',
        einNumber: '12-3456789',
        subscriptionId: 'sub_secret123',
        campaignCommittee: 'Friends of Monica',
      },
    })

    const res = await find({
      raceId: MONICA_RACE,
      ...MONICA,
    })

    expect(res.status).toBe(200)
    expect(res.data.details.party).toBe('Independent')
    expect(res.data.details.einNumber).toBeUndefined()
    expect(res.data.details.subscriptionId).toBeUndefined()
    expect(res.data.details.campaignCommittee).toBeUndefined()
  })

  // Regression: `officeTermLength` is declared z.string(), but roughly half of
  // all active campaigns store the legacy bare-number form. Every one of them
  // failed response validation, so the endpoint 500d instead of answering.
  it('serves a campaign whose officeTermLength is a legacy number', async () => {
    await seedCampaign({
      id: 20,
      slug: MONICA_SLUG,
      raceId: MONICA_RACE,
      isActive: true,
      details: { officeTermLength: 4, einNumber: '12-3456789' },
    })

    const res = await find({ raceId: MONICA_RACE, ...MONICA })

    expect(res.status).toBe(200)
    expect(res.data.details.officeTermLength).toBe('4')
    // Coercing the value must not weaken the whitelist around it.
    expect(res.data.details.einNumber).toBeUndefined()
  })

  it('leaves the modern string officeTermLength untouched', async () => {
    await seedCampaign({
      id: 21,
      slug: MONICA_SLUG,
      raceId: MONICA_RACE,
      isActive: true,
      details: { officeTermLength: '4 years' },
    })

    const res = await find({ raceId: MONICA_RACE, ...MONICA })

    expect(res.status).toBe(200)
    expect(res.data.details.officeTermLength).toBe('4 years')
  })

  // No row stores a null term length today, but `details` is free-form JSON
  // that holds nulls in other keys, and coercing one to the string "null"
  // would be worse than passing it through.
  it('passes a null officeTermLength through as null', async () => {
    await seedCampaign({
      id: 23,
      slug: MONICA_SLUG,
      raceId: MONICA_RACE,
      isActive: true,
      details: { officeTermLength: null },
    })

    const res = await find({ raceId: MONICA_RACE, ...MONICA })

    expect(res.status).toBe(200)
    expect(res.data.details.officeTermLength).toBeNull()
  })

  // Legacy customIssues entries carry a numeric `order` alongside the strings.
  it('serves customIssues carrying a legacy numeric order', async () => {
    await seedCampaign({
      id: 22,
      slug: MONICA_SLUG,
      raceId: MONICA_RACE,
      isActive: true,
      details: {
        customIssues: [{ title: 'Roads', position: 'Fix them', order: 0 }],
      },
    })

    const res = await find({ raceId: MONICA_RACE, ...MONICA })

    expect(res.status).toBe(200)
    expect(res.data.details.customIssues).toEqual([
      { title: 'Roads', position: 'Fix them', order: 0 },
    ])
  })

  it('omits an unpublished (draft) website from the public response', async () => {
    await seedCampaign({
      id: 7,
      slug: MONICA_SLUG,
      raceId: MONICA_RACE,
      isActive: true,
    })
    await service.prisma.website.create({
      data: {
        campaignId: 7,
        vanityPath: 'monica-draft',
        status: WebsiteStatus.unpublished,
        content: { contact: { email: 'draft@example.com' } },
      },
    })

    const res = await find({ raceId: MONICA_RACE, ...MONICA })

    expect(res.status).toBe(200)
    // A draft site (and its pre-seeded contact/bio content) must not leak via
    // this @PublicAccess() path.
    expect(res.data.website).toBeNull()
  })

  it('returns the website once it is published', async () => {
    await seedCampaign({
      id: 8,
      slug: MONICA_SLUG,
      raceId: MONICA_RACE,
      isActive: true,
    })
    await service.prisma.website.create({
      data: {
        campaignId: 8,
        vanityPath: 'monica-live',
        status: WebsiteStatus.published,
        content: { contact: { email: 'live@example.com' } },
      },
    })

    const res = await find({ raceId: MONICA_RACE, ...MONICA })

    expect(res.status).toBe(200)
    expect(res.data.website).not.toBeNull()
    expect(res.data.website.status).toBe('published')
    // Published content must round-trip intact (the gate only suppresses drafts).
    expect(res.data.website.content).toMatchObject({
      contact: { email: 'live@example.com' },
    })
  })

  it('400s when a required query param is missing', async () => {
    const res = await find({
      raceId: MONICA_RACE,
      firstName: MONICA.firstName,
    })

    expect(res.status).toBe(400)
  })

  it('returns the claimed candidate uploaded photo when Clerk has one', async () => {
    const enricher = service.app.get(ClerkUserEnricherService)
    vi.spyOn(enricher, 'enrichUser').mockImplementation(async (user) => ({
      ...user,
      avatar: MONICA_PHOTO,
    }))
    await seedCampaign({
      id: 7,
      slug: MONICA_SLUG,
      raceId: MONICA_RACE,
      isActive: true,
    })

    const res = await find({ raceId: MONICA_RACE, ...MONICA })

    expect(res.status).toBe(200)
    expect(res.data.avatar).toBe(MONICA_PHOTO)
  })

  it('returns a null avatar when the claimed candidate has no uploaded photo', async () => {
    const enricher = service.app.get(ClerkUserEnricherService)
    vi.spyOn(enricher, 'enrichUser').mockImplementation(async (user) => ({
      ...user,
      avatar: null,
    }))
    await seedCampaign({
      id: 8,
      slug: MONICA_SLUG,
      raceId: MONICA_RACE,
      isActive: true,
    })

    const res = await find({ raceId: MONICA_RACE, ...MONICA })

    expect(res.status).toBe(200)
    expect(res.data.avatar).toBeNull()
  })
})
