import { Injectable, NotFoundException } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { OutreachAssignmentService } from '@/outreach/services/outreachAssignment.service'
import { OrganizationRole } from '../../generated/prisma'

// Shared by PhoneBankingListService (GET) and PhoneBankingCallService
// (POST calls) so the two caller routes can't drift apart (ENG-11050). A
// volunteer reaches a list only through an OutreachAssignment on its
// outreach envelope — the same existsFor predicate outreachAssignment.mine
// uses — resolved via the envelope's phoneBankingListId (unique), never a
// second copy of the assignment check. 404, not 403: an unassigned
// volunteer must not learn the list exists. No-op for owner/campaignAdmin.
@Injectable()
export class PhoneBankingAccessService extends createPrismaBase(
  MODELS.PhoneBankingList,
) {
  constructor(private readonly assignments: OutreachAssignmentService) {
    super()
  }

  async assertVolunteerAccess(
    listId: number,
    role: OrganizationRole,
    userId: number,
  ): Promise<void> {
    if (role !== OrganizationRole.volunteer) return

    const outreach = await this.client.outreach.findUnique({
      where: { phoneBankingListId: listId },
      select: { id: true },
    })
    const assigned =
      outreach !== null &&
      (await this.assignments.existsFor(outreach.id, userId))
    if (!assigned) {
      throw new NotFoundException('Phone banking list not found')
    }
  }
}
