import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { OutreachAssignment } from '../../generated/prisma'

@Injectable()
export class OutreachAssignmentService extends createPrismaBase(
  MODELS.OutreachAssignment,
) {
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

  async unassign(outreachId: number, assigneeUserId: number): Promise<void> {
    await this.model.deleteMany({ where: { outreachId, assigneeUserId } })
  }

  listForOutreach(outreachId: number): Promise<OutreachAssignment[]> {
    return this.findMany({ where: { outreachId } })
  }

  listMine(
    organizationSlug: string,
    userId: number,
  ): Promise<OutreachAssignment[]> {
    return this.findMany({
      where: { organizationSlug, assigneeUserId: userId },
    })
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
  ): Promise<void> {
    await this.model.deleteMany({
      where: { organizationSlug, assigneeUserId: userId },
    })
  }
}
