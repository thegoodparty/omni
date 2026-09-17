import { Module } from '@nestjs/common'
import { CampaignStrategyContextController } from './campaign-strategy-context.controller'
import { CampaignStrategyContextService } from './campaign-strategy-context.service'

@Module({
  controllers: [CampaignStrategyContextController],
  providers: [CampaignStrategyContextService],
})
export class CampaignStrategyContextModule {}
