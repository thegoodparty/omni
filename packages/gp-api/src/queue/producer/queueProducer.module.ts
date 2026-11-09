import { Module } from '@nestjs/common'
import { QueueProducerService } from './queueProducer.service'
import { CampaignStoryCompletedProducer } from './campaignStoryCompleted.producer'

@Module({
  providers: [QueueProducerService, CampaignStoryCompletedProducer],
  exports: [QueueProducerService, CampaignStoryCompletedProducer],
})
export class QueueProducerModule {}
