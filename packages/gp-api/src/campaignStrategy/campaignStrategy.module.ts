import { Module } from '@nestjs/common'
import { CampaignStrategyContextModule } from '@/electionDb/campaignStrategyContext/campaign-strategy-context.module'
import { ElectionsModule } from '@/elections/elections.module'
import { AgentExperimentsModule } from '@/agentExperiments/agentExperiments.module'
import { AwsModule } from '@/vendors/aws/aws.module'
import { CampaignStoryModule } from '@/campaignStory/campaignStory.module'
import { WebsitesModule } from '@/websites/websites.module'
import { CampaignStrategyController } from './campaignStrategy.controller'
import { CampaignStrategyService } from './services/campaignStrategy.service'
import { RaceContextService } from './services/raceContext.service'
import { StrategicLandscapeParamsService } from './services/strategicLandscapeParams.service'
import { StrategicLandscapePersister } from './services/strategicLandscape.persister'

@Module({
  imports: [
    CampaignStrategyContextModule,
    ElectionsModule,
    AgentExperimentsModule,
    AwsModule,
    CampaignStoryModule,
    WebsitesModule,
  ],
  controllers: [CampaignStrategyController],
  providers: [
    CampaignStrategyService,
    StrategicLandscapePersister,
    RaceContextService,
    StrategicLandscapeParamsService,
  ],
  exports: [CampaignStrategyService, RaceContextService],
})
export class CampaignStrategyModule {}
