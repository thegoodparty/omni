import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { SlackModule } from 'src/vendors/slack/slack.module'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { LlmModule } from '@/llm/llm.module'
import { EmailModule } from '../email/email.module'
import { ElectionsController } from './elections.controller'
import { BallotReadyService } from './services/ballotReady.service'
import { CensusEntitiesService } from './services/censusEntities.service'
import { DistrictRoutingService } from './services/districtRouting.service'
import { ElectionsService } from './services/elections.service'
import { RacesService } from './services/races.service'

@Module({
  controllers: [ElectionsController],
  providers: [
    RacesService,
    CensusEntitiesService,
    BallotReadyService,
    ElectionsService,
    DistrictRoutingService,
  ],
  exports: [
    RacesService,
    ElectionsService,
    BallotReadyService,
    DistrictRoutingService,
  ],
  imports: [LlmModule, EmailModule, HttpModule, SlackModule, ClerkModule],
})
export class ElectionsModule {}
