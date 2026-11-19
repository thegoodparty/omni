import { ConflictException, Injectable } from '@nestjs/common'
import {
  AgentMessageRole,
  ChatMessageRole,
  ChatMessageSegmentKind,
  Prisma,
} from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import {
  AgentMessageDraft,
  agentMessagesToChatMessages,
  chatMessageToAgentMessages,
  isObject,
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

// Every message write takes this lock first, so one conversation's rows are
// numbered in the order their turns were written.
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

// One ordered display block of an assistant turn: a run of text, a tool call,
// or a citation. Built from an AgentMessage's parts, never stored as a row.
export type PersistedSegment = {
  kind: ChatMessageSegmentKind
  text?: string | null
  toolName?: string | null
  payload?: Prisma.InputJsonValue | null
  toolCallId?: string | null
}

// A message in the chat API's shape. A turn's model loop is several
// AgentMessage rows; it reads back as the one message the user saw.
export type ChatMessageWithSegments = {
  id: string
  conversationId: string
  role: ChatMessageRole
  content: string
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  createdAt: Date
  segments: DisplaySegment[]
}

export type DisplaySegment = {
  kind: ChatMessageSegmentKind
  text: string | null
  toolName: string | null
  toolCallId: string | null
  payload: Prisma.InputJsonValue | null
  ordinal: number
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
    // A reply cut off mid-stream. Its last text part carries the mark, so a
    // retry of the same send runs the turn again instead of replaying it.
    interrupted?: boolean
  }): Promise<ChatMessageWithSegments> {
    const built =
      args.agentMessages ??
      chatMessageToAgentMessages({
        role: args.role,
        content: args.content,
        model: null,
        inputTokens: args.inputTokens ?? null,
        outputTokens: args.outputTokens ?? null,
        segments: (args.segments ?? []).map((s, i) => ({
          ordinal: i,
          kind: s.kind,
          text: s.text ?? null,
          toolName: s.toolName ?? null,
          toolCallId: s.toolCallId ?? null,
          payload: s.payload ?? null,
        })),
      })
    const drafts = args.interrupted
      ? built.map((draft) => {
          if (draft.role !== AgentMessageRole.assistant) return draft
          const lastText = draft.parts.findLastIndex(
            (part) => isObject(part) && part['type'] === 'text',
          )
          return {
            ...draft,
            parts: draft.parts.map((part, i) =>
              i === lastText && isObject(part)
                ? {
                    ...part,
                    providerOptions: { goodparty: { interrupted: true } },
                  }
                : part,
            ),
          }
        })
      : built
    return this.client.$transaction(async (tx) => {
      await lockConversation(tx, args.conversationId)
      const ids = await insertDrafts(
        tx,
        args.conversationId,
        drafts,
        await nextIndex(tx, args.conversationId),
      )
      // A turn whose last step was empty ends on its tool row; the reply is
      // keyed by its last assistant row.
      const replyIndex = drafts.findLastIndex(
        (draft) => draft.role !== AgentMessageRole.tool,
      )
      return (await this.readOne(tx, ids[replyIndex]!))!
    })
  }

  // The message a write just produced, read inside the same transaction so it
  // sees the uncommitted rows.
  private async readOne(
    db: Prisma.TransactionClient,
    messageId: string,
  ): Promise<ChatMessageWithSegments | null> {
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
  }): Promise<{ message: ChatMessageWithSegments; replayed: boolean } | null> {
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

  // The stored reply to a user turn in the caller's own conversation: the
  // assistant rows that follow it, read back as the one message the client
  // saw. Null when the turn has none or was cut off mid-stream, so the caller
  // finishes the turn instead of replaying nothing or a partial reply.
  async replayedReplyTo(args: {
    userMessageId: string
    conversationId: string
    ownerUserId: number
  }): Promise<ChatMessageWithSegments | null> {
    const userRow = await this.client.agentMessage.findFirst({
      where: {
        id: args.userMessageId,
        conversationId: args.conversationId,
        role: AgentMessageRole.user,
        conversation: { ownerUserId: args.ownerUserId, deletedAt: null },
      },
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
    const interrupted = turn.some(
      (row) =>
        Array.isArray(row.parts) &&
        row.parts.some((part) => {
          if (!isObject(part)) return false
          const options = part['providerOptions']
          if (!isObject(options)) return false
          const goodparty = options['goodparty']
          return isObject(goodparty) && goodparty['interrupted'] === true
        }),
    )
    if (interrupted) return null
    const reply = agentMessagesToChatMessages(turn).at(-1)
    return reply?.role === ChatMessageRole.assistant ? reply : null
  }
}
