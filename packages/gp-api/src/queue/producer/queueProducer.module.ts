import { Module } from '@nestjs/common'
import { QueueProducerService } from './queueProducer.service'

@Module({
  providers: [QueueProducerService],
  exports: [QueueProducerService],
})
export class QueueProducerModule {}
