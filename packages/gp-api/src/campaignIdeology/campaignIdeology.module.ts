import { Module } from '@nestjs/common'
import { LlmModule } from '@/llm/llm.module'
import { CampaignIdeologyService } from './services/campaignIdeology.service'

@Module({
  imports: [LlmModule],
  providers: [CampaignIdeologyService],
  exports: [CampaignIdeologyService],
})
export class CampaignIdeologyModule {}
