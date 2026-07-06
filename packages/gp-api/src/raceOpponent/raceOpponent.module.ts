// OrganizationsModule must load BEFORE ElectionsModule (mirrors the Campaign
// Manager module): ElectionsModule transitively imports AiModule which uses
// forwardRef(OrganizationsModule), so loading Elections first resolves the
// forwardRef to undefined and bootstrap fails.
import { OrganizationsModule } from '@/organizations/organizations.module'
import { ElectionsModule } from '@/elections/elections.module'
import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { AgentExperimentsModule } from '@/agentExperiments/agentExperiments.module'
import { AwsModule } from '@/vendors/aws/aws.module'
import { ElectionApiService } from '@/campaignStrategy/services/electionApi.service'
import { CampaignStrategyModule } from '@/campaignStrategy/campaignStrategy.module'
import { DistrictResolverService } from '@/chats/briefing-chats/services/districtResolver.service'
import { CronModule } from '@/cron/cron.module'
import { RaceOpponentController } from './raceOpponent.controller'
import { RaceOpponentService } from './services/raceOpponent.service'
import { RaceOpponentPersistService } from './services/raceOpponentPersist.service'
import { SelfResearchService } from './services/selfResearch.service'
import { SelfResearchGateService } from './services/selfResearchGate.service'
import { RaceOpponentResearchPersistService } from './services/raceOpponentResearchPersist.service'
import { OpponentResearchService } from './services/opponentResearch.service'
import { RaceOpponentActivityService } from './services/raceOpponentActivity.service'
import { OpponentResearchScheduleService } from './services/opponentResearchSchedule.service'
import { ContrastToneService } from './services/contrastTone.service'
import { ContrastEngineService } from './services/contrastEngine.service'
import { ContrastReviewVerdictService } from './services/contrastReviewVerdict.service'
import { ContrastRoutingService } from './services/contrastRouting.service'
import { ContrastEditService } from './services/contrastEdit.service'

@Module({
  imports: [
    ClerkModule,
    HttpModule,
    AgentExperimentsModule,
    AwsModule,
    CampaignStrategyModule,
    CronModule,
    OrganizationsModule,
    ElectionsModule,
  ],
  controllers: [RaceOpponentController],
  providers: [
    RaceOpponentService,
    RaceOpponentPersistService,
    SelfResearchService,
    SelfResearchGateService,
    RaceOpponentResearchPersistService,
    OpponentResearchService,
    RaceOpponentActivityService,
    OpponentResearchScheduleService,
    ElectionApiService,
    DistrictResolverService,
    ContrastToneService,
    ContrastEngineService,
    ContrastReviewVerdictService,
    ContrastRoutingService,
    ContrastEditService,
  ],
  exports: [
    RaceOpponentPersistService,
    RaceOpponentResearchPersistService,
    SelfResearchGateService,
  ],
})
export class RaceOpponentModule {}
