import { HttpStatus } from '@nestjs/common'
import jwt from 'jsonwebtoken'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GeoJsonPolygon } from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { FeaturesService } from '@/features/services/features.service'
import { Campaign, OrganizationRole } from '../../generated/prisma'

const service = useTestService()

// A minimal placeholder — this suite is about the assignment/mine wiring,
// not the geometry, and geoPoly is NOT NULL on the turf.
const GEO_POLY: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-87.66, 41.89],
      [-87.64, 41.89],
      [-87.65, 41.91],
      [-87.66, 41.89],
    ],
  ],
}

const ORG_SLUG_HEADER = 'X-Organization-Slug'
const ORG_SLUG = 'assignment-org'
const OTHER_ORG_SLUG = 'assignment-other-org'

const authHeaderFor = (clerkId: string) => ({
  Authorization: `Bearer ${jwt.sign(
    { sub: clerkId },
    process.env.AUTH_SECRET!,
    { expiresIn: '1h' },
  )}`,
})

const orgHeaders = (extra: Record<string, string> = {}) => ({
  headers: { [ORG_SLUG_HEADER]: ORG_SLUG, ...extra },
})

let campaign: Campaign

const createMemberUser = (opts: { email: string; clerkId?: string }) =>
  service.prisma.user.create({
    data: { email: opts.email, clerkId: opts.clerkId },
  })

const addMembership = (
  userId: number,
  role: OrganizationRole,
  organizationSlug = ORG_SLUG,
) =>
  service.prisma.organizationMembership.create({
    data: { organizationSlug, userId, role },
  })

const createOutreach = (
  overrides: Partial<{
    organizationSlug: string | null
    campaignId: number | null
    name: string
  }> = {},
) =>
  service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      outreachType: 'text',
      ...overrides,
    },
  })

const stubFeatures = () => service.app.get(FeaturesService)
const stubAnalytics = () => service.app.get(AnalyticsService)

beforeEach(async () => {
  await service.prisma.organization.create({
    data: { slug: ORG_SLUG, ownerId: service.user.id },
  })
  campaign = await service.prisma.campaign.create({
    data: {
      organizationSlug: ORG_SLUG,
      userId: service.user.id,
      slug: 'assignment-campaign',
    },
  })
})

describe('POST /v1/outreach/:id/assignments', () => {
  it('the owner assigns an existing member', async () => {
    const outreach = await createOutreach()
    const member = await createMemberUser({ email: 'member@example.com' })
    await addMembership(member.id, OrganizationRole.volunteer)
    const track = vi
      .spyOn(stubAnalytics(), 'track')
      .mockResolvedValue(undefined as never)

    const result = await service.client.post(
      `/v1/outreach/${outreach.id}/assignments`,
      { assigneeUserId: member.id },
      orgHeaders(),
    )

    expect(result.status).toBe(HttpStatus.CREATED)
    expect(result.data).toEqual(
      expect.objectContaining({
        userId: member.id,
        role: 'volunteer',
        assignedByUserId: service.user.id,
      }),
    )

    const rows = await service.prisma.outreachAssignment.findMany({
      where: { outreachId: outreach.id, assigneeUserId: member.id },
    })
    expect(rows).toHaveLength(1)

    await vi.waitFor(() => expect(track).toHaveBeenCalled())
    expect(track).toHaveBeenCalledWith(
      service.user.id,
      'Team - Outreach Assigned',
      {
        outreachId: outreach.id,
        outreachType: 'text',
        assigneeUserId: member.id,
      },
    )
  })

  it('a manager can self-assign', async () => {
    const outreach = await createOutreach()

    const result = await service.client.post(
      `/v1/outreach/${outreach.id}/assignments`,
      { assigneeUserId: service.user.id },
      orgHeaders(),
    )

    expect(result.status).toBe(HttpStatus.CREATED)
    expect(result.data).toEqual(
      expect.objectContaining({ userId: service.user.id, role: 'owner' }),
    )
  })

  it('is idempotent on a repeat assign', async () => {
    const outreach = await createOutreach()
    const member = await createMemberUser({ email: 'twice@example.com' })
    await addMembership(member.id, OrganizationRole.campaignAdmin)

    const first = await service.client.post(
      `/v1/outreach/${outreach.id}/assignments`,
      { assigneeUserId: member.id },
      orgHeaders(),
    )
    const second = await service.client.post(
      `/v1/outreach/${outreach.id}/assignments`,
      { assigneeUserId: member.id },
      orgHeaders(),
    )

    expect(first.status).toBe(HttpStatus.CREATED)
    expect(second.status).toBe(HttpStatus.CREATED)

    const rows = await service.prisma.outreachAssignment.findMany({
      where: { outreachId: outreach.id, assigneeUserId: member.id },
    })
    expect(rows).toHaveLength(1)
  })

  it('422s assigning a non-member', async () => {
    const outreach = await createOutreach()
    const stranger = await createMemberUser({ email: 'stranger@example.com' })

    const result = await service.client.post(
      `/v1/outreach/${outreach.id}/assignments`,
      { assigneeUserId: stranger.id },
      orgHeaders(),
    )

    expect(result.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
    expect(
      await service.prisma.outreachAssignment.count({
        where: { outreachId: outreach.id },
      }),
    ).toBe(0)
  })

  it('404s assigning against an outreach in another organization, without leaking that it exists', async () => {
    const otherOwner = await createMemberUser({
      email: 'other-owner@example.com',
    })
    await service.prisma.organization.create({
      data: { slug: OTHER_ORG_SLUG, ownerId: otherOwner.id },
    })
    const otherCampaign = await service.prisma.campaign.create({
      data: {
        organizationSlug: OTHER_ORG_SLUG,
        userId: otherOwner.id,
        slug: 'other-org-campaign',
      },
    })
    const foreignOutreach = await service.prisma.outreach.create({
      data: { campaignId: otherCampaign.id, outreachType: 'text' },
    })
    const member = await createMemberUser({ email: 'cross-org@example.com' })
    await addMembership(member.id, OrganizationRole.volunteer)

    const result = await service.client.post(
      `/v1/outreach/${foreignOutreach.id}/assignments`,
      { assigneeUserId: member.id },
      orgHeaders(),
    )

    expect(result.status).toBe(HttpStatus.NOT_FOUND)
    // A plain "Outreach <id> not found" (assertOutreachInOrg) is fine — it
    // only echoes the id the caller already sent, same as a truly missing
    // id. What must never appear is assign()'s own guard message, which
    // names the OTHER org and confirms the outreach exists there.
    const body = JSON.stringify(result.data)
    expect(body).not.toContain(OTHER_ORG_SLUG)
    expect(body).not.toContain('belong')
    expect(
      await service.prisma.outreachAssignment.count({
        where: { outreachId: foreignOutreach.id },
      }),
    ).toBe(0)
  })

  it('403s when the caller is a volunteer, not a manager', async () => {
    const outreach = await createOutreach()
    const volunteer = await createMemberUser({
      email: 'assigner-volunteer@example.com',
      clerkId: 'user_assign_volunteer',
    })
    await addMembership(volunteer.id, OrganizationRole.volunteer)

    const result = await service.client.post(
      `/v1/outreach/${outreach.id}/assignments`,
      { assigneeUserId: volunteer.id },
      {
        headers: {
          [ORG_SLUG_HEADER]: ORG_SLUG,
          ...authHeaderFor('user_assign_volunteer'),
        },
      },
    )

    expect(result.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('404s when the win-team-accounts flag is disabled', async () => {
    const outreach = await createOutreach()
    const member = await createMemberUser({ email: 'flag-off@example.com' })
    await addMembership(member.id, OrganizationRole.volunteer)
    vi.spyOn(stubFeatures(), 'isFeatureEnabled').mockResolvedValueOnce(false)

    const result = await service.client.post(
      `/v1/outreach/${outreach.id}/assignments`,
      { assigneeUserId: member.id },
      orgHeaders(),
    )

    expect(result.status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('DELETE /v1/outreach/:id/assignments/:userId', () => {
  it('the owner removes an assignment', async () => {
    const outreach = await createOutreach()
    const member = await createMemberUser({ email: 'to-unassign@example.com' })
    await addMembership(member.id, OrganizationRole.volunteer)
    await service.prisma.outreachAssignment.create({
      data: {
        organizationSlug: ORG_SLUG,
        outreachId: outreach.id,
        assigneeUserId: member.id,
        assignedByUserId: service.user.id,
      },
    })
    const track = vi
      .spyOn(stubAnalytics(), 'track')
      .mockResolvedValue(undefined as never)

    const result = await service.client.delete(
      `/v1/outreach/${outreach.id}/assignments/${member.id}`,
      orgHeaders(),
    )

    expect(result.status).toBe(HttpStatus.NO_CONTENT)
    expect(
      await service.prisma.outreachAssignment.count({
        where: { outreachId: outreach.id, assigneeUserId: member.id },
      }),
    ).toBe(0)
    await vi.waitFor(() => expect(track).toHaveBeenCalled())
    expect(track).toHaveBeenCalledWith(
      service.user.id,
      'Team - Outreach Assignment Removed',
      {
        outreachId: outreach.id,
        outreachType: 'text',
        assigneeUserId: member.id,
      },
    )
  })

  it('unassign is allowed for a never-picked-up assignment (no completion state required)', async () => {
    const outreach = await createOutreach()
    const member = await createMemberUser({ email: 'never-picked@example.com' })
    await addMembership(member.id, OrganizationRole.campaignAdmin)
    await service.prisma.outreachAssignment.create({
      data: {
        organizationSlug: ORG_SLUG,
        outreachId: outreach.id,
        assigneeUserId: member.id,
      },
    })

    const result = await service.client.delete(
      `/v1/outreach/${outreach.id}/assignments/${member.id}`,
      orgHeaders(),
    )

    expect(result.status).toBe(HttpStatus.NO_CONTENT)
  })

  it('404s for an outreach in another organization', async () => {
    const otherOwner = await createMemberUser({
      email: 'unassign-other-owner@example.com',
    })
    await service.prisma.organization.create({
      data: { slug: OTHER_ORG_SLUG, ownerId: otherOwner.id },
    })
    const otherCampaign = await service.prisma.campaign.create({
      data: {
        organizationSlug: OTHER_ORG_SLUG,
        userId: otherOwner.id,
        slug: 'unassign-other-campaign',
      },
    })
    const foreignOutreach = await service.prisma.outreach.create({
      data: { campaignId: otherCampaign.id, outreachType: 'text' },
    })

    const result = await service.client.delete(
      `/v1/outreach/${foreignOutreach.id}/assignments/${service.user.id}`,
      orgHeaders(),
    )

    expect(result.status).toBe(HttpStatus.NOT_FOUND)
  })

  it("a volunteer's next mine call no longer returns the outreach", async () => {
    const outreach = await createOutreach()
    const volunteer = await createMemberUser({
      email: 'unassign-volunteer@example.com',
      clerkId: 'user_unassign_volunteer',
    })
    await addMembership(volunteer.id, OrganizationRole.volunteer)
    await service.prisma.outreachAssignment.create({
      data: {
        organizationSlug: ORG_SLUG,
        outreachId: outreach.id,
        assigneeUserId: volunteer.id,
      },
    })

    await service.client.delete(
      `/v1/outreach/${outreach.id}/assignments/${volunteer.id}`,
      orgHeaders(),
    )

    const mine = await service.client.get('/v1/outreach/assignments/mine', {
      headers: {
        [ORG_SLUG_HEADER]: ORG_SLUG,
        ...authHeaderFor('user_unassign_volunteer'),
      },
    })

    expect(mine.status).toBe(HttpStatus.OK)
    expect(mine.data.assignments).toEqual([])
  })

  it('403s when the caller is a volunteer, not a manager', async () => {
    const outreach = await createOutreach()
    const volunteer = await createMemberUser({
      email: 'unassign-volunteer-forbidden@example.com',
      clerkId: 'user_unassign_volunteer_forbidden',
    })
    await addMembership(volunteer.id, OrganizationRole.volunteer)
    await service.prisma.outreachAssignment.create({
      data: {
        organizationSlug: ORG_SLUG,
        outreachId: outreach.id,
        assigneeUserId: volunteer.id,
        assignedByUserId: service.user.id,
      },
    })

    const result = await service.client.delete(
      `/v1/outreach/${outreach.id}/assignments/${volunteer.id}`,
      {
        headers: {
          [ORG_SLUG_HEADER]: ORG_SLUG,
          ...authHeaderFor('user_unassign_volunteer_forbidden'),
        },
      },
    )

    expect(result.status).toBe(HttpStatus.FORBIDDEN)
  })
})

describe('GET /v1/outreach/:id/assignments', () => {
  it('returns assignees with id/name/role/createdAt/assignedBy for a manager', async () => {
    const outreach = await createOutreach()
    const member = await service.prisma.user.create({
      data: {
        email: 'list-member@example.com',
        firstName: 'List',
        lastName: 'Member',
      },
    })
    await addMembership(member.id, OrganizationRole.campaignAdmin)
    await service.prisma.outreachAssignment.create({
      data: {
        organizationSlug: ORG_SLUG,
        outreachId: outreach.id,
        assigneeUserId: member.id,
        assignedByUserId: service.user.id,
      },
    })

    const result = await service.client.get(
      `/v1/outreach/${outreach.id}/assignments`,
      orgHeaders(),
    )

    expect(result.status).toBe(HttpStatus.OK)
    expect(result.data.assignees).toEqual([
      expect.objectContaining({
        userId: member.id,
        name: 'List Member',
        role: 'campaignAdmin',
        assignedByUserId: service.user.id,
      }),
    ])
  })

  it('403s a volunteer', async () => {
    const outreach = await createOutreach()
    const volunteer = await createMemberUser({
      email: 'list-volunteer@example.com',
      clerkId: 'user_list_volunteer',
    })
    await addMembership(volunteer.id, OrganizationRole.volunteer)

    const result = await service.client.get(
      `/v1/outreach/${outreach.id}/assignments`,
      {
        headers: {
          [ORG_SLUG_HEADER]: ORG_SLUG,
          ...authHeaderFor('user_list_volunteer'),
        },
      },
    )

    expect(result.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('404s for an outreach in another organization', async () => {
    const otherOwner = await createMemberUser({
      email: 'list-other-owner@example.com',
    })
    await service.prisma.organization.create({
      data: { slug: OTHER_ORG_SLUG, ownerId: otherOwner.id },
    })
    const otherCampaign = await service.prisma.campaign.create({
      data: {
        organizationSlug: OTHER_ORG_SLUG,
        userId: otherOwner.id,
        slug: 'list-other-campaign',
      },
    })
    const foreignOutreach = await service.prisma.outreach.create({
      data: { campaignId: otherCampaign.id, outreachType: 'text' },
    })

    const result = await service.client.get(
      `/v1/outreach/${foreignOutreach.id}/assignments`,
      orgHeaders(),
    )

    expect(result.status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('GET /v1/outreach/assignments/mine', () => {
  it('returns a volunteer’s own assignments in the header org', async () => {
    const outreach = await createOutreach({ name: 'My List' })
    const volunteer = await createMemberUser({
      email: 'mine-volunteer@example.com',
      clerkId: 'user_mine_volunteer',
    })
    await addMembership(volunteer.id, OrganizationRole.volunteer)
    await service.prisma.outreachAssignment.create({
      data: {
        organizationSlug: ORG_SLUG,
        outreachId: outreach.id,
        assigneeUserId: volunteer.id,
      },
    })

    const result = await service.client.get('/v1/outreach/assignments/mine', {
      headers: {
        [ORG_SLUG_HEADER]: ORG_SLUG,
        ...authHeaderFor('user_mine_volunteer'),
      },
    })

    expect(result.status).toBe(HttpStatus.OK)
    expect(result.data.assignments).toEqual([
      expect.objectContaining({
        outreachId: outreach.id,
        outreachType: 'text',
        name: 'My List',
      }),
    ])
    // A non-native type carries no channel-pointer/progress block.
    expect(result.data.assignments[0].phoneBanking).toBeUndefined()
    expect(result.data.assignments[0].doorKnocking).toBeUndefined()
  })

  it('a manager can also call mine (not volunteer-only)', async () => {
    const outreach = await createOutreach()
    await service.prisma.outreachAssignment.create({
      data: {
        organizationSlug: ORG_SLUG,
        outreachId: outreach.id,
        assigneeUserId: service.user.id,
      },
    })

    const result = await service.client.get(
      '/v1/outreach/assignments/mine',
      orgHeaders(),
    )

    expect(result.status).toBe(HttpStatus.OK)
    expect(result.data.assignments).toHaveLength(1)
  })

  it('excludes an assignment from a different org sharing the same user', async () => {
    const outreach = await createOutreach()
    await service.prisma.outreachAssignment.create({
      data: {
        organizationSlug: ORG_SLUG,
        outreachId: outreach.id,
        assigneeUserId: service.user.id,
      },
    })

    await service.prisma.organization.create({
      data: { slug: OTHER_ORG_SLUG, ownerId: service.user.id },
    })
    const otherCampaign = await service.prisma.campaign.create({
      data: {
        organizationSlug: OTHER_ORG_SLUG,
        userId: service.user.id,
        slug: 'mine-other-campaign',
      },
    })
    const otherOutreach = await service.prisma.outreach.create({
      data: { campaignId: otherCampaign.id, outreachType: 'text' },
    })
    await service.prisma.outreachAssignment.create({
      data: {
        organizationSlug: OTHER_ORG_SLUG,
        outreachId: otherOutreach.id,
        assigneeUserId: service.user.id,
      },
    })

    const result = await service.client.get(
      '/v1/outreach/assignments/mine',
      orgHeaders(),
    )

    expect(result.status).toBe(HttpStatus.OK)
    expect(result.data.assignments).toEqual([
      expect.objectContaining({ outreachId: outreach.id }),
    ])
  })

  // Regression guard: assignments/mine is declared ahead of :id/assignments
  // in the controller specifically so Nest doesn't swallow "mine" as an
  // :id param — if that ordering ever regresses, ParseIntPipe 400s trying
  // to parse "mine" as a number instead of matching this route.
  it('is not swallowed by the :id/assignments route', async () => {
    const result = await service.client.get(
      '/v1/outreach/assignments/mine',
      orgHeaders(),
    )
    expect(result.status).toBe(HttpStatus.OK)
  })

  it('hydrates the phoneBankingListId pointer for a nativePhoneBanking assignment', async () => {
    const filter = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: ORG_SLUG, name: 'PB audience' },
    })
    const list = await service.prisma.phoneBankingList.create({
      data: {
        organizationSlug: ORG_SLUG,
        voterFileFilterId: filter.id,
        name: 'Tuesday calls',
        script: 'Hi, this is a volunteer calling.',
        sheetCount: 1,
        purpose: 'persuade_voters',
      },
    })
    const outreach = await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        organizationSlug: ORG_SLUG,
        outreachType: 'nativePhoneBanking',
        phoneBankingListId: list.id,
        name: 'Tuesday calls',
        status: 'pending',
      },
    })
    const volunteer = await createMemberUser({
      email: 'mine-pb-volunteer@example.com',
      clerkId: 'user_mine_pb_volunteer',
    })
    await addMembership(volunteer.id, OrganizationRole.volunteer)
    await service.prisma.outreachAssignment.create({
      data: {
        organizationSlug: ORG_SLUG,
        outreachId: outreach.id,
        assigneeUserId: volunteer.id,
      },
    })

    const result = await service.client.get('/v1/outreach/assignments/mine', {
      headers: {
        [ORG_SLUG_HEADER]: ORG_SLUG,
        ...authHeaderFor('user_mine_pb_volunteer'),
      },
    })

    expect(result.status).toBe(HttpStatus.OK)
    expect(result.data.assignments).toEqual([
      expect.objectContaining({
        outreachId: outreach.id,
        outreachType: 'nativePhoneBanking',
        phoneBanking: expect.objectContaining({
          listId: list.id,
          entriesTotal: 0,
        }),
      }),
    ])
  })

  it('hydrates the turf-id pointer for a nativeDoorKnocking assignment', async () => {
    const filter = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: ORG_SLUG, name: 'DK audience' },
    })
    // No stops needed: DoorKnockingTurfCountsService.forRoutes seeds every
    // requested route id, so a route with none comes back zeroed rather than
    // absent — this suite is about the mine/assignment wiring, not counting.
    const turf = await service.prisma.doorKnockingTurf.create({
      data: {
        voterFileFilterId: filter.id,
        name: 'Elm St walk',
        color: '#22aa55',
        geoPoly: GEO_POLY,
      },
    })
    const route = await service.prisma.doorKnockingRoute.create({
      data: {
        doorKnockingTurfId: turf.id,
        mode: 'walk',
        loop: false,
        totalSeconds: 0,
        totalMeters: 0,
        credits: 0,
      },
    })
    const outreach = await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        organizationSlug: ORG_SLUG,
        outreachType: 'nativeDoorKnocking',
        doorKnockingRouteId: route.id,
        name: 'Elm St walk',
        status: 'in_progress',
      },
    })
    const volunteer = await createMemberUser({
      email: 'mine-dk-volunteer@example.com',
      clerkId: 'user_mine_dk_volunteer',
    })
    await addMembership(volunteer.id, OrganizationRole.volunteer)
    await service.prisma.outreachAssignment.create({
      data: {
        organizationSlug: ORG_SLUG,
        outreachId: outreach.id,
        assigneeUserId: volunteer.id,
      },
    })

    const result = await service.client.get('/v1/outreach/assignments/mine', {
      headers: {
        [ORG_SLUG_HEADER]: ORG_SLUG,
        ...authHeaderFor('user_mine_dk_volunteer'),
      },
    })

    expect(result.status).toBe(HttpStatus.OK)
    expect(result.data.assignments).toEqual([
      expect.objectContaining({
        outreachId: outreach.id,
        outreachType: 'nativeDoorKnocking',
        doorKnocking: expect.objectContaining({
          turfId: turf.id,
          routeId: route.id,
          doorCount: 0,
          peopleCount: 0,
          loggedCount: 0,
        }),
      }),
    ])
  })
})
