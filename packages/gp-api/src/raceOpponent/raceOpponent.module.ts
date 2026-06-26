import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { AgentExperimentsModule } from '@/agentExperiments/agentExperiments.module'
import { AwsModule } from '@/vendors/aws/aws.module'
import { ElectionApiService } from '@/campaignStrategy/services/electionApi.service'
import { CampaignStrategyModule } from '@/campaignStrategy/campaignStrategy.module'
import { RaceOpponentController } from './raceOpponent.controller'
import { RaceOpponentService } from './services/raceOpponent.service'
import { RaceOpponentPersistService } from './services/raceOpponentPersist.service'

@Module({
  imports: [
    ClerkModule,
    HttpModule,
    AgentExperimentsModule,
    AwsModule,
    CampaignStrategyModule,
  ],
  controllers: [RaceOpponentController],
  providers: [
    RaceOpponentService,
    RaceOpponentPersistService,
    ElectionApiService,
  ],
  exports: [RaceOpponentPersistService],
})
export class RaceOpponentModule {}
