import { Module } from '@nestjs/common'
import { AwsModule } from '@/vendors/aws/aws.module'
import { CampaignPlanSharesController } from './campaignPlanShares.controller'
import { CampaignPlanShareUploadController } from './campaignPlanShareUpload.controller'
import { CampaignPlanSharesRateLimitGuard } from './guards/campaignPlanSharesRateLimit.guard'
import { CampaignPlanSharesService } from './services/campaignPlanShares.service'

@Module({
  imports: [AwsModule],
  controllers: [
    CampaignPlanSharesController,
    CampaignPlanShareUploadController,
  ],
  providers: [CampaignPlanSharesService, CampaignPlanSharesRateLimitGuard],
})
export class CampaignPlanSharesModule {}
