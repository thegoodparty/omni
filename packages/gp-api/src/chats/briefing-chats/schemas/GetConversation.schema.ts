import { z } from 'zod'
import { zDate } from '@goodparty_org/contracts'

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
})

export type GetConversationResponse = z.infer<typeof getConversationSchema>
