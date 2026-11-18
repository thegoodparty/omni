import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

export const SEND_MESSAGE_MAX_LENGTH = 10_000

export const sendMessageSchema = z.object({
  content: z
    .string()
    .min(1)
    .max(SEND_MESSAGE_MAX_LENGTH)
    .transform((v) => v.trim())
    .refine((v) => v.length > 0, { message: 'content must not be empty' }),
  // The user message's own id; a retry reuses it and the insert collides
  // instead of running the turn again.
  id: z.uuid().optional(),
  // The old name for `id`, kept for tabs loaded before the rename.
  clientMessageId: z.uuid().optional(),
})

export const userMessageIdOf = (body: {
  id?: string
  clientMessageId?: string
}): string | undefined => body.id ?? body.clientMessageId

export class SendMessageSchema extends createZodDto(sendMessageSchema) {}
