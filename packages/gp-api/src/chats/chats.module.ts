import { Module } from '@nestjs/common'
import { LlmModule } from '@/llm/llm.module'
import { ChatMessageFeedbackService } from './services/chatMessageFeedback.prisma'
import { ChatStoreService } from './services/chatStore.prisma'
import { ChatStreamService } from './services/chatStream.service'

@Module({
  imports: [LlmModule],
  providers: [ChatStoreService, ChatStreamService, ChatMessageFeedbackService],
  exports: [ChatStoreService, ChatStreamService, ChatMessageFeedbackService],
})
export class ChatsModule {}
