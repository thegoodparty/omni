import { Injectable, NotFoundException } from '@nestjs/common'
import { ChatScope, type Organization } from '../../../../generated/prisma'
import type { MandatoryFilter } from '@/llm/tools/districtInsights.tool'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { ChatAnchorSchema, type ChatAnchor } from '@goodparty_org/contracts'
import { PrioritiesToolPort, PriorityRecord } from './prioritiesPort'
import { FeaturesService } from '@/features/services/features.service'
import { SERVE_CHAT_ATTACHMENTS_FLAG } from '@/chats/services/chatAttachments.service'
import { addMilliseconds, isAfter } from 'date-fns'

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
  party: string | null
  electedDate: Date | null
  termStartDate: Date | null
  termEndDate: Date | null
  priorities: PriorityRecord[]
  // True on the holder's very first chief-of-staff conversation, which gates the
  // one-off first-run research block. Counted rather than inferred: the
  // conversational home opens a new conversation per session, so a model asked
  // to judge "does this look like a first message" would redo the research on
  // every visit.
  isFirstConversation: boolean
  anchor: ChatAnchor | null
  // Server-bound district predicate for constituent-data queries. The context
  // service leaves this null; the handler fills it from DistrictResolverService
  // (which also populates jurisdiction).
  districtFilters: MandatoryFilter[] | null
  // Whether the constituent-data tool can register (provider + an approved
  // table configured). The context service defaults it false; the handler
  // resolves the real value from the provider + table allowlist.
  constituentToolEnabled: boolean
  // Whether the serve-chat-attachments flag is on for this user. Cached
  // per user for 60 s to avoid an Amplitude fetchV2 round-trip on every
  // turn; a flag flip takes effect within that window.
  attachmentsEnabled: boolean
}

// Loads the static CoS context from the conversation's owning user + their
// elected office, plus the active priorities (via the slice-1 port).
@Injectable()
export class ChiefOfStaffContextService extends createPrismaBase(
  MODELS.ChatConversation,
) {
  // Amplitude fetchV2 retries cost several seconds per call when the SDK
  // cannot reach the edge — enough to push CI E2E tests into timeout. Cache
  // the boolean per user for a short window so only the first turn in that
  // window incurs the round-trip.
  private static readonly ATTACHMENTS_CACHE_TTL_MS = 60_000
  private readonly attachmentsCache = new Map<
    number,
    { enabled: boolean; expiresAt: Date }
  >()

  constructor(private readonly features: FeaturesService) {
    super()
  }

  private async resolveAttachmentsEnabled(userId: number): Promise<boolean> {
    const now = new Date()
    const hit = this.attachmentsCache.get(userId)
    if (hit !== undefined && isAfter(hit.expiresAt, now)) return hit.enabled
    const enabled = await this.features.isFeatureEnabled({
      user: userId,
      feature: SERVE_CHAT_ATTACHMENTS_FLAG,
    })
    this.attachmentsCache.set(userId, {
      enabled,
      expiresAt: addMilliseconds(
        now,
        ChiefOfStaffContextService.ATTACHMENTS_CACHE_TTL_MS,
      ),
    })
    return enabled
  }

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

    const attachmentsEnabled = await this.resolveAttachmentsEnabled(userId)

    // "First conversation" means they have never actually talked to their
    // chief of staff, so this counts PRIOR conversations that hold at least
    // one message. Excluding the current row keeps the check independent of
    // whether it is already persisted, and requiring a message drops the
    // empty rows a retried POST /chats leaves behind (createScopedConversation
    // takes no idempotency key), which would otherwise make a genuinely
    // first-time user look like a returning one.
    const priorConversations = await this.count({
      where: {
        id: { not: conversationId },
        ownerUserId: userId,
        scope: ChatScope.chief_of_staff,
        // Same coalesce as the electedOffice lookup above: a null slug would
        // otherwise match every null-slug conversation instead of none.
        organizationSlug: conversation.organizationSlug ?? '',
        deletedAt: null,
        messages: { some: {} },
      },
    })

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
      party: electedOffice.party,
      electedDate: electedOffice.electedDate,
      termStartDate: electedOffice.termStartDate,
      termEndDate: electedOffice.termEndDate,
      priorities,
      isFirstConversation: priorConversations === 0,
      anchor,
      districtFilters: null,
      constituentToolEnabled: false,
      attachmentsEnabled,
    }
  }
}
