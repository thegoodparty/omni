import { Module } from '@nestjs/common'
import { SlackModule } from 'src/vendors/slack/slack.module'
import { LlmModule } from '@/llm/llm.module'
import { CampaignStrategyContextModule } from '@/electionDb/campaignStrategyContext/campaign-strategy-context.module'
import { CandidaciesModule } from '@/electionDb/candidacies/candidacies.module'
import { DistrictsModule } from '@/electionDb/districts/districts.module'
import { OfficeHoldersModule } from '@/electionDb/officeHolders/officeHolders.module'
import { PlacesModule } from '@/electionDb/places/places.module'
import { PersonsModule } from '@/electionDb/persons/persons.module'
import { PositionsModule } from '@/electionDb/positions/positions.module'
import { ProjectedTurnoutModule } from '@/electionDb/projectedTurnout/projectedTurnout.module'
import { RacesModule as ElectionDbRacesModule } from '@/electionDb/races/races.module'
import { VoterIssuesModule } from '@/electionDb/voterIssues/voterIssues.module'
import { ZipToPositionModule } from '@/electionDb/zipToPosition/zipToPosition.module'
import { EmailModule } from '../email/email.module'
import { ElectionsController } from './elections.controller'
import { ElectionCandidaciesController } from './controllers/electionCandidacies.controller'
import { ElectionOfficeHoldersController } from './controllers/electionOfficeHolders.controller'
import { ElectionPersonsController } from './controllers/electionPersons.controller'
import { ElectionPlacesController } from './controllers/electionPlaces.controller'
import { ElectionPositionsController } from './controllers/electionPositions.controller'
import { ElectionRacesController } from './controllers/electionRaces.controller'
import { BallotReadyService } from './services/ballotReady.service'
import { CensusEntitiesService } from './services/censusEntities.service'
import { ElectionsService } from './services/elections.service'
import { RacesService } from './services/races.service'

@Module({
  controllers: [
    ElectionsController,
    ElectionCandidaciesController,
    ElectionOfficeHoldersController,
    ElectionPersonsController,
    ElectionPlacesController,
    ElectionPositionsController,
    ElectionRacesController,
  ],
  providers: [
    RacesService,
    CensusEntitiesService,
    BallotReadyService,
    ElectionsService,
  ],
  exports: [RacesService, ElectionsService, BallotReadyService],
  imports: [
    LlmModule,
    EmailModule,
    SlackModule,
    CampaignStrategyContextModule,
    CandidaciesModule,
    DistrictsModule,
    OfficeHoldersModule,
    PlacesModule,
    ElectionDbRacesModule,
    PersonsModule,
    PositionsModule,
    ProjectedTurnoutModule,
    VoterIssuesModule,
    ZipToPositionModule,
  ],
})
export class ElectionsModule {}
