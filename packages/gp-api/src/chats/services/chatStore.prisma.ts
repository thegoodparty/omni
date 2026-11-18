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
import {
  AgentMessageDraft,
  agentMessagesToChatMessages,
  chatMessageToAgentMessages,
} from './chatAgentMessages.util'

// Returned to a client that reused a user message id for a turn that is not
// its own. Deliberately says nothing about the row that holds the id.
export const USER_MESSAGE_ID_TAKEN = 'That message id is already in use.'


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

// The rows of one turn, numbered from the conversation's next free index.
// The caller holds the conversation lock, so nothing else is numbering.
const nextIndex = async (
  tx: Prisma.TransactionClient,
  conversationId: string,
): Promise<number> => {
  const last = await tx.agentMessage.findFirst({
    where: { conversationId },
    orderBy: { index: Prisma.SortOrder.desc },
    select: { index: true },
  })
  return last === null ? 0 : last.index + 1
}

const insertDrafts = async (
  tx: Prisma.TransactionClient,
  conversationId: string,
  drafts: AgentMessageDraft[],
  firstIndex: number,
  createdAt?: Date,
): Promise<string[]> => {
  const ids: string[] = []
  for (const [i, draft] of drafts.entries()) {
    const row = await tx.agentMessage.create({
      data: {
        ...(draft.id !== undefined && { id: draft.id }),
        conversationId,
        index: firstIndex + i,
        role: draft.role,
        parts: draft.parts,
        model: draft.model ?? null,
        inputTokens: draft.inputTokens ?? null,
        outputTokens: draft.outputTokens ?? null,
        cacheReadTokens: draft.cacheReadTokens ?? null,
        cacheWriteTokens: draft.cacheWriteTokens ?? null,
        ...(createdAt !== undefined && { createdAt }),
      },
    })
    ids.push(row.id)
  }
  return ids
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
  findConversationByIdAndOwner(id: string, ownerUserId: number) {
    return this.findFirst({
      where: { id, ownerUserId, deletedAt: null },
    })
  }

  async listMessagesByConversation(
    conversationId: string,
  ): Promise<ChatMessageWithSegments[]> {
    return agentMessagesToChatMessages(
      await this.client.agentMessage.findMany({
        where: { conversationId, conversation: { deletedAt: null } },
        orderBy: { index: Prisma.SortOrder.asc },
        select: agentMessageSelect,
      }),
    )
  }

  async listRecentMessagesByConversation(
    conversationId: string,
    limit: number,
  ): Promise<ChatMessageWithSegments[]> {
    const take = limit * AGENT_ROWS_PER_RECENT_MESSAGE
    const rows = await this.client.agentMessage.findMany({
      where: { conversationId, conversation: { deletedAt: null } },
      orderBy: { index: Prisma.SortOrder.desc },
      take,
      select: agentMessageSelect,
    })
    const messages = agentMessagesToChatMessages(rows.reverse())
    // A full page may start partway into a turn; that message is dropped.
    return (rows.length === take ? messages.slice(1) : messages).slice(-limit)
  }

  async appendMessage(args: {
    conversationId: string
    role: ChatMessageRole
    content: string
    segments?: PersistedSegment[]
    inputTokens?: number
    outputTokens?: number
    // The turn's real AgentMessage rows; without them the message is stored
    // as its own single row.
    agentMessages?: AgentMessageDraft[]
  }): Promise<ChatMessage> {
    const drafts =
      args.agentMessages ??
      chatMessageToAgentMessages({
        role: args.role,
        content: args.content,
        model: null,
        inputTokens: args.inputTokens ?? null,
        outputTokens: args.outputTokens ?? null,
        segments: (args.segments ?? []).map((s, i) => ({
          id: `${args.conversationId}:${i}`,
          chatMessageId: args.conversationId,
          ordinal: i,
          kind: s.kind,
          text: s.text ?? null,
          toolName: s.toolName ?? null,
          toolCallId: s.toolCallId ?? null,
          payload: s.payload ?? null,
        })),
      })
    return this.client.$transaction(async (tx) => {
      await lockConversation(tx, args.conversationId)
      const ids = await insertDrafts(
        tx,
        args.conversationId,
        drafts,
        await nextIndex(tx, args.conversationId),
      )
      return (await this.readOne(tx, ids[ids.length - 1]!))!
    })
  }

  // The message a write just produced, read inside the same transaction so it
  // sees the uncommitted rows.
  private async readOne(
    db: Prisma.TransactionClient,
    messageId: string,
  ): Promise<ChatMessage | null> {
    const key = await db.agentMessage.findFirst({
      where: { id: messageId },
      select: { conversationId: true },
    })
    if (!key?.conversationId) return null
    const messages = agentMessagesToChatMessages(
      await db.agentMessage.findMany({
        where: { conversationId: key.conversationId },
        orderBy: { index: Prisma.SortOrder.asc },
        select: agentMessageSelect,
      }),
    )
    return messages.find((m) => m.id === messageId) ?? null
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
    await this.client.agentMessage.updateMany({
      where: { id: messageId, model: null },
      data: {
        model,
        inputTokens,
        outputTokens,
        cacheReadTokens: usage.cacheReadTokens ?? null,
        cacheWriteTokens: usage.cacheWriteTokens ?? null,
      },
    })
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

  // Whether this id is free, or already this conversation's own user turn.
  // Checked before a stream opens its response, so a conflict can still be an
  // HTTP 409 rather than an error frame inside a 200.
  async userMessageIdIsAvailable(args: {
    conversationId: string
    id: string
  }): Promise<boolean> {
    const existing = await this.client.agentMessage.findFirst({
      where: { id: args.id },
      select: { conversationId: true, role: true },
    })
    if (!existing) return true
    return (
      existing.conversationId === args.conversationId &&
      existing.role === AgentMessageRole.user
    )
  }

  // Writes the user turn under the id the client chose, so a second delivery
  // of the same send finds that id taken rather than running the turn twice.
  //
  // The insert is the dedupe: the id is the primary key, so a retry loses the
  // race instead of needing a column to check against. Null means the
  // conversation is gone. `replayed` means this id was already this
  // conversation's user turn, so the caller must not run the turn again.
  async appendUserMessageIfAlive(args: {
    conversationId: string
    ownerUserId: number
    content: string
    id?: string
  }): Promise<{ message: ChatMessage; replayed: boolean } | null> {
    const { conversationId, ownerUserId, content, id } = args
    return this.client.$transaction(async (tx) => {
      const alive = await tx.chatConversation.findFirst({
        where: { id: conversationId, ownerUserId, deletedAt: null },
        select: { id: true },
      })
      if (!alive) return null
      await lockConversation(tx, conversationId)
      if (id !== undefined) {
        const existing = await tx.agentMessage.findFirst({
          where: { id },
          select: { conversationId: true, role: true },
        })
        if (existing) {
          if (
            existing.conversationId !== conversationId ||
            existing.role !== AgentMessageRole.user
          ) {
            throw new ConflictException(USER_MESSAGE_ID_TAKEN)
          }
          return { message: (await this.readOne(tx, id))!, replayed: true }
        }
      }
      const [created] = await insertDrafts(
        tx,
        conversationId,
        [
          {
            ...(id !== undefined && { id }),
            role: AgentMessageRole.user,
            parts: [{ type: 'text', text: content }],
          },
        ],
        await nextIndex(tx, conversationId),
      )
      return { message: (await this.readOne(tx, created!))!, replayed: false }
    })
  }

  // The stored reply to a user turn: the assistant rows that follow it, read
  // back as the one message the client saw. Null when the turn has none, so
  // the caller finishes the turn instead of replaying nothing.
  async replayedReplyTo(userMessageId: string): Promise<ChatMessage | null> {
    const userRow = await this.client.agentMessage.findFirst({
      where: { id: userMessageId },
      select: { conversationId: true, index: true },
    })
    if (!userRow?.conversationId) return null
    const following = await this.client.agentMessage.findMany({
      where: {
        conversationId: userRow.conversationId,
        index: { gt: userRow.index },
      },
      orderBy: { index: Prisma.SortOrder.asc },
      select: agentMessageSelect,
    })
    const nextUser = following.findIndex(
      (row) => row.role === AgentMessageRole.user,
    )
    const turn = nextUser === -1 ? following : following.slice(0, nextUser)
    if (turn.length === 0) return null
    const reply = agentMessagesToChatMessages(turn).at(-1)
    return reply?.role === ChatMessageRole.assistant ? reply : null
  }
}
