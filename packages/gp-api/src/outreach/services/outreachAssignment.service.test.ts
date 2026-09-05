import { BadRequestException } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'
import { Campaign, Organization } from '../../generated/prisma'
import { OutreachAssignmentService } from './outreachAssignment.service'

const service = useTestService()

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
})
