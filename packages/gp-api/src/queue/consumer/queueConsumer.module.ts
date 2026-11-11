import { Module } from '@nestjs/common'
import { SqsModule } from '@ssut/nestjs-sqs'
import { QueueConsumerService } from './queueConsumer.service'
import { queueConfig } from '../queue.config'

@Module({
  imports: [
    SqsModule.register({
      consumers: [
        {
          ...queueConfig,
          pollingWaitTimeMs: 1000,
        },
      ],
    }),
  ],
  providers: [QueueConsumerService],
})
export class QueueConsumerModule {}
