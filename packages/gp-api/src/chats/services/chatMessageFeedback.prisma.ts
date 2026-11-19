import {
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common'
import {
  AgentMessageRole,
  ChatFeedbackKind,
  Prisma,
} from '../../generated/prisma'
import type { ChatMessageFeedback as ChatMessageFeedbackDTO } from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'

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

// Every read and write here names its columns rather than taking Prisma's
// default. Without a select, Prisma lists every mapped column in the SELECT it
// sends (and in a create's or update's RETURNING), so any column added to this
// table is read on every call whether or not anyone wants it.
const FEEDBACK_COLUMNS = {
  id: true,
  conversationId: true,
  agentMessageId: true,
  submitterUserId: true,
  feedback: true,
  comment: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ChatMessageFeedbackSelect

export type RatedFeedback = Prisma.ChatMessageFeedbackGetPayload<{
  select: typeof FEEDBACK_COLUMNS
}>

const toDTO = (row: RatedFeedback): ChatMessageFeedbackDTO => ({
  id: row.id,
  conversationId: row.conversationId,
  messageId: row.agentMessageId ?? '',
  feedback: row.feedback,
  comment: row.comment,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

@Injectable()
export class ChatMessageFeedbackService
  extends createPrismaBase(MODELS.ChatMessageFeedback)
  implements OnApplicationBootstrap
{
  // Temporary, removed with the `agent_message_id` NOT NULL follow-up: the
  // migration that left the column nullable counted the rows without one, but
  // `prisma migrate deploy` never surfaces a Postgres NOTICE, so that number
  // reached no log. Every task reports it at boot instead. Not awaited: a slow
  // or failing count must not delay or fail the container's startup.
  onApplicationBootstrap(): void {
    void (async () => {
      try {
        const unkeyed = await this.model.count({
          where: { agentMessageId: null },
        })
        this.logger.info({ unkeyed }, 'chat_message_feedback unkeyed count')
      } catch (err) {
        this.logger.warn({ err }, 'chat_message_feedback unkeyed count failed')
      }
    })()
  }

  // Ratings the caller left on one thread, keyed by message id, so a replayed
  // transcript restores its own action-bar state. Scoped to the caller: one
  // user never sees another's rating.
  async mapMineByConversation(
    conversationId: string,
    userId: number,
  ): Promise<Map<string, RatedFeedback>> {
    const rows = await this.model.findMany({
      where: { conversationId, submitterUserId: userId },
      select: FEEDBACK_COLUMNS,
    })
    // A rating with no message key belongs to no visible turn, so it restores
    // no action-bar state.
    return new Map(
      rows.flatMap((row) =>
        row.agentMessageId === null ? [] : [[row.agentMessageId, row] as const],
      ),
    )
  }

  async setForMessage(
    args: SetChatMessageFeedbackArgs,
  ): Promise<ChatMessageFeedbackDTO> {
    const { conversationId, messageId, userId, feedback, comment } = args
    await this.assertRatableMessage(conversationId, messageId)

    const commentPatch: { comment?: string | null } =
      comment === undefined ? {} : { comment }

    // Upsert on the AgentMessage key: a re-vote on the same turn updates the
    // rating that is there rather than filing a second one.
    const existing = await this.model.findFirst({
      where: { submitterUserId: userId, agentMessageId: messageId },
      select: { id: true },
    })
    const row = existing
      ? await this.model.update({
          where: { id: existing.id },
          data: { feedback, ...commentPatch },
          select: FEEDBACK_COLUMNS,
        })
      : await this.model.create({
          data: {
            conversationId,
            agentMessageId: messageId,
            submitterUserId: userId,
            feedback,
            ...commentPatch,
          },
          select: FEEDBACK_COLUMNS,
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
        submitterUserId: userId,
        agentMessageId: messageId,
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
    const message = await this.client.agentMessage.findFirst({
      where: {
        id: messageId,
        conversationId,
        role: AgentMessageRole.assistant,
      },
      select: { id: true },
    })
    if (!message) {
      throw new NotFoundException('Message not found')
    }
  }
}
