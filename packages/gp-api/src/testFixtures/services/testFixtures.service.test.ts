import { CrmCampaignsService } from '@/campaigns/services/crmCampaigns.service'
import { RacesService } from '@/elections/services/races.service'
import { ElectionsService } from '@/elections/services/elections.service'
import { useTestService } from '@/test-service'
import { CLERK_CLIENT_PROVIDER_TOKEN } from '@/vendors/clerk/providers/clerk-client.provider'
import { ClerkClient } from '@clerk/backend'
import { RaceListItem } from '@goodparty_org/contracts'
import { ForbiddenException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { format } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TestFixturesService } from './testFixtures.service'

// The controller's env/guard gates are covered by testFixtures.controller.test.ts;
// these tests exercise state composition against the real Postgres pipeline by
// calling the service directly (the harness's logged-in user is not an admin).
const service = useTestService()

const RACE: RaceListItem = {
  id: 'race_1',
  brPositionId: 'br_pos_1',
  position: {
    name: 'Cheyenne City Council - Ward 1',
    level: 'city',
    state: 'WY',
  },
  election: { electionDay: '2027-11-02' },
}

const fixtures = () => service.app.get(TestFixturesService)

let clerkDeleteUser: ReturnType<typeof vi.fn>
let getToken: ReturnType<typeof vi.fn>
let trackCampaign: ReturnType<typeof vi.fn>

beforeEach(() => {
  const clerk = service.app.get<ClerkClient>(CLERK_CLIENT_PROVIDER_TOKEN)
  vi.spyOn(clerk.users, 'createUser').mockImplementation(() =>
    Promise.resolve({
      id: `user_clerk_${randomUUID()}`,
    } as unknown as Awaited<ReturnType<ClerkClient['users']['createUser']>>),
  )
  clerkDeleteUser = vi
    .spyOn(clerk.users, 'deleteUser')
    .mockResolvedValue(
      {} as unknown as Awaited<ReturnType<ClerkClient['users']['deleteUser']>>,
    ) as unknown as ReturnType<typeof vi.fn>
  vi.spyOn(clerk.sessions, 'createSession').mockResolvedValue({
    id: 'sess_fixture',
  } as unknown as Awaited<ReturnType<ClerkClient['sessions']['createSession']>>)
  getToken = vi.spyOn(clerk.sessions, 'getToken').mockResolvedValue({
    jwt: 'fixture-jwt',
  } as unknown as Awaited<
    ReturnType<ClerkClient['sessions']['getToken']>
  >) as unknown as ReturnType<typeof vi.fn>

  vi.spyOn(service.app.get(RacesService), 'getRacesByZip').mockResolvedValue([
    RACE,
  ])
  vi.spyOn(
    service.app.get(ElectionsService),
    'getPositionByBallotReadyId',
  ).mockResolvedValue({
    id: 'pos_internal_1',
  } as unknown as Awaited<
    ReturnType<ElectionsService['getPositionByBallotReadyId']>
  >)

  trackCampaign = vi
    .spyOn(service.app.get(CrmCampaignsService), 'trackCampaign')
    .mockResolvedValue(undefined) as unknown as ReturnType<typeof vi.fn>
})

describe('createFixtureUser', () => {
  it('free-win: creates a launched campaign with no CRM tracking', async () => {
    const result = await fixtures().createFixtureUser({ state: 'free-win' })

    expect(result.email).toMatch(/@test\.goodparty\.org$/)
    expect(result.campaignId).toBeDefined()
    expect(result.orgSlug).toBe(`campaign-${result.campaignId}`)
    expect(result.sessionToken).toBe('fixture-jwt')
    expect(result.cookies).toEqual({
      token: 'fixture-jwt',
      user: expect.stringContaining(`"id":${result.userId}`),
      'organization-slug': result.orgSlug,
    })
    expect(getToken).toHaveBeenCalledWith('sess_fixture', undefined, 3600)

    const campaign = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: result.campaignId },
    })
    expect(campaign.isActive).toBe(true)
    expect(campaign.isPro).toBe(false)
    expect(campaign.data.launchStatus).toBe('launched')
    expect(campaign.details.pledged).toBe(true)
    expect(campaign.details.raceId).toBe(RACE.id)

    const org = await service.prisma.organization.findUniqueOrThrow({
      where: { slug: result.orgSlug },
    })
    expect(org.ownerId).toBe(result.userId)
    expect(org.positionId).toBe('pos_internal_1')

    const user = await service.prisma.user.findUniqueOrThrow({
      where: { id: result.userId },
    })
    expect(user.zip).toBe('82001')

    expect(trackCampaign).not.toHaveBeenCalled()
  })

  it('pro-win: additionally flips isPro', async () => {
    const result = await fixtures().createFixtureUser({ state: 'pro-win' })

    const campaign = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: result.campaignId },
    })
    expect(campaign.isPro).toBe(true)
    expect(trackCampaign).not.toHaveBeenCalled()
  })

  it('serve: creates a completed elected office with a custom position name', async () => {
    const result = await fixtures().createFixtureUser({ state: 'serve' })

    expect(result.campaignId).toBeUndefined()
    expect(result.orgSlug).toBe(`eo-${result.electedOfficeId}`)

    const office = await service.prisma.electedOffice.findUniqueOrThrow({
      where: { id: result.electedOfficeId },
    })
    expect(office.userId).toBe(result.userId)
    expect(office.onboardingCompletedAt).not.toBeNull()
    expect(office.termStartDate).not.toBeNull()
    expect(office.termEndDate).not.toBeNull()

    const org = await service.prisma.organization.findUniqueOrThrow({
      where: { slug: result.orgSlug },
    })
    expect(org.positionId).toBeNull()
    expect(org.customPositionName).toBe('Test City Council')
  })

  it('serve: binds the org to a provided positionId instead', async () => {
    const result = await fixtures().createFixtureUser({
      state: 'serve',
      serve: { positionId: 'pos_serve_9' },
    })

    const org = await service.prisma.organization.findUniqueOrThrow({
      where: { slug: result.orgSlug },
    })
    expect(org.positionId).toBe('pos_serve_9')
    expect(org.customPositionName).toBeNull()
  })

  it('serve-won-race: links office to campaign and stamps the win last', async () => {
    const result = await fixtures().createFixtureUser({
      state: 'serve-won-race',
    })

    expect(result.orgSlug).toBe(`eo-${result.electedOfficeId}`)
    expect(result.campaignOrgSlug).toBe(`campaign-${result.campaignId}`)

    const office = await service.prisma.electedOffice.findUniqueOrThrow({
      where: { id: result.electedOfficeId },
    })
    expect(office.campaignId).toBe(result.campaignId)

    // The elected-office org inherits the campaign org's resolved position.
    const eoOrg = await service.prisma.organization.findUniqueOrThrow({
      where: { slug: result.orgSlug },
    })
    expect(eoOrg.positionId).toBe('pos_internal_1')

    const campaign = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: result.campaignId },
    })
    expect(campaign.details.wonGeneral).toBe(true)
    // A past election date is what makes the "won" state stable — an upcoming
    // one marks the campaign active and can re-trigger result prompts.
    expect(
      campaign.details.electionDate! < format(new Date(), 'yyyy-MM-dd'),
    ).toBe(true)
  })
})

describe('deleteFixtureUsers', () => {
  it('deletes fixture users from DB and Clerk, reporting unknown ids', async () => {
    const created = await fixtures().createFixtureUser({ state: 'free-win' })

    const result = await fixtures().deleteFixtureUsers({
      userIds: [created.userId, 999999],
    })

    expect(result.deleted).toEqual([
      { userId: created.userId, email: created.email },
    ])
    expect(result.notFound).toEqual([999999])
    expect(clerkDeleteUser).toHaveBeenCalledWith(created.clerkUserId)

    expect(
      await service.prisma.user.findUnique({ where: { id: created.userId } }),
    ).toBeNull()
    expect(
      await service.prisma.campaign.findUnique({
        where: { id: created.campaignId },
      }),
    ).toBeNull()
    expect(
      await service.prisma.organization.findUnique({
        where: { slug: created.orgSlug },
      }),
    ).toBeNull()
  })

  it('refuses to delete a non-test user', async () => {
    const real = await service.prisma.user.create({
      data: { email: 'real-candidate@gmail.com' },
    })

    await expect(
      fixtures().deleteFixtureUsers({ userIds: [real.id] }),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(
      await service.prisma.user.findUnique({ where: { id: real.id } }),
    ).not.toBeNull()
  })
})

describe('mintFixtureSession', () => {
  it('re-mints a session preferring the elected-office org', async () => {
    const created = await fixtures().createFixtureUser({
      state: 'serve-won-race',
    })

    const session = await fixtures().mintFixtureSession(created.userId, {})

    expect(session.sessionToken).toBe('fixture-jwt')
    expect(session.cookies['organization-slug']).toBe(created.orgSlug)
  })

  it('honors an explicitly requested owned orgSlug and rejects others', async () => {
    const created = await fixtures().createFixtureUser({
      state: 'serve-won-race',
    })

    const session = await fixtures().mintFixtureSession(created.userId, {
      orgSlug: created.campaignOrgSlug,
    })
    expect(session.cookies['organization-slug']).toBe(created.campaignOrgSlug)

    await expect(
      fixtures().mintFixtureSession(created.userId, {
        orgSlug: 'campaign-999999',
      }),
    ).rejects.toThrow('orgSlug is not owned by this user')
  })

  it('refuses a non-test user', async () => {
    // The harness's seeded user is @goodparty.org — internal, not a test user.
    await expect(
      fixtures().mintFixtureSession(service.user.id, {}),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })
})
