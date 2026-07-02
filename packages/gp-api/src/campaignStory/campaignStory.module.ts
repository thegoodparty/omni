import { Module } from '@nestjs/common'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { CampaignStoryController } from './campaignStory.controller'
import { CampaignStoryService } from './services/campaignStory.service'
import { CampaignStoryRewriteService } from './services/campaignStoryRewrite.service'

@Module({
  imports: [ClerkModule],
  controllers: [CampaignStoryController],
  providers: [CampaignStoryService, CampaignStoryRewriteService],
  exports: [CampaignStoryService, CampaignStoryRewriteService],
})
export class CampaignStoryModule {}
