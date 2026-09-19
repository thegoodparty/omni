import { Module } from '@nestjs/common'
import { LlmModule } from '@/llm/llm.module'
import { AwsModule } from '@/vendors/aws/aws.module'
import { QueueProducerModule } from '@/queue/producer/queueProducer.module'
import { ChatAttachmentsService } from './services/chatAttachments.service'
import { ChatMessageFeedbackService } from './services/chatMessageFeedback.prisma'
import { ChatStoreService } from './services/chatStore.prisma'
import { ChatStreamService } from './services/chatStream.service'

@Module({
  imports: [LlmModule, AwsModule, QueueProducerModule],
  providers: [
    ChatAttachmentsService,
    ChatStoreService,
    ChatStreamService,
    ChatMessageFeedbackService,
  ],
  exports: [
    ChatAttachmentsService,
    ChatStoreService,
    ChatStreamService,
    ChatMessageFeedbackService,
  ],
})
export class ChatsModule {}
