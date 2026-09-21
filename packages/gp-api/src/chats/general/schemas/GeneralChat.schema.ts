import {
  ChatConversationSchema,
  ChatHistoryQuerySchema,
  ChatHistoryResponseSchema,
  ChatMessageFeedbackSchema,
  CreateChatRequestSchema,
  CreateChatResponseSchema,
  LinkAttachRequestSchema,
  SendChatMessageRequestSchema,
  SetChatMessageFeedbackRequestSchema,
} from '@goodparty_org/contracts'
import { createZodDto } from 'nestjs-zod'

export class CreateChatDto extends createZodDto(CreateChatRequestSchema) {}
export class SendChatMessageDto extends createZodDto(
  SendChatMessageRequestSchema,
) {}
export class ChatHistoryQueryDto extends createZodDto(ChatHistoryQuerySchema) {}
export class SetChatMessageFeedbackDto extends createZodDto(
  SetChatMessageFeedbackRequestSchema,
) {}
export class LinkAttachDto extends createZodDto(LinkAttachRequestSchema) {}

export {
  ChatConversationSchema,
  ChatHistoryResponseSchema,
  ChatMessageFeedbackSchema,
  CreateChatResponseSchema,
}
