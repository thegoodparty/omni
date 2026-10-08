import { z } from 'zod'
import { ChatConversationUsageSchema, zDate } from '@goodparty_org/contracts'

export const getConversationSchema = z.object({
  conversationId: z.string(),
  messages: z.array(
    z.object({
      id: z.string(),
      role: z.enum(['user', 'assistant', 'system', 'tool']),
      content: z.string(),
      createdAt: zDate(),
    }),
  ),
  usage: ChatConversationUsageSchema,
})

export type GetConversationResponse = z.infer<typeof getConversationSchema>
