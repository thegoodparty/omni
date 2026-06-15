import { Injectable, NotFoundException } from '@nestjs/common'
import { ChatScope } from '../../../../generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { PrioritiesToolPort, PriorityRecord } from './prioritiesPort'

export interface ChiefOfStaffContext {
  conversationId: string
  electedOfficeId: string
  userFirstName: string | null
  userLastName: string | null
  officeTitle: string | null
  jurisdiction: string | null
  swornInDate: Date | null
  priorities: PriorityRecord[]
}

// Loads the static CoS context from the conversation's owning user + their
// elected office, plus the active priorities (via the slice-1 port).
@Injectable()
export class ChiefOfStaffContextService extends createPrismaBase(
  MODELS.ChatConversation,
) {
  async load(
    conversationId: string,
    userId: number,
    port: PrioritiesToolPort,
  ): Promise<ChiefOfStaffContext> {
    const conversation = await this.findFirst({
      where: {
        id: conversationId,
        ownerUserId: userId,
        scope: ChatScope.chief_of_staff,
        deletedAt: null,
      },
    })
    if (!conversation) {
      throw new NotFoundException('Conversation not found')
    }

    const electedOffice = await this.client.electedOffice.findFirst({
      where: { userId, organizationSlug: conversation.organizationSlug ?? '' },
      include: { organization: true, user: true },
    })
    if (!electedOffice) {
      throw new NotFoundException('Elected office not found')
    }

    const priorities = await port.listActive(electedOffice.id)

    return {
      conversationId,
      electedOfficeId: electedOffice.id,
      userFirstName: electedOffice.user?.firstName ?? null,
      userLastName: electedOffice.user?.lastName ?? null,
      officeTitle: electedOffice.organization.customPositionName,
      jurisdiction: null,
      swornInDate: electedOffice.swornInDate,
      priorities,
    }
  }
}
