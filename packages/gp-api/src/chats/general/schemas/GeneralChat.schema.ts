import {
  ChatConversationSchema,
  ChatHistoryQuerySchema,
  ChatHistoryResponseSchema,
  CreateChatRequestSchema,
  CreateChatResponseSchema,
  SendChatMessageRequestSchema,
} from '@goodparty_org/contracts'
import { createZodDto } from 'nestjs-zod'

export class CreateChatDto extends createZodDto(CreateChatRequestSchema) {}
export class SendChatMessageDto extends createZodDto(
  SendChatMessageRequestSchema,
) {}
export class ChatHistoryQueryDto extends createZodDto(ChatHistoryQuerySchema) {}

export {
  ChatConversationSchema,
  ChatHistoryResponseSchema,
  CreateChatResponseSchema,
}
