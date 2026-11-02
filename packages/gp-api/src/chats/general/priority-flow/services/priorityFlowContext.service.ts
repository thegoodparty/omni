import { Injectable, NotFoundException } from '@nestjs/common'
import {
  ChatScope,
  CivicPanelStatus,
  ContactStatusField,
  PrioritySource,
  type Organization,
} from '../../../../generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  ChatAnchorSchema,
  type ManagedCivicPanelStatus,
  type PriorityReadStatus,
  type PriorityStatus,
} from '@goodparty_org/contracts'
import { PriorityStatusService } from '@/priorities/services/priorityStatus.service'
import type { MandatoryFilter } from '@/llm/tools/constituentSql.validator'
import type { PeopleDataset } from '@/peopleDb/services/peopleDataset.service'
import type { ReportBackSend } from '@/outreach/services/outreachReportBack.service'
import type { PriorityAnchorSummary } from './priorityFlowOutreach.service'

export interface PriorityFlowContext {
  conversationId: string
  priorityId: string
  electedOfficeId: string
  organizationSlug: string
  organization: Organization
  officeTitle: string | null
  // First and last name joined; the first name alone when no last name is
  // on file. Every draft introduces the official by it.
  officialName: string | null
  jurisdiction: string | null
  // Two-letter state from the resolved district, for the date line's zone.
  state?: string | null
  title: string
  description: string
  source: PrioritySource
  sourceCommunityIssueId: string | null
  status: PriorityStatus
  anchorSummaries: PriorityAnchorSummary[]
  districtFilters: MandatoryFilter[] | null
  constituentToolEnabled: boolean
  // Which people table the constituent-data tool reads. Defaults to 'voters'
  // here; the handler resolves it per turn from PeopleDatasetService.
  peopleDataset: PeopleDataset
  // Whether read_outreach_feedback registers: the serve-citizen-panels flag
  // for the chatting user, resolved per turn by the handler.
  outreachFeedbackEnabled?: boolean
  // People on the civic panel right now, read per turn behind the same
  // flag. Undefined while it is off, so nothing about a panel reaches the
  // prompt.
  civicPanelMembers?: number
  // The civic panel GoodParty builds for the office, read per turn behind
  // the same flag: null when none is being built (never approved or
  // stopped), undefined while the flag is off or the read failed. Without it the
  // agent sold the round one text as the way to build a civic panel that
  // was already filling for free.
  managedCivicPanel?: PriorityManagedCivicPanel | null
  // This priority's texts whose replies are in, and whether each has been
  // reported back on. Read per turn behind the same flag; undefined while
  // it is off.
  reportBacks?: ReportBackSend[]
  // Answers pooled across this priority's sends against what a good read of
  // the district needs. Read per turn behind the same flag; undefined while
  // it is off.
  readStatus?: PriorityReadStatus
}

// Days are already in the words the agent says them ("Tuesday, November 3").
export interface PriorityManagedCivicPanel {
  status: Exclude<ManagedCivicPanelStatus, 'stopped'>
  members: number
  goalMembers: number
  // The day the next invites go out while building: the first send day
  // before any wave went, then the next wave's. Null otherwise.
  nextSendDate: string | null
  readyWeekOf: string
}

// Loads the priority_flow context: the conversation's anchored priority, the
// office that owns it and the durable seven-step status. The line per card the
// thread has already left is read by the handler, once the office's state is
// known, against that state's day.
@Injectable()
export class PriorityFlowContextService extends createPrismaBase(
  MODELS.ChatConversation,
) {
  constructor(private readonly priorityStatus: PriorityStatusService) {
    super()
  }

  async load(
    conversationId: string,
    userId: number,
  ): Promise<Omit<PriorityFlowContext, 'anchorSummaries'>> {
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
      select: { firstName: true, lastName: true },
    })

    return {
      conversationId,
      priorityId: priority.id,
      electedOfficeId: electedOffice.id,
      organizationSlug: electedOffice.organizationSlug,
      organization: electedOffice.organization,
      officeTitle: electedOffice.organization.customPositionName,
      officialName:
        [official?.firstName, official?.lastName]
          .map((part) => part?.trim())
          .filter(Boolean)
          .join(' ') || null,
      // Only the district resolver knows the jurisdiction; the handler fills
      // it in loadContext when the org's position resolves.
      jurisdiction: null,
      title: priority.title,
      description: priority.description,
      source: priority.source,
      sourceCommunityIssueId: priority.sourceCommunityIssueId,
      status,
      districtFilters: null,
      constituentToolEnabled: false,
      peopleDataset: { base: 'voters' },
    }
  }

  // Authorize the create path before a ChatConversation is anchored to a
  // priority: the anchor's resourceId is client-supplied, so the caller's
  // office must own the priority before a conversation record is written for
  // it. load() enforces the same invariant on the message-send path.
  countCivicPanelMembers(organizationSlug: string): Promise<number> {
    return this.client.contactCurrentStatus.count({
      where: {
        organizationSlug,
        field: ContactStatusField.civic_panel,
        value: CivicPanelStatus.member,
      },
    })
  }

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
