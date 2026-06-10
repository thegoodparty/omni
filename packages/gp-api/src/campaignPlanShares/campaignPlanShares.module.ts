import { Module } from '@nestjs/common'
import { AwsModule } from '@/vendors/aws/aws.module'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { CampaignPlanSharesController } from './campaignPlanShares.controller'
import { CampaignPlanSharesRateLimitGuard } from './guards/campaignPlanSharesRateLimit.guard'
import { CampaignPlanSharesService } from './services/campaignPlanShares.service'

@Module({
  // ClerkModule satisfies UseCampaignGuard's ClerkUserEnricherService dep
  imports: [AwsModule, ClerkModule],
  controllers: [CampaignPlanSharesController],
  providers: [CampaignPlanSharesService, CampaignPlanSharesRateLimitGuard],
})
export class CampaignPlanSharesModule {}
