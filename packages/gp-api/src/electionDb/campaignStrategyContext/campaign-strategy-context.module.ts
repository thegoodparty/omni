import { Module } from '@nestjs/common'
import { CampaignStrategyContextService } from './campaign-strategy-context.service'

@Module({
  providers: [CampaignStrategyContextService],
  exports: [CampaignStrategyContextService],
})
export class CampaignStrategyContextModule {}
