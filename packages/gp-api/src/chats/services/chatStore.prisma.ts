import { ConflictException, Injectable } from '@nestjs/common'
import {
  AgentMessageRole,
  ChatMessage,
  ChatMessageRole,
  ChatMessageSegment,
  ChatMessageSegmentKind,
  Prisma,
} from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { isUniqueConstraintError } from '@/prisma/util/prismaErrors.util'
import { FeaturesService } from '@/features/services/features.service'
import {
  AgentMessageDraft,
  agentMessagesToChatMessages,
  CHAT_AGENT_MESSAGE_FLAG,
  chatMessageToAgentMessages,
} from './chatAgentMessages.util'

type ChatTxClient = Pick<Prisma.TransactionClient, 'chatMessage'>

const agentMessageSelect = {
  id: true,
  conversationId: true,
  role: true,
  parts: true,
  model: true,
  inputTokens: true,
  outputTokens: true,
  createdAt: true,
} satisfies Prisma.AgentMessageSelect

// Generous enough that the last `limit` messages are almost always whole: a
// turn is one row, or a few when the model called tools.
const AGENT_ROWS_PER_RECENT_MESSAGE = 10

// Every ChatMessage write takes this lock first, so the AgentMessage rows of
// one conversation are numbered in the order their ChatMessages were written.
const lockConversation = async (
  tx: Prisma.TransactionClient,
  conversationId: string,
): Promise<void> => {
  await tx.$queryRaw`SELECT id FROM chat_conversation WHERE id = ${conversationId} FOR UPDATE`
}

// Writes the AgentMessage rows of every ChatMessage in the conversation that
// has none yet, in ChatMessage order. A ChatMessage's rows are found by id:
// its user row, or the last assistant row of its turn, reuses the ChatMessage
// id, so running this again writes nothing. `turn` supplies the rows for the
// message just written when the turn has its real model messages.
const syncAgentMessages = async (
  tx: Prisma.TransactionClient,
  conversationId: string,
  turn?: { chatMessageId: string; drafts: AgentMessageDraft[] },
): Promise<number> => {
  const existing = await tx.agentMessage.findMany({
    where: { conversationId },
    select: { id: true, index: true },
  })
  const missing = await tx.chatMessage.findMany({
    where: { conversationId, id: { notIn: existing.map((row) => row.id) } },
    orderBy: [{ createdAt: Prisma.SortOrder.asc }, { id: Prisma.SortOrder.asc }],
    include: { segments: { orderBy: { ordinal: Prisma.SortOrder.asc } } },
  })
  let index = existing.reduce((max, row) => Math.max(max, row.index + 1), 0)
  let written = 0
  for (const message of missing) {
    const drafts =
      turn?.chatMessageId === message.id
        ? turn.drafts
        : chatMessageToAgentMessages(message)
    if (drafts.length === 0) continue
    const keyRow = drafts.findLastIndex(
      (draft) => draft.role !== AgentMessageRole.tool,
    )
    await tx.agentMessage.createMany({
      data: drafts.map((draft, i) => ({
        ...(i === keyRow && { id: message.id }),
        conversationId,
        index: index + i,
        role: draft.role,
        parts: draft.parts,
        model: draft.model ?? null,
        inputTokens: draft.inputTokens ?? null,
        outputTokens: draft.outputTokens ?? null,
        cacheReadTokens: draft.cacheReadTokens ?? null,
        cacheWriteTokens: draft.cacheWriteTokens ?? null,
        createdAt: message.createdAt,
      })),
    })
    index += drafts.length
    written += drafts.length
  }
  return written
}

// One ordered display block of an assistant turn (see ChatMessageSegment).
export type PersistedSegment = {
  kind: ChatMessageSegmentKind
  text?: string | null
  toolName?: string | null
  payload?: Prisma.InputJsonValue | null
  toolCallId?: string | null
}

export type ChatMessageWithSegments = ChatMessage & {
  segments: ChatMessageSegment[]
}

@Injectable()
export class ChatStoreService extends createPrismaBase(
  MODELS.ChatConversation,
) {
  constructor(private readonly features: FeaturesService) {
    super()
  }

  readsAgentMessages(): Promise<boolean> {
    return this.features.isGlobalFeatureEnabled(CHAT_AGENT_MESSAGE_FLAG)
  }

  findConversationByIdAndOwner(id: string, ownerUserId: number) {
    return this.findFirst({
      where: { id, ownerUserId, deletedAt: null },
    })
  }

  async listMessagesByConversation(
    conversationId: string,
  ): Promise<ChatMessageWithSegments[]> {
    if (await this.readsAgentMessages()) {
      return agentMessagesToChatMessages(
        await this.client.agentMessage.findMany({
          where: { conversationId, conversation: { deletedAt: null } },
          orderBy: { index: Prisma.SortOrder.asc },
          select: agentMessageSelect,
        }),
      )
    }
    return this.client.chatMessage.findMany({
      where: { conversationId, conversation: { deletedAt: null } },
      orderBy: { createdAt: Prisma.SortOrder.asc },
      include: { segments: { orderBy: { ordinal: Prisma.SortOrder.asc } } },
    })
  }

  async listRecentMessagesByConversation(
    conversationId: string,
    limit: number,
  ): Promise<ChatMessageWithSegments[]> {
    if (await this.readsAgentMessages()) {
      const take = limit * AGENT_ROWS_PER_RECENT_MESSAGE
      const rows = await this.client.agentMessage.findMany({
        where: { conversationId, conversation: { deletedAt: null } },
        orderBy: { index: Prisma.SortOrder.desc },
        take,
        select: agentMessageSelect,
      })
      const messages = agentMessagesToChatMessages(rows.reverse())
      // A full page may start partway into a turn; that message is dropped.
      return (rows.length === take ? messages.slice(1) : messages).slice(
        -limit,
      )
    }
    const rows = await this.client.chatMessage.findMany({
      where: { conversationId, conversation: { deletedAt: null } },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      take: limit,
      include: { segments: { orderBy: { ordinal: Prisma.SortOrder.asc } } },
    })
    return rows.reverse()
  }

  async appendMessage(args: {
    conversationId: string
    role: ChatMessageRole
    content: string
    clientMessageId?: string
    segments?: PersistedSegment[]
    inputTokens?: number
    outputTokens?: number
    // The turn's real AgentMessage rows; without them the message is stored
    // the way the backfill stores it.
    agentMessages?: AgentMessageDraft[]
  }): Promise<ChatMessage> {
    const { agentMessages, ...chatArgs } = args
    return this.client.$transaction(async (tx) => {
      await lockConversation(tx, args.conversationId)
      const message = await appendMessageIdempotent(tx, chatArgs)
      await syncAgentMessages(
        tx,
        args.conversationId,
        agentMessages && { chatMessageId: message.id, drafts: agentMessages },
      )
      return message
    })
  }

  // Backfill: writes AgentMessage rows for every ChatMessage of the
  // conversation that has none. Safe to run any number of times.
  syncConversationAgentMessages(conversationId: string): Promise<number> {
    return this.client.$transaction(
      async (tx) => {
        await lockConversation(tx, conversationId)
        return syncAgentMessages(tx, conversationId)
      },
      { timeout: 60_000 },
    )
  }

  // A turn whose AgentMessage rows came from its model messages already
  // carries per-step usage, so only a row still missing it is filled.
  async recordAssistantUsage(
    messageId: string,
    usage: {
      model: string
      inputTokens: number
      outputTokens: number
      cacheReadTokens?: number
      cacheWriteTokens?: number
    },
  ): Promise<void> {
    const { model, inputTokens, outputTokens } = usage
    await this.client.$transaction([
      this.client.chatMessage.update({
        where: { id: messageId },
        data: { model, inputTokens, outputTokens },
      }),
      this.client.agentMessage.updateMany({
        where: { id: messageId, model: null },
        data: {
          model,
          inputTokens,
          outputTokens,
          cacheReadTokens: usage.cacheReadTokens ?? null,
          cacheWriteTokens: usage.cacheWriteTokens ?? null,
        },
      }),
    ])
  }

  async softDeleteConversation(id: string, ownerUserId: number): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const updated = await tx.chatConversation.updateMany({
        where: { id, ownerUserId, deletedAt: null },
        data: { deletedAt: new Date() },
      })
      if (updated.count === 0) return
      await tx.annotation.deleteMany({
        where: { chatConversationId: id },
      })
    })
  }

  appendUserMessageIfAlive(args: {
    conversationId: string
    ownerUserId: number
    content: string
    clientMessageId?: string
  }): Promise<ChatMessage | null> {
    const { conversationId, ownerUserId, content, clientMessageId } = args
    return this.client.$transaction(async (tx) => {
      const alive = await tx.chatConversation.findFirst({
        where: { id: conversationId, ownerUserId, deletedAt: null },
        select: { id: true },
      })
      if (!alive) return null
      await lockConversation(tx, conversationId)
      const message = await appendMessageIdempotent(tx, {
        conversationId,
        role: ChatMessageRole.user,
        content,
        ...(clientMessageId !== undefined && { clientMessageId }),
      })
      await syncAgentMessages(tx, conversationId)
      return message
    })
  }
}

const appendMessageIdempotent = async (
  db: ChatTxClient,
  args: {
    conversationId: string
    role: ChatMessageRole
    content: string
    clientMessageId?: string
    segments?: PersistedSegment[]
    inputTokens?: number
    outputTokens?: number
  },
): Promise<ChatMessage> => {
  const {
    conversationId,
    role,
    content,
    clientMessageId,
    segments,
    inputTokens,
    outputTokens,
  } = args
  // Segments only ride on the server-internal (no clientMessageId) assistant
  // write; user messages never carry them.
  if (clientMessageId === undefined) {
    return db.chatMessage.create({
      data: {
        conversationId,
        role,
        content,
        inputTokens,
        outputTokens,
        ...(segments && segments.length > 0
          ? {
              segments: {
                create: segments.map((s, i) => ({
                  ordinal: i,
                  kind: s.kind,
                  text: s.text ?? null,
                  toolName: s.toolName ?? null,
                  toolCallId: s.toolCallId ?? null,
                  ...(s.payload != null && { payload: s.payload }),
                })),
              },
            }
          : {}),
      },
    })
  }
  const existing = await db.chatMessage.findFirst({
    where: { conversationId, clientMessageId },
  })
  if (existing) {
    if (existing.role !== role || existing.content !== content) {
      throw new ConflictException(
        'clientMessageId reused with different payload',
      )
    }
    return existing
  }
  return createOrReturnRaced(db, {
    conversationId,
    role,
    content,
    clientMessageId,
    inputTokens,
    outputTokens,
  })
}

const createOrReturnRaced = async (
  db: ChatTxClient,
  args: {
    conversationId: string
    role: ChatMessageRole
    content: string
    clientMessageId: string
    inputTokens?: number
    outputTokens?: number
  },
): Promise<ChatMessage> => {
  const { conversationId, role, content, clientMessageId } = args
  try {
    return await db.chatMessage.create({ data: args })
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err
    const raced = await db.chatMessage.findFirst({
      where: { conversationId, clientMessageId },
    })
    if (!raced) throw err
    if (raced.role !== role || raced.content !== content) {
      throw new ConflictException(
        'clientMessageId reused with different payload',
      )
    }
    return raced
  }
}
