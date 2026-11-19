import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatFeedbackKind, ChatScope } from '../../generated/prisma'
import { useTestService } from '@/test-service'
import { ChatMessageFeedbackService } from './chatMessageFeedback.prisma'

const service = useTestService()

const seedConversation = () =>
  service.prisma.chatConversation.create({
    data: { ownerUserId: service.user.id, scope: ChatScope.chief_of_staff },
  })

const seedFeedback = async (
  conversationId: string,
  agentMessageId: string | null,
) =>
  service.prisma.chatMessageFeedback.create({
    data: {
      conversationId,
      agentMessageId,
      submitterUserId: service.user.id,
      feedback: ChatFeedbackKind.positive,
    },
  })

describe('ChatMessageFeedbackService unkeyed count at boot', () => {
  let feedback: ChatMessageFeedbackService

  beforeEach(() => {
    feedback = service.app.get(ChatMessageFeedbackService)
  })

  it('logs the number of ratings with no agent message', async () => {
    const conversation = await seedConversation()
    const agentMessage = await service.prisma.agentMessage.create({
      data: {
        conversationId: conversation.id,
        index: 0,
        role: 'assistant',
        parts: [],
      },
    })
    await seedFeedback(conversation.id, agentMessage.id)
    await seedFeedback(conversation.id, null)
    await seedFeedback(conversation.id, null)
    const info = vi.spyOn(feedback.logger, 'info')

    feedback.onApplicationBootstrap()

    await vi.waitFor(() =>
      expect(info).toHaveBeenCalledWith(
        { unkeyed: 2 },
        'chat_message_feedback unkeyed count',
      ),
    )
  })

  it('warns instead of failing startup when the count throws', async () => {
    vi.spyOn(service.prisma.chatMessageFeedback, 'count').mockRejectedValue(
      new Error('database is on fire'),
    )
    const warn = vi.spyOn(feedback.logger, 'warn')
    const info = vi.spyOn(feedback.logger, 'info')

    expect(() => feedback.onApplicationBootstrap()).not.toThrow()
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        { err: new Error('database is on fire') },
        'chat_message_feedback unkeyed count failed',
      ),
    )
    expect(info).not.toHaveBeenCalled()
  })
})
