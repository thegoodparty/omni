import { Module } from '@nestjs/common'
import { AgentExperimentsModule } from '@/agentExperiments/agentExperiments.module'
import { CampaignsModule } from '@/campaigns/campaigns.module'
import { CampaignStrategyModule } from '@/campaignStrategy/campaignStrategy.module'
import { CommunityIssuesModule } from '@/communityIssues/communityIssues.module'
import { MeetingsModule } from '@/meetings/meetings.module'
import { OrdinancesModule } from '@/ordinances/ordinances.module'
import { RaceOpponentModule } from '@/raceOpponent/raceOpponent.module'
import { AwsModule } from '@/vendors/aws/aws.module'
import { AgentExperimentResultService } from './agentExperimentResult.service'

// Not in AgentExperimentsModule: every module whose hook this calls imports
// AgentExperimentsModule to dispatch runs, so the handler living there would
// close an import cycle. Only AppModule imports this.
@Module({
  imports: [
    AgentExperimentsModule,
    AwsModule,
    CampaignsModule,
    CampaignStrategyModule,
    CommunityIssuesModule,
    MeetingsModule,
    OrdinancesModule,
    RaceOpponentModule,
  ],
  providers: [AgentExperimentResultService],
})
export class AgentExperimentResultModule {}
