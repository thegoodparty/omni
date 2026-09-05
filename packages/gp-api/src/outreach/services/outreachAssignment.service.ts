import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import type { OutreachAssignee, MyAssignment } from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { OrganizationMembershipService } from '@/organizations/services/organizationMembership.service'
import { getUserFullName } from '../../users/util/users.util'
import {
  Outreach,
  OutreachAssignment,
  OrganizationRole,
  OutreachType,
  Prisma,
  User,
} from '../../generated/prisma'
import { OutreachSocialService } from './outreachSocial.service'

type OutreachAssignmentWithUsers = OutreachAssignment & {
  assignee: User
  assignedBy: User | null
}

@Injectable()
export class OutreachAssignmentService extends createPrismaBase(
  MODELS.OutreachAssignment,
) {
  constructor(
    private readonly outreachSocial: OutreachSocialService,
    private readonly membership: OrganizationMembershipService,
  ) {
    super()
  }

  // Refuses to attach an assignment to an outreach owned by a different
  // organization. Pre-org-scope Win rows have organizationSlug null on
  // Outreach, so the effective org resolves through the campaign join.
  private async resolveOutreachOrgSlug(
    outreachId: number,
  ): Promise<string | null> {
    const outreach = await this.client.outreach.findUnique({
      where: { id: outreachId },
      include: { campaign: true },
    })
    if (!outreach) {
      throw new NotFoundException(`Outreach ${outreachId} not found`)
    }
    return (
      outreach.organizationSlug ?? outreach.campaign?.organizationSlug ?? null
    )
  }

  // Shared by the routes that only ever address an outreach through an org
  // header (list/unassign) — a mismatch reads as "not found" rather than
  // assign's "bad request", since these routes never accept an org slug in
  // the body to be wrong about.
  async assertOutreachInOrg(
    organizationSlug: string,
    outreachId: number,
  ): Promise<void> {
    const effectiveOrgSlug = await this.resolveOutreachOrgSlug(outreachId)
    if (effectiveOrgSlug !== organizationSlug) {
      throw new NotFoundException(`Outreach ${outreachId} not found`)
    }
  }

  async findOutreachTypeOrThrow(outreachId: number): Promise<OutreachType> {
    const outreach = await this.client.outreach.findUniqueOrThrow({
      where: { id: outreachId },
      select: { outreachType: true },
    })
    return outreach.outreachType
  }

  async assign(
    organizationSlug: string,
    outreachId: number,
    assigneeUserId: number,
    assignedByUserId: number,
  ): Promise<OutreachAssignment> {
    const effectiveOrgSlug = await this.resolveOutreachOrgSlug(outreachId)
    if (effectiveOrgSlug !== organizationSlug) {
      throw new BadRequestException(
        `Outreach ${outreachId} does not belong to organization ${organizationSlug}`,
      )
    }
    // Upsert, not create: the same (outreachId, assigneeUserId) pair may be
    // assigned more than once and must collapse to one row. `update: {}`
    // deliberately leaves an existing row's assignedByUserId untouched.
    return this.model.upsert({
      where: { outreachId_assigneeUserId: { outreachId, assigneeUserId } },
      create: {
        organizationSlug,
        outreachId,
        assigneeUserId,
        assignedByUserId,
      },
      update: {},
    })
  }

  // The controller-facing entry point for POST /outreach/:id/assignments.
  // Checks org membership FIRST via assertOutreachInOrg (404) rather than
  // leaning on assign()'s own guard — that one throws a BadRequestException
  // carrying the outreach id and org slug in its message, which would leak
  // that a cross-org id exists at all. assign()'s guard stays as its own
  // backstop for other callers (e.g. the accept-invite path, ENG-11049).
  // Then enforces the "assignee must already be an org member" business
  // rule (422, not a 400 — a non-member is a valid request pointed at the
  // wrong person, not a malformed one), and finally reads back the
  // persisted row for the response.
  async assignValidated(
    organizationSlug: string,
    outreachId: number,
    assigneeUserId: number,
    assignedByUserId: number,
  ): Promise<OutreachAssignee> {
    await this.assertOutreachInOrg(organizationSlug, outreachId)

    const resolved = await this.membership.resolveRole(
      organizationSlug,
      assigneeUserId,
    )
    if (!resolved) {
      throw new UnprocessableEntityException(
        'Assignee is not a member of this organization',
      )
    }
    await this.assign(
      organizationSlug,
      outreachId,
      assigneeUserId,
      assignedByUserId,
    )
    const assignment = await this.model.findUniqueOrThrow({
      where: { outreachId_assigneeUserId: { outreachId, assigneeUserId } },
      include: { assignee: true, assignedBy: true },
    })
    return this.toAssigneeResponse(assignment, resolved.role)
  }

  async unassign(
    organizationSlug: string,
    outreachId: number,
    assigneeUserId: number,
  ): Promise<void> {
    await this.assertOutreachInOrg(organizationSlug, outreachId)
    await this.model.deleteMany({ where: { outreachId, assigneeUserId } })
  }

  async listForOutreach(
    organizationSlug: string,
    outreachId: number,
  ): Promise<OutreachAssignment[]> {
    await this.assertOutreachInOrg(organizationSlug, outreachId)
    return this.findMany({ where: { outreachId } })
  }

  private toAssigneeResponse(
    assignment: OutreachAssignmentWithUsers,
    role: OrganizationRole,
  ): OutreachAssignee {
    return {
      userId: assignment.assigneeUserId,
      name: getUserFullName(assignment.assignee) || null,
      role,
      createdAt: assignment.createdAt,
      assignedByUserId: assignment.assignedByUserId,
      assignedByName: assignment.assignedBy
        ? getUserFullName(assignment.assignedBy) || null
        : null,
    }
  }

  async listAssigneeDetails(
    organizationSlug: string,
    outreachId: number,
  ): Promise<OutreachAssignee[]> {
    await this.assertOutreachInOrg(organizationSlug, outreachId)
    const assignments = await this.model.findMany({
      where: { outreachId },
      include: { assignee: true, assignedBy: true },
    })
    if (!assignments.length) return []

    const memberships = await this.membership.model.findMany({
      where: {
        organizationSlug,
        userId: { in: assignments.map((a) => a.assigneeUserId) },
      },
    })
    const roleByUserId = new Map(memberships.map((m) => [m.userId, m.role]))

    return assignments.map((assignment) => {
      // A userId absent from memberships is the owner: the owner never gets
      // an OrganizationMembership row, and any non-owner member missing one
      // would already have had this row cascade-deleted on removal.
      const role =
        roleByUserId.get(assignment.assigneeUserId) ?? OrganizationRole.owner
      return this.toAssigneeResponse(assignment, role)
    })
  }

  listMine(
    organizationSlug: string,
    userId: number,
  ): Promise<OutreachAssignment[]> {
    return this.findMany({
      where: { organizationSlug, assigneeUserId: userId },
    })
  }

  // GET /outreach/assignments/mine: joins each assignment back to its
  // envelope and, for the two native channels, hydrates the same
  // phoneBanking/doorKnocking progress block OutreachSocialService.findDetail
  // computes for the history drawer — reused rather than re-derived, per
  // AGENTS.md's ADR 0010 (one aggregate, not two that can disagree).
  async listMineDetailed(
    organizationSlug: string,
    userId: number,
  ): Promise<MyAssignment[]> {
    const assignments = await this.listMine(organizationSlug, userId)
    if (!assignments.length) return []

    const outreachRows = await this.client.outreach.findMany({
      where: { id: { in: assignments.map((a) => a.outreachId) } },
    })
    const outreachById = new Map(outreachRows.map((o) => [o.id, o]))

    const rows = assignments
      .map((assignment) => ({
        assignment,
        // The FK is Cascade, so an assignment never outlives its outreach —
        // this only guards the Map's generic `| undefined`, not a real gap.
        outreach: outreachById.get(assignment.outreachId),
      }))
      .filter(
        (row): row is { assignment: OutreachAssignment; outreach: Outreach } =>
          row.outreach !== undefined,
      )

    return Promise.all(
      rows.map(({ assignment, outreach }) =>
        this.toMyAssignment(assignment, outreach),
      ),
    )
  }

  private async toMyAssignment(
    assignment: OutreachAssignment,
    outreach: Outreach,
  ): Promise<MyAssignment> {
    const phoneBanking =
      outreach.outreachType === OutreachType.nativePhoneBanking &&
      outreach.phoneBankingListId !== null
        ? await this.outreachSocial.computePhoneBankingDetail(
            outreach.phoneBankingListId,
          )
        : undefined
    // Same guard + scope as findDetail: the envelope's own org, never the
    // header's, and a legacy null-org row simply carries no block.
    const doorKnocking =
      outreach.outreachType === OutreachType.nativeDoorKnocking &&
      outreach.doorKnockingRouteId !== null &&
      outreach.organizationSlug !== null
        ? await this.outreachSocial.computeDoorKnockingDetail(
            outreach.doorKnockingRouteId,
            outreach.organizationSlug,
            outreach,
          )
        : undefined

    return {
      outreachId: outreach.id,
      outreachType: outreach.outreachType,
      name: outreach.name,
      status: outreach.status,
      assignedAt: assignment.createdAt,
      phoneBanking,
      doorKnocking,
    }
  }

  async existsFor(outreachId: number, userId: number): Promise<boolean> {
    const found = await this.model.findUnique({
      where: {
        outreachId_assigneeUserId: { outreachId, assigneeUserId: userId },
      },
    })
    return found !== null
  }

  async deleteAllForMember(
    organizationSlug: string,
    userId: number,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.client
    await client.outreachAssignment.deleteMany({
      where: { organizationSlug, assigneeUserId: userId },
    })
  }
}
