import { Module } from '@nestjs/common'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { WebsitesModule } from '@/websites/websites.module'
import { QueueProducerModule } from '@/queue/producer/queueProducer.module'
import { CampaignStoryController } from './campaignStory.controller'
import { CampaignStoryService } from './services/campaignStory.service'
import { CampaignStoryRewriteService } from './services/campaignStoryRewrite.service'
import { CampaignStoryStateService } from './services/campaignStoryState.service'

@Module({
  imports: [ClerkModule, WebsitesModule, QueueProducerModule],
  controllers: [CampaignStoryController],
  providers: [
    CampaignStoryService,
    CampaignStoryRewriteService,
    CampaignStoryStateService,
  ],
  exports: [
    CampaignStoryService,
    CampaignStoryRewriteService,
    CampaignStoryStateService,
  ],
})
export class CampaignStoryModule {}
