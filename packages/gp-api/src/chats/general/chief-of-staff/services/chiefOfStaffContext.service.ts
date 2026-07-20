import { Injectable, NotFoundException } from '@nestjs/common'
import { ChatScope, type Organization } from '../../../../generated/prisma'
import type { MandatoryFilter } from '@/llm/tools/districtInsights.tool'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { ChatAnchorSchema, type ChatAnchor } from '@goodparty_org/contracts'
import { PrioritiesToolPort, PriorityRecord } from './prioritiesPort'

export interface ChiefOfStaffContext {
  conversationId: string
  electedOfficeId: string
  organizationSlug: string
  // The full org row (already loaded via the electedOffice include) so the
  // CRM contact tools can call ContactsService with the same Organization
  // the HTTP routes receive.
  organization: Organization
  userFirstName: string | null
  userLastName: string | null
  officeTitle: string | null
  jurisdiction: string | null
  swornInDate: Date | null
  priorities: PriorityRecord[]
  anchor: ChatAnchor | null
  // Server-bound district predicate for constituent-data queries. The context
  // service leaves this null; the handler fills it from DistrictResolverService
  // (which also populates jurisdiction).
  districtFilters: MandatoryFilter[] | null
  // Whether the per-user cos-constituent-data-tool flag is on. The context
  // service defaults it false; the handler resolves it from FeaturesService.
  constituentToolEnabled: boolean
  // Whether the serve-crm flag enables the contact describe/count tools.
  // Defaults false here; the handler resolves it from FeaturesService.
  crmToolsEnabled: boolean
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

    const rawAnchor = conversation.anchor
    const anchorParsed = rawAnchor
      ? ChatAnchorSchema.safeParse(rawAnchor)
      : null
    if (anchorParsed && !anchorParsed.success) {
      this.logger.warn(
        { conversationId, error: anchorParsed.error },
        'chiefOfStaffContext: anchor parse failed; degrading to null',
      )
    }
    const anchor: ChatAnchor | null = anchorParsed?.success
      ? anchorParsed.data
      : null

    return {
      conversationId,
      electedOfficeId: electedOffice.id,
      organizationSlug: electedOffice.organizationSlug,
      organization: electedOffice.organization,
      userFirstName: electedOffice.user?.firstName ?? null,
      userLastName: electedOffice.user?.lastName ?? null,
      officeTitle: electedOffice.organization.customPositionName,
      jurisdiction: null,
      swornInDate: electedOffice.swornInDate,
      priorities,
      anchor,
      districtFilters: null,
      constituentToolEnabled: false,
      crmToolsEnabled: false,
    }
  }
}
