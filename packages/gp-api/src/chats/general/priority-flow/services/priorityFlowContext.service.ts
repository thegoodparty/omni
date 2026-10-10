import { Injectable, NotFoundException } from '@nestjs/common'
import {
  ChatScope,
  PrioritySource,
  type Organization,
} from '../../../../generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { ChatAnchorSchema, type PriorityStatus } from '@goodparty_org/contracts'
import { PriorityStatusService } from '@/priorities/services/priorityStatus.service'
import type { MandatoryFilter } from '@/llm/tools/districtInsights.tool'
import type { PeopleDataset } from '@/peopleDb/services/peopleDataset.service'
import {
  PriorityFlowOutreachService,
  type PriorityAnchorSummary,
} from './priorityFlowOutreach.service'

export interface PriorityFlowContext {
  conversationId: string
  priorityId: string
  electedOfficeId: string
  organizationSlug: string
  organization: Organization
  officeTitle: string | null
  officialFirstName: string | null
  jurisdiction: string | null
  // Two-letter state from the resolved district, for the date line's zone.
  state?: string | null
  title: string
  description: string
  source: PrioritySource
  status: PriorityStatus
  anchorSummaries: PriorityAnchorSummary[]
  districtFilters: MandatoryFilter[] | null
  constituentToolEnabled: boolean
  // Which people table the constituent-data tool reads. Defaults to 'voters'
  // here; the handler resolves it per turn from PeopleDatasetService.
  peopleDataset: PeopleDataset
}

// Loads the priority_flow context: the conversation's anchored priority, the
// office that owns it, the durable seven-step status, and a resolved line per
// card the thread has already left.
@Injectable()
export class PriorityFlowContextService extends createPrismaBase(
  MODELS.ChatConversation,
) {
  constructor(
    private readonly outreach: PriorityFlowOutreachService,
    private readonly priorityStatus: PriorityStatusService,
  ) {
    super()
  }

  async load(
    conversationId: string,
    userId: number,
  ): Promise<PriorityFlowContext> {
    const conversation = await this.findFirst({
      where: {
        id: conversationId,
        ownerUserId: userId,
        scope: ChatScope.priority_flow,
        deletedAt: null,
      },
    })
    if (!conversation) {
      throw new NotFoundException('Conversation not found')
    }

    const anchorParsed = ChatAnchorSchema.safeParse(conversation.anchor)
    if (
      !anchorParsed.success ||
      anchorParsed.data.resourceType !== 'priority'
    ) {
      throw new NotFoundException('Priority anchor not found')
    }

    const { electedOffice, priority } = await this.resolveOwnedPriority(
      anchorParsed.data.resourceId,
      userId,
      conversation.organizationSlug ?? '',
    )

    // A send whose status write failed after it committed is put out now,
    // before the agent reads the status.
    await this.priorityStatus.healSends(priority.id)
    const status = await this.priorityStatus.read(priority.id)

    const official = await this.client.user.findUnique({
      where: { id: userId },
      select: { firstName: true },
    })

    return {
      conversationId,
      priorityId: priority.id,
      electedOfficeId: electedOffice.id,
      organizationSlug: electedOffice.organizationSlug,
      organization: electedOffice.organization,
      officeTitle: electedOffice.organization.customPositionName,
      officialFirstName: official?.firstName?.trim() || null,
      // Only the district resolver knows the jurisdiction; the handler fills
      // it in loadContext when the org's position resolves.
      jurisdiction: null,
      title: priority.title,
      description: priority.description,
      source: priority.source,
      status,
      anchorSummaries: await this.outreach.summarizeAnchors(priority.id),
      districtFilters: null,
      constituentToolEnabled: false,
      peopleDataset: 'voters',
    }
  }

  // Authorize the create path before a ChatConversation is anchored to a
  // priority: the anchor's resourceId is client-supplied, so the caller's
  // office must own the priority before a conversation record is written for
  // it. load() enforces the same invariant on the message-send path.
  async assertPriorityOwnership(
    priorityId: string,
    userId: number,
    organizationSlug: string,
  ): Promise<void> {
    await this.resolveOwnedPriority(priorityId, userId, organizationSlug)
  }

  private async resolveOwnedPriority(
    priorityId: string,
    userId: number,
    organizationSlug: string,
  ) {
    const electedOffice = await this.client.electedOffice.findFirst({
      where: { userId, organizationSlug },
      include: { organization: true },
    })
    if (!electedOffice) {
      throw new NotFoundException('Elected office not found')
    }
    const priority = await this.client.priority.findFirst({
      where: {
        id: priorityId,
        electedOfficeId: electedOffice.id,
        archivedAt: null,
      },
    })
    if (!priority) {
      throw new NotFoundException('Priority not found')
    }
    return { electedOffice, priority }
  }
}
