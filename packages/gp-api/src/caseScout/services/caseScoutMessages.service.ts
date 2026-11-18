import { Injectable } from '@nestjs/common'
import { z } from 'zod'
import { ChatMessageSegmentKind, Prisma } from '@/generated/prisma'
import { DistrictsService } from '@/electionDb/districts/districts.service'
import { PositionsService } from '@/electionDb/positions/positions.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import type { Message } from '../util/sessions.util'
import { FeaturesService } from '@/features/services/features.service'
import {
  agentMessagesToChatMessages,
  CHAT_AGENT_MESSAGE_FLAG,
  StoredAgentMessage,
} from '@/chats/services/chatAgentMessages.util'

// The Databricks view this replaces paged 2,000 rows 25 times; same bound.
const MAX_MESSAGES_PER_READ = 50_000

// The product chats digest's staff and test-account rule. The owner's email
// is read here and never leaves this file.
const INTERNAL_EMAIL_RULES: Prisma.UserWhereInput[] = [
  { email: { endsWith: '@goodparty.org', mode: Prisma.QueryMode.insensitive } },
  { email: { contains: '+test', mode: Prisma.QueryMode.insensitive } },
  { email: { contains: 'mailinator', mode: Prisma.QueryMode.insensitive } },
]

const isInternalEmail = (email: string): boolean => {
  const lowered = email.toLowerCase()
  return (
    lowered.endsWith('@goodparty.org') ||
    lowered.includes('+test') ||
    lowered.includes('mailinator')
  )
}

// `office` is the legacy key older campaigns still carry; it is not in the
// typed details.
const DenylistDetailsSchema = z
  .object({
    campaignCommittee: z.string().nullish().catch(undefined),
    office: z.string().nullish().catch(undefined),
    city: z.string().nullish().catch(undefined),
    county: z.string().nullish().catch(undefined),
    district: z.string().nullish().catch(undefined),
  })
  .catch({})

const ElectionIdSchema = z.uuid()

const messageSelect = {
  id: true,
  conversationId: true,
  role: true,
  content: true,
  createdAt: true,
  segments: {
    where: { kind: ChatMessageSegmentKind.tool },
    orderBy: { ordinal: Prisma.SortOrder.asc },
    select: { toolName: true, payload: true },
  },
} satisfies Prisma.ChatMessageSelect

type MessageRow = Prisma.ChatMessageGetPayload<{
  select: typeof messageSelect
}>

type ConversationContext = {
  scope: string
  isInternal: boolean
  denylist: string[]
}

// Reads chat messages the way the case_scout_messages view did: deleted
// conversations left out, each message's tool calls (never their results),
// a per-conversation staff flag and a per-conversation denylist of names and
// places for the PII gate.
@Injectable()
export class CaseScoutMessagesService extends createPrismaBase(
  MODELS.ChatMessage,
) {
  constructor(
    private readonly positions: PositionsService,
    private readonly districts: DistrictsService,
    private readonly features: FeaturesService,
  ) {
    super()
  }

  private readsAgentMessages(): Promise<boolean> {
    return this.features.isGlobalFeatureEnabled(CHAT_AGENT_MESSAGE_FLAG)
  }

  // AgentMessage rows as the messages the reader takes: each conversation's
  // rows read back as its chat turns, in the order readSince sorts them. A
  // turn's rows share one createdAt, so a time window never splits one.
  private agentRowsToMessageRows(rows: StoredAgentMessage[]): MessageRow[] {
    const byConversation = new Map<string, StoredAgentMessage[]>()
    for (const row of rows) {
      if (!row.conversationId) continue
      const list = byConversation.get(row.conversationId) ?? []
      list.push(row)
      byConversation.set(row.conversationId, list)
    }
    return [...byConversation.values()]
      .flatMap((list) => agentMessagesToChatMessages(list))
      .map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        segments: m.segments
          .filter((segment) => segment.kind === ChatMessageSegmentKind.tool)
          .map((segment) => ({
            toolName: segment.toolName,
            payload: segment.payload,
          })),
      }))
      .sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.conversationId.localeCompare(b.conversationId) ||
          a.id.localeCompare(b.id),
      )
  }

  async readSince(since: Date, dropInternal: boolean): Promise<Message[]> {
    if (await this.readsAgentMessages()) {
      const agentRows = await this.client.agentMessage.findMany({
        where: {
          createdAt: { gte: since },
          conversation: {
            deletedAt: null,
            ...(dropInternal
              ? { owner: { NOT: { OR: INTERNAL_EMAIL_RULES } } }
              : {}),
          },
        },
        orderBy: [
          { createdAt: Prisma.SortOrder.asc },
          { conversationId: Prisma.SortOrder.asc },
          { index: Prisma.SortOrder.asc },
        ],
        take: MAX_MESSAGES_PER_READ,
      })
      return this.withContext(this.agentRowsToMessageRows(agentRows))
    }
    const rows = await this.model.findMany({
      where: {
        createdAt: { gte: since },
        conversation: {
          deletedAt: null,
          ...(dropInternal
            ? { owner: { NOT: { OR: INTERNAL_EMAIL_RULES } } }
            : {}),
        },
      },
      orderBy: [
        { createdAt: Prisma.SortOrder.asc },
        { conversationId: Prisma.SortOrder.asc },
        { id: Prisma.SortOrder.asc },
      ],
      take: MAX_MESSAGES_PER_READ,
      select: messageSelect,
    })
    return this.withContext(rows)
  }

  async readByIds(messageIds: string[]): Promise<Message[]> {
    if (await this.readsAgentMessages()) {
      const keyRows = await this.client.agentMessage.findMany({
        where: { id: { in: messageIds } },
        select: { conversationId: true },
      })
      const conversationIds = [
        ...new Set(keyRows.flatMap((row) => row.conversationId ?? [])),
      ]
      const agentRows = await this.client.agentMessage.findMany({
        where: {
          conversationId: { in: conversationIds },
          conversation: { deletedAt: null },
        },
        orderBy: [
          { conversationId: Prisma.SortOrder.asc },
          { index: Prisma.SortOrder.asc },
        ],
      })
      const wanted = new Set(messageIds)
      return this.withContext(
        this.agentRowsToMessageRows(agentRows).filter((row) =>
          wanted.has(row.id),
        ),
      )
    }
    const rows = await this.model.findMany({
      where: { id: { in: messageIds }, conversation: { deletedAt: null } },
      orderBy: [
        { createdAt: Prisma.SortOrder.asc },
        { id: Prisma.SortOrder.asc },
      ],
      select: messageSelect,
    })
    return this.withContext(rows)
  }

  private async withContext(rows: MessageRow[]): Promise<Message[]> {
    const contexts = await this.conversationContexts([
      ...new Set(rows.map((row) => row.conversationId)),
    ])
    return rows.flatMap((row): Message[] => {
      const context = contexts.get(row.conversationId)
      if (!context) return []
      return [
        {
          conversationId: row.conversationId,
          scope: context.scope,
          messageId: row.id,
          role: row.role,
          content: row.content,
          createdAt: row.createdAt,
          toolCalls: row.segments.map((segment) => ({
            tool: segment.toolName,
            input:
              segment.payload === null ? null : JSON.stringify(segment.payload),
          })),
          isInternal: context.isInternal,
          denylist: context.denylist,
        },
      ]
    })
  }

  private async conversationContexts(
    conversationIds: string[],
  ): Promise<Map<string, ConversationContext>> {
    if (conversationIds.length === 0) return new Map()
    const conversations = await this.client.chatConversation.findMany({
      where: { id: { in: conversationIds }, deletedAt: null },
      select: {
        id: true,
        scope: true,
        organizationSlug: true,
        owner: { select: { email: true, firstName: true, lastName: true } },
      },
    })
    const slugs = [
      ...new Set(
        conversations.flatMap((c) =>
          c.organizationSlug ? [c.organizationSlug] : [],
        ),
      ),
    ]
    const organizations = slugs.length
      ? await this.client.organization.findMany({
          where: { slug: { in: slugs } },
          select: {
            slug: true,
            positionId: true,
            overrideDistrictId: true,
            customPositionName: true,
            owner: { select: { firstName: true, lastName: true } },
            campaign: { select: { details: true } },
          },
        })
      : []
    const orgBySlug = new Map(organizations.map((org) => [org.slug, org]))

    const electionIds = (ids: Array<string | null>) => [
      ...new Set(
        ids.filter(
          (id): id is string => ElectionIdSchema.safeParse(id).success,
        ),
      ),
    ]
    const positionIds = electionIds(organizations.map((o) => o.positionId))
    const overrideIds = electionIds(
      organizations.map((o) => o.overrideDistrictId),
    )
    const positions = positionIds.length
      ? await this.positions.findMany({
          where: { id: { in: positionIds } },
          select: {
            id: true,
            name: true,
            district: { select: { L2DistrictName: true } },
          },
        })
      : []
    const overrideDistricts = overrideIds.length
      ? await this.districts.findMany({
          where: { id: { in: overrideIds } },
          select: { id: true, L2DistrictName: true },
        })
      : []
    const positionById = new Map(positions.map((p) => [p.id, p]))
    const districtNameById = new Map(
      overrideDistricts.map((d) => [d.id, d.L2DistrictName]),
    )

    return new Map(
      conversations.map((conversation) => {
        const org = conversation.organizationSlug
          ? orgBySlug.get(conversation.organizationSlug)
          : undefined
        const details = DenylistDetailsSchema.parse(
          org?.campaign?.details ?? {},
        )
        const position = org?.positionId
          ? positionById.get(org.positionId)
          : undefined
        const terms = [
          conversation.owner.firstName,
          conversation.owner.lastName,
          org?.owner.firstName,
          org?.owner.lastName,
          details.campaignCommittee,
          position?.name,
          org?.customPositionName,
          details.office,
          details.city,
          details.county,
          details.district,
          position?.district?.L2DistrictName,
          org?.overrideDistrictId
            ? districtNameById.get(org.overrideDistrictId)
            : undefined,
        ]
        const denylist = [
          ...new Set(
            terms.flatMap((term) => {
              const trimmed = term?.trim()
              return trimmed ? [trimmed] : []
            }),
          ),
        ]
        return [
          conversation.id,
          {
            scope: conversation.scope,
            isInternal: isInternalEmail(conversation.owner.email),
            denylist,
          },
        ]
      }),
    )
  }
}
