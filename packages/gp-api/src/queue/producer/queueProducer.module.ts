import { Module } from '@nestjs/common'
import { QueueProducerService } from './queueProducer.service'
import { QueueProducerController } from './queueProducer.controller'
import { CampaignStoryCompletedProducer } from './campaignStoryCompleted.producer'

@Module({
  controllers: [QueueProducerController],
  providers: [QueueProducerService, CampaignStoryCompletedProducer],
  exports: [QueueProducerService, CampaignStoryCompletedProducer],
})
export class QueueProducerModule {}
