import { describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'
import {
  DoorKnockOutcome,
  OrganizationRole,
  PhoneBankCallOutcome,
} from '../../generated/prisma'
import { TeamStatsService } from './teamStats.service'

const service = useTestService()

// Fixed instants rather than offsets from `now`, so an assertion about which
// activity is the LATEST one cannot become a race with the clock.
const T1 = new Date('2026-03-01T15:00:00.000Z')
const T2 = new Date('2026-03-02T15:00:00.000Z')
const T3 = new Date('2026-03-03T15:00:00.000Z')

const createOrg = (slug: string) =>
  service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })

const createMember = (email: string) =>
  service.prisma.user.create({ data: { email } })

const addMembership = (
  organizationSlug: string,
  userId: number,
  role: OrganizationRole = OrganizationRole.campaignAdmin,
) =>
  service.prisma.organizationMembership.create({
    data: { organizationSlug, userId, role },
  })

const knock = (
  organizationSlug: string,
  actorUserId: number | null,
  occurredAt: Date,
) =>
  service.prisma.contactInteractionDoorKnock.create({
    data: {
      organizationSlug,
      personId: `p-${Math.random().toString(36).slice(2, 10)}`,
      occurredAt,
      outcome: DoorKnockOutcome.answered,
      actorUserId,
    },
  })

const call = (
  organizationSlug: string,
  actorUserId: number | null,
  occurredAt: Date,
) =>
  service.prisma.contactInteractionPhoneBanking.create({
    data: {
      organizationSlug,
      personId: `p-${Math.random().toString(36).slice(2, 10)}`,
      occurredAt,
      outcome: PhoneBankCallOutcome.answered,
      actorUserId,
    },
  })

describe('TeamStatsService.getTeamStats', () => {
  it('computes per-member counts and the later lastActivityAt across both channels, zero-filling a member with no rows', async () => {
    const org = await createOrg('team-stats-basic')
    const memberA = await createMember('member-a@example.com')
    const memberB = await createMember('member-b@example.com')
    await addMembership(org.slug, memberA.id)
    await addMembership(org.slug, memberB.id)

    await knock(org.slug, memberA.id, T1)
    await knock(org.slug, memberA.id, T2)
    await knock(org.slug, memberA.id, T3)
    await call(org.slug, memberA.id, T1)
    // T2 is the latest phone-banking timestamp, but T3 (a door knock) is
    // still the later of the two channels overall.
    await call(org.slug, memberA.id, T2)

    const teamStats = service.app.get(TeamStatsService)
    const { stats } = await teamStats.getTeamStats(org)

    expect(stats).toEqual(
      expect.arrayContaining([
        {
          userId: memberA.id,
          doorsKnocked: 3,
          callsMade: 2,
          totalLogged: 5,
          lastActivityAt: T3,
        },
        {
          userId: memberB.id,
          doorsKnocked: 0,
          callsMade: 0,
          totalLogged: 0,
          lastActivityAt: null,
        },
      ]),
    )
  })

  // lastActivityAt picks the later timestamp even when phone banking (not
  // door knocking) is the more recent channel.
  it('picks phone banking as lastActivityAt when it is the more recent channel', async () => {
    const org = await createOrg('team-stats-call-latest')
    const member = await createMember('call-latest@example.com')
    await addMembership(org.slug, member.id)

    await knock(org.slug, member.id, T1)
    await call(org.slug, member.id, T3)

    const teamStats = service.app.get(TeamStatsService)
    const { stats } = await teamStats.getTeamStats(org)

    expect(stats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: member.id, lastActivityAt: T3 }),
      ]),
    )
  })

  it('excludes rows with a null actorUserId (manual/legacy logs) from every count', async () => {
    const org = await createOrg('team-stats-null-actor')
    const member = await createMember('null-actor@example.com')
    await addMembership(org.slug, member.id)

    await knock(org.slug, member.id, T1)
    // A manual/legacy row with no actor stamp must not inflate this member's
    // count or, worse, surface as a phantom unattributed row.
    await knock(org.slug, null, T2)
    await call(org.slug, null, T2)

    const teamStats = service.app.get(TeamStatsService)
    const { stats } = await teamStats.getTeamStats(org)

    // createOrg makes service.user the owner, so the owner's zero-filled row
    // (no activity of its own) is also present alongside the member's.
    expect(stats).toHaveLength(2)
    expect(stats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: member.id,
          doorsKnocked: 1,
          callsMade: 0,
        }),
      ]),
    )
  })

  it("never leaks another organization's interaction rows", async () => {
    const org = await createOrg('team-stats-org-a')
    const otherOwner = await service.prisma.user.create({
      data: { email: 'other-owner@example.com' },
    })
    const otherOrg = await service.prisma.organization.create({
      data: { slug: 'team-stats-org-b', ownerId: otherOwner.id },
    })
    const member = await createMember('leak-check@example.com')
    // Same user is a member of org A only; a knock the same person logged
    // against org B must not leak into org A's stats.
    await addMembership(org.slug, member.id)
    await knock(org.slug, member.id, T1)
    await knock(otherOrg.slug, member.id, T2)

    const teamStats = service.app.get(TeamStatsService)
    const { stats } = await teamStats.getTeamStats(org)

    // createOrg makes service.user the owner, so the owner's zero-filled row
    // is also present alongside the member's.
    expect(stats).toHaveLength(2)
    expect(stats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: member.id,
          doorsKnocked: 1,
          lastActivityAt: T1,
        }),
      ]),
    )
  })

  it('produces no output row for a former member, dropping their attributed rows', async () => {
    const org = await createOrg('team-stats-former-member')
    const former = await createMember('former@example.com')
    const membership = await addMembership(org.slug, former.id)
    await knock(org.slug, former.id, T1)
    // Removal deletes the membership row, not the interaction rows —
    // attribution (actorUserId) and access (membership) are separate.
    await service.prisma.organizationMembership.delete({
      where: { id: membership.id },
    })

    const teamStats = service.app.get(TeamStatsService)
    const { stats } = await teamStats.getTeamStats(org)

    expect(stats.find((row) => row.userId === former.id)).toBeUndefined()
  })

  it('includes the owner explicitly, with no OrganizationMembership row of their own', async () => {
    const org = await createOrg('team-stats-owner')
    await knock(org.slug, service.user.id, T1)

    const teamStats = service.app.get(TeamStatsService)
    const { stats } = await teamStats.getTeamStats(org)

    expect(stats).toEqual([
      expect.objectContaining({
        userId: service.user.id,
        doorsKnocked: 1,
        lastActivityAt: T1,
      }),
    ])
  })

  // Stats are read entirely from Postgres who-stamps — asserted by
  // construction: TeamStatsService carries no Clerk dependency at all, so a
  // successful, unmocked call here is proof no invitation list was paged.
  it('resolves with no Clerk stub installed', async () => {
    const org = await createOrg('team-stats-no-clerk')

    const teamStats = service.app.get(TeamStatsService)
    await expect(teamStats.getTeamStats(org)).resolves.toEqual({
      stats: [
        {
          userId: service.user.id,
          doorsKnocked: 0,
          callsMade: 0,
          totalLogged: 0,
          lastActivityAt: null,
        },
      ],
    })
  })
})
