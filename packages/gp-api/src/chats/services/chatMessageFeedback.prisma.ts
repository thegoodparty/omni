import { Injectable, NotFoundException } from '@nestjs/common'
import {
  AgentMessageRole,
  ChatFeedbackKind,
  ChatMessageFeedback,
  ChatMessageRole,
} from '../../generated/prisma'
import type { ChatMessageFeedback as ChatMessageFeedbackDTO } from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { FeaturesService } from '@/features/services/features.service'
import { CHAT_AGENT_MESSAGE_FLAG } from './chatAgentMessages.util'

// `comment` carries three states on the wire, matching the artifact-feedback
// service: `undefined` leaves the stored note alone (a re-vote without
// retyping), `null` clears it, a string replaces it.
export type SetChatMessageFeedbackArgs = {
  conversationId: string
  messageId: string
  userId: number
  feedback: ChatFeedbackKind
  comment?: string | null
}

const toDTO = (row: ChatMessageFeedback): ChatMessageFeedbackDTO => ({
  id: row.id,
  conversationId: row.conversationId,
  messageId: row.chatMessageId,
  feedback: row.feedback,
  comment: row.comment,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

@Injectable()
export class ChatMessageFeedbackService extends createPrismaBase(
  MODELS.ChatMessageFeedback,
) {
  constructor(private readonly features: FeaturesService) {
    super()
  }

  // Ratings the caller left on one thread, keyed by message id, so a replayed
  // transcript restores its own action-bar state. Scoped to the caller: one
  // user never sees another's rating.
  async mapMineByConversation(
    conversationId: string,
    userId: number,
  ): Promise<Map<string, ChatMessageFeedback>> {
    const rows = await this.findMany({
      where: { conversationId, submitterUserId: userId },
    })
    return new Map(rows.map((row) => [row.chatMessageId, row]))
  }

  async setForMessage(
    args: SetChatMessageFeedbackArgs,
  ): Promise<ChatMessageFeedbackDTO> {
    const { conversationId, messageId, userId, feedback, comment } = args
    await this.assertRatableMessage(conversationId, messageId)

    const commentPatch: { comment?: string | null } =
      comment === undefined ? {} : { comment }

    const row = await this.model.upsert({
      where: {
        submitterUserId_chatMessageId: {
          submitterUserId: userId,
          chatMessageId: messageId,
        },
      },
      create: {
        conversationId,
        chatMessageId: messageId,
        submitterUserId: userId,
        feedback,
        ...commentPatch,
      },
      update: { feedback, ...commentPatch },
    })
    return toDTO(row)
  }

  async clearForMessage(args: {
    conversationId: string
    messageId: string
    userId: number
  }): Promise<void> {
    const { conversationId, messageId, userId } = args
    // Same gate as setForMessage: retracting a rating on a message that isn't
    // a ratable turn of this conversation is a client bug, and a silent 204
    // hides it. Deleting nothing is still a 204 — only the id is validated.
    await this.assertRatableMessage(conversationId, messageId)
    await this.model.deleteMany({
      where: {
        conversationId,
        chatMessageId: messageId,
        submitterUserId: userId,
      },
    })
  }

  // A rating only means something against an assistant turn in the thread the
  // caller has already been granted access to — reject a message id borrowed
  // from another conversation rather than writing an orphan row.
  private async assertRatableMessage(
    conversationId: string,
    messageId: string,
  ): Promise<void> {
    // A turn's last AgentMessage row carries its ChatMessage id, so the same
    // id rates either way.
    const message = (await this.features.isGlobalFeatureEnabled(
      CHAT_AGENT_MESSAGE_FLAG,
    ))
      ? await this.client.agentMessage.findFirst({
          where: {
            id: messageId,
            conversationId,
            role: AgentMessageRole.assistant,
          },
          select: { id: true },
        })
      : await this.client.chatMessage.findFirst({
          where: {
            id: messageId,
            conversationId,
            role: ChatMessageRole.assistant,
          },
          select: { id: true },
        })
    if (!message) {
      throw new NotFoundException('Message not found')
    }
  }
}
