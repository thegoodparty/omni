import { BadRequestException } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'
import type { GeoJsonPolygon } from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import {
  Campaign,
  DoorKnockingMode,
  DoorKnockOutcome,
  Organization,
  OutreachType,
  PhoneBankCallOutcome,
  PhoneBankingPurpose,
} from '../../generated/prisma'
import { OutreachAssignmentService } from './outreachAssignment.service'

const service = useTestService()

// A minimal placeholder — these tests are about counting, not the geometry,
// and geoPoly is NOT NULL on the turf.
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

let assignmentService: OutreachAssignmentService
let organization: Organization
let campaign: Campaign

beforeEach(async () => {
  assignmentService = service.app.get(OutreachAssignmentService)

  organization = await service.prisma.organization.create({
    data: { slug: 'outreach-assignment-org', ownerId: service.user.id },
  })
  campaign = await service.prisma.campaign.create({
    data: {
      organizationSlug: organization.slug,
      userId: service.user.id,
      slug: 'outreach-assignment-campaign',
    },
  })
})

const createOutreach = (
  overrides: Partial<{ organizationSlug: string }> = {},
) =>
  service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      outreachType: 'text',
      ...overrides,
    },
  })

describe('OutreachAssignmentService', () => {
  it('resolves org through the campaign join for a legacy null-org row', async () => {
    const outreach = await createOutreach()
    expect(outreach.organizationSlug).toBeNull()
    const member = await service.prisma.user.create({
      data: { email: 'legacy-org-assignee@goodparty.org' },
    })

    const assignment = await assignmentService.assign(
      organization.slug,
      outreach.id,
      member.id,
      service.user.id,
    )
    expect(assignment.organizationSlug).toBe(organization.slug)
  })

  it('assigns a member directly scoped by organizationSlug (Serve row)', async () => {
    const serveOutreach = await service.prisma.outreach.create({
      data: {
        organizationSlug: organization.slug,
        outreachType: 'text',
      },
    })
    const member = await service.prisma.user.create({
      data: { email: 'serve-row-assignee@goodparty.org' },
    })

    const assignment = await assignmentService.assign(
      organization.slug,
      serveOutreach.id,
      member.id,
      service.user.id,
    )
    expect(assignment.organizationSlug).toBe(organization.slug)
  })

  it('assigns a member and is idempotent on a repeat assign', async () => {
    const outreach = await createOutreach()
    const member = await service.prisma.user.create({
      data: { email: 'assignee@goodparty.org' },
    })

    const first = await assignmentService.assign(
      organization.slug,
      outreach.id,
      member.id,
      service.user.id,
    )
    expect(first.organizationSlug).toBe(organization.slug)
    expect(first.outreachId).toBe(outreach.id)
    expect(first.assigneeUserId).toBe(member.id)
    expect(first.assignedByUserId).toBe(service.user.id)

    const second = await assignmentService.assign(
      organization.slug,
      outreach.id,
      member.id,
      service.user.id,
    )
    expect(second.id).toBe(first.id)

    const rows = await service.prisma.outreachAssignment.findMany({
      where: { outreachId: outreach.id, assigneeUserId: member.id },
    })
    expect(rows).toHaveLength(1)
  })

  it('refuses to assign an outreach belonging to a different organization', async () => {
    const otherOrg = await service.prisma.organization.create({
      data: { slug: 'outreach-assignment-other-org', ownerId: service.user.id },
    })
    const outreach = await createOutreach()
    const member = await service.prisma.user.create({
      data: { email: 'cross-org-assignee@goodparty.org' },
    })

    await expect(
      assignmentService.assign(
        otherOrg.slug,
        outreach.id,
        member.id,
        service.user.id,
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('existsFor is true only for the assigned pair', async () => {
    const outreach = await createOutreach()
    const member = await service.prisma.user.create({
      data: { email: 'exists-for-assignee@goodparty.org' },
    })
    const otherMember = await service.prisma.user.create({
      data: { email: 'exists-for-other@goodparty.org' },
    })

    await assignmentService.assign(
      organization.slug,
      outreach.id,
      member.id,
      service.user.id,
    )

    await expect(
      assignmentService.existsFor(outreach.id, member.id),
    ).resolves.toBe(true)
    await expect(
      assignmentService.existsFor(outreach.id, otherMember.id),
    ).resolves.toBe(false)
  })

  it('deleteAllForMember removes only that member rows in that org', async () => {
    const outreachA = await createOutreach()
    const outreachB = await createOutreach()
    const member = await service.prisma.user.create({
      data: { email: 'delete-all-assignee@goodparty.org' },
    })
    const otherMember = await service.prisma.user.create({
      data: { email: 'delete-all-other@goodparty.org' },
    })

    await assignmentService.assign(
      organization.slug,
      outreachA.id,
      member.id,
      service.user.id,
    )
    await assignmentService.assign(
      organization.slug,
      outreachB.id,
      member.id,
      service.user.id,
    )
    await assignmentService.assign(
      organization.slug,
      outreachA.id,
      otherMember.id,
      service.user.id,
    )

    await assignmentService.deleteAllForMember(organization.slug, member.id)

    const remainingForMember = await service.prisma.outreachAssignment.findMany(
      { where: { assigneeUserId: member.id } },
    )
    expect(remainingForMember).toHaveLength(0)

    const remainingForOther = await service.prisma.outreachAssignment.findMany({
      where: { assigneeUserId: otherMember.id },
    })
    expect(remainingForOther).toHaveLength(1)
  })

  it('cascades on outreach delete', async () => {
    const outreach = await createOutreach()
    const member = await service.prisma.user.create({
      data: { email: 'cascade-outreach-assignee@goodparty.org' },
    })
    await assignmentService.assign(
      organization.slug,
      outreach.id,
      member.id,
      service.user.id,
    )

    await service.prisma.outreach.delete({ where: { id: outreach.id } })
    await expect(
      service.prisma.outreachAssignment.findMany({
        where: { outreachId: outreach.id },
      }),
    ).resolves.toHaveLength(0)
  })

  it('cascades on organization delete', async () => {
    const serveOutreach = await service.prisma.outreach.create({
      data: { organizationSlug: organization.slug, outreachType: 'text' },
    })
    const member = await service.prisma.user.create({
      data: { email: 'cascade-org-assignee@goodparty.org' },
    })
    await assignmentService.assign(
      organization.slug,
      serveOutreach.id,
      member.id,
      service.user.id,
    )

    await service.prisma.organization.delete({
      where: { slug: organization.slug },
    })

    await expect(
      service.prisma.outreachAssignment.findMany({
        where: { organizationSlug: organization.slug },
      }),
    ).resolves.toHaveLength(0)
  })

  it('nulls assignedByUserId (without deleting the row) when the assigner is deleted', async () => {
    const outreach = await createOutreach()
    const assigner = await service.prisma.user.create({
      data: { email: 'assigner-to-delete@goodparty.org' },
    })
    const member = await service.prisma.user.create({
      data: { email: 'assigner-delete-assignee@goodparty.org' },
    })

    const assignment = await assignmentService.assign(
      organization.slug,
      outreach.id,
      member.id,
      assigner.id,
    )

    await service.prisma.user.delete({ where: { id: assigner.id } })

    const row = await service.prisma.outreachAssignment.findUniqueOrThrow({
      where: { id: assignment.id },
    })
    expect(row.assignedByUserId).toBeNull()
  })

  // ENG-11049: accept threads a tx so the assignment commits or rolls back
  // with the membership row it accompanies — never a second $transaction.
  it('assign participates in a caller-supplied transaction', async () => {
    const outreach = await createOutreach()
    const member = await service.prisma.user.create({
      data: { email: 'tx-assignee@goodparty.org' },
    })

    await expect(
      service.prisma.$transaction(async (tx) => {
        await assignmentService.assign(
          organization.slug,
          outreach.id,
          member.id,
          service.user.id,
          tx,
        )
        throw new Error('rollback')
      }),
    ).rejects.toThrow('rollback')

    const rows = await service.prisma.outreachAssignment.findMany({
      where: { outreachId: outreach.id, assigneeUserId: member.id },
    })
    expect(rows).toHaveLength(0)
  })

  // ENG-11049 blocker fix: assign()'s org lookup must read through the
  // caller's tx, not a second connection off this.client — reading off a
  // separate connection inside an interactive transaction demands a second
  // pool connection per in-flight accept (a connection-pool deadlock risk
  // under a burst) and would also 404 on an outreach this same transaction
  // just created but hasn't committed yet. Proves the tx-read directly: an
  // outreach created inside the transaction is invisible to any OTHER
  // connection until commit, so assign() succeeding on it here is only
  // possible if its lookup used this transaction.
  it("assign's org lookup reads through the caller's tx", async () => {
    const member = await service.prisma.user.create({
      data: { email: 'tx-lookup-assignee@goodparty.org' },
    })

    await service.prisma.$transaction(async (tx) => {
      const outreach = await tx.outreach.create({
        data: { organizationSlug: organization.slug, outreachType: 'text' },
      })

      await assignmentService.assign(
        organization.slug,
        outreach.id,
        member.id,
        service.user.id,
        tx,
      )

      const row = await tx.outreachAssignment.findUnique({
        where: {
          outreachId_assigneeUserId: {
            outreachId: outreach.id,
            assigneeUserId: member.id,
          },
        },
      })
      expect(row).not.toBeNull()
    })
  })

  describe('loggedCountsByAssignee', () => {
    const createPhoneBankingOutreach = async () => {
      const filter = await service.prisma.voterFileFilter.create({
        data: { organizationSlug: organization.slug, name: 'PB audience' },
      })
      const list = await service.prisma.phoneBankingList.create({
        data: {
          organizationSlug: organization.slug,
          voterFileFilterId: filter.id,
          name: 'Counts list',
          script: 'Hi',
          sheetCount: 1,
          purpose: PhoneBankingPurpose.persuade_voters,
        },
      })
      const outreach = await service.prisma.outreach.create({
        data: {
          campaignId: campaign.id,
          organizationSlug: organization.slug,
          outreachType: OutreachType.nativePhoneBanking,
          phoneBankingListId: list.id,
        },
      })
      return { list, outreach }
    }

    const createDoorKnockingOutreach = async () => {
      const filter = await service.prisma.voterFileFilter.create({
        data: { organizationSlug: organization.slug, name: 'DK audience' },
      })
      const turf = await service.prisma.doorKnockingTurf.create({
        data: {
          voterFileFilterId: filter.id,
          name: 'Counts turf',
          color: '#112233',
          geoPoly: GEO_POLY,
        },
      })
      const route = await service.prisma.doorKnockingRoute.create({
        data: {
          doorKnockingTurfId: turf.id,
          mode: DoorKnockingMode.walk,
          loop: false,
          totalSeconds: 0,
          totalMeters: 0,
          credits: 0,
        },
      })
      const outreach = await service.prisma.outreach.create({
        data: {
          campaignId: campaign.id,
          organizationSlug: organization.slug,
          outreachType: OutreachType.nativeDoorKnocking,
          doorKnockingRouteId: route.id,
        },
      })
      return { route, outreach }
    }

    const createStopTarget = async (
      doorKnockingRouteId: number,
      seq: number,
      personId: string,
    ) => {
      const stop = await service.prisma.doorKnockingStop.create({
        data: {
          doorKnockingRouteId,
          seq,
          lat: 0,
          lng: 0,
          displayAddress: `${seq} Main St`,
          legSeconds: 1,
          legMeters: 1,
        },
      })
      return service.prisma.doorKnockingStopTarget.create({
        data: {
          doorKnockingStopId: stop.id,
          personId,
          addressKey: `key-${seq}`,
        },
      })
    }

    it('phone banking: counts only calls logged on THIS list', async () => {
      const { list, outreach } = await createPhoneBankingOutreach()
      const otherFilter = await service.prisma.voterFileFilter.create({
        data: { organizationSlug: organization.slug, name: 'other audience' },
      })
      const otherList = await service.prisma.phoneBankingList.create({
        data: {
          organizationSlug: organization.slug,
          voterFileFilterId: otherFilter.id,
          name: 'Other list',
          script: 'Hi',
          sheetCount: 1,
          purpose: PhoneBankingPurpose.persuade_voters,
        },
      })
      const assigneeA = await service.prisma.user.create({
        data: { email: 'pb-counts-a@goodparty.org' },
      })
      const assigneeB = await service.prisma.user.create({
        data: { email: 'pb-counts-b@goodparty.org' },
      })

      for (let i = 0; i < 4; i++) {
        await service.prisma.contactInteractionPhoneBanking.create({
          data: {
            organizationSlug: organization.slug,
            personId: `pb-counts-person-${i}`,
            occurredAt: new Date(),
            phoneBankingListId: list.id,
            outcome: PhoneBankCallOutcome.answered,
            actorUserId: assigneeA.id,
          },
        })
      }
      // A's call on a DIFFERENT list must not count toward this outreach.
      await service.prisma.contactInteractionPhoneBanking.create({
        data: {
          organizationSlug: organization.slug,
          personId: 'pb-counts-person-other-list',
          occurredAt: new Date(),
          phoneBankingListId: otherList.id,
          outcome: PhoneBankCallOutcome.answered,
          actorUserId: assigneeA.id,
        },
      })
      // A null-actor (legacy/manual) row on this list contributes to no one.
      await service.prisma.contactInteractionPhoneBanking.create({
        data: {
          organizationSlug: organization.slug,
          personId: 'pb-counts-person-null-actor',
          occurredAt: new Date(),
          phoneBankingListId: list.id,
          outcome: PhoneBankCallOutcome.answered,
        },
      })

      const counts = await assignmentService.loggedCountsByAssignee(outreach, [
        assigneeA.id,
        assigneeB.id,
      ])

      expect(counts.get(assigneeA.id)).toBe(4)
      expect(counts.get(assigneeB.id) ?? 0).toBe(0)
    })

    it('door knocking: counts distinct on-route people, folding corrected rows', async () => {
      const { route, outreach } = await createDoorKnockingOutreach()
      await createStopTarget(route.id, 1, 'dk-counts-person-1')
      await createStopTarget(route.id, 2, 'dk-counts-person-2')
      await createStopTarget(route.id, 3, 'dk-counts-person-3')

      const assigneeA = await service.prisma.user.create({
        data: { email: 'dk-counts-a@goodparty.org' },
      })
      const assigneeB = await service.prisma.user.create({
        data: { email: 'dk-counts-b@goodparty.org' },
      })

      // A knocks person-1 twice (a corrected outcome) — must fold to one.
      await service.prisma.contactInteractionDoorKnock.create({
        data: {
          organizationSlug: organization.slug,
          personId: 'dk-counts-person-1',
          occurredAt: new Date(),
          outcome: DoorKnockOutcome.not_home,
          actorUserId: assigneeA.id,
          sourceId: 'dk-counts-source-1',
        },
      })
      await service.prisma.contactInteractionDoorKnock.create({
        data: {
          organizationSlug: organization.slug,
          personId: 'dk-counts-person-1',
          occurredAt: new Date(),
          outcome: DoorKnockOutcome.answered,
          actorUserId: assigneeA.id,
          sourceId: 'dk-counts-source-1-correction',
        },
      })
      await service.prisma.contactInteractionDoorKnock.create({
        data: {
          organizationSlug: organization.slug,
          personId: 'dk-counts-person-2',
          occurredAt: new Date(),
          outcome: DoorKnockOutcome.answered,
          actorUserId: assigneeA.id,
          sourceId: 'dk-counts-source-2',
        },
      })
      await service.prisma.contactInteractionDoorKnock.create({
        data: {
          organizationSlug: organization.slug,
          personId: 'dk-counts-person-3',
          occurredAt: new Date(),
          outcome: DoorKnockOutcome.answered,
          actorUserId: assigneeA.id,
          sourceId: 'dk-counts-source-3',
        },
      })
      // A knock off this route by A must not count.
      await service.prisma.contactInteractionDoorKnock.create({
        data: {
          organizationSlug: organization.slug,
          personId: 'dk-counts-person-off-route',
          occurredAt: new Date(),
          outcome: DoorKnockOutcome.answered,
          actorUserId: assigneeA.id,
          sourceId: 'dk-counts-source-off-route',
        },
      })

      const counts = await assignmentService.loggedCountsByAssignee(outreach, [
        assigneeA.id,
        assigneeB.id,
      ])

      expect(counts.get(assigneeA.id)).toBe(3)
      expect(counts.get(assigneeB.id) ?? 0).toBe(0)
    })

    it('returns an empty map for a non-native outreachType', async () => {
      const outreach = await createOutreach()
      const counts = await assignmentService.loggedCountsByAssignee(outreach, [
        service.user.id,
      ])
      expect(counts.size).toBe(0)
    })
  })
})
