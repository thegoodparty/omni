import { ConflictException, Injectable } from '@nestjs/common'
import {
  ChatMessage,
  ChatMessageRole,
  ChatMessageSegment,
  ChatMessageSegmentKind,
  Prisma,
} from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { isUniqueConstraintError } from '@/prisma/util/prismaErrors.util'

type ChatTxClient = Pick<Prisma.TransactionClient, 'chatMessage'>

// One ordered display block of an assistant turn (see ChatMessageSegment).
export type PersistedSegment = {
  kind: ChatMessageSegmentKind
  text?: string | null
  toolName?: string | null
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

  listMessagesByConversation(
    conversationId: string,
  ): Promise<ChatMessageWithSegments[]> {
    return this.client.chatMessage.findMany({
      where: { conversationId, conversation: { deletedAt: null } },
      orderBy: { createdAt: Prisma.SortOrder.asc },
      include: { segments: { orderBy: { ordinal: Prisma.SortOrder.asc } } },
    })
  }

  async listRecentMessagesByConversation(
    conversationId: string,
    limit: number,
  ): Promise<ChatMessage[]> {
    const rows = await this.client.chatMessage.findMany({
      where: { conversationId, conversation: { deletedAt: null } },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      take: limit,
    })
    return rows.reverse()
  }

  async appendMessage(args: {
    conversationId: string
    role: ChatMessageRole
    content: string
    clientMessageId?: string
    segments?: PersistedSegment[]
  }): Promise<ChatMessage> {
    return appendMessageIdempotent(this.client, args)
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
      return appendMessageIdempotent(tx, {
        conversationId,
        role: ChatMessageRole.user,
        content,
        ...(clientMessageId !== undefined && { clientMessageId }),
      })
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
  },
): Promise<ChatMessage> => {
  const { conversationId, role, content, clientMessageId, segments } = args
  // Segments only ride on the server-internal (no clientMessageId) assistant
  // write; user messages never carry them.
  if (clientMessageId === undefined) {
    return db.chatMessage.create({
      data: {
        conversationId,
        role,
        content,
        ...(segments && segments.length > 0
          ? {
              segments: {
                create: segments.map((s, i) => ({
                  ordinal: i,
                  kind: s.kind,
                  text: s.text ?? null,
                  toolName: s.toolName ?? null,
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
  })
}

const createOrReturnRaced = async (
  db: ChatTxClient,
  args: {
    conversationId: string
    role: ChatMessageRole
    content: string
    clientMessageId: string
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
