import { Module } from '@nestjs/common'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { CampaignStoryController } from './campaignStory.controller'
import { CampaignStoryService } from './services/campaignStory.service'

@Module({
  imports: [ClerkModule],
  controllers: [CampaignStoryController],
  providers: [CampaignStoryService],
  exports: [CampaignStoryService],
})
export class CampaignStoryModule {}
