import { Module } from '@nestjs/common'
import { DistrictsModule } from '@/electionDb/districts/districts.module'
import { PositionsModule } from '@/electionDb/positions/positions.module'
import { ElectionDistrictService } from './services/electionDistrict.service'
import { StatsService } from './services/stats.service'
import { VoterQueryService } from './services/voterQuery.service'
import { VoterDownloadService } from './services/voterDownload.service'
import { VoterDoorKnockingService } from './services/voterDoorKnocking.service'
import { VoterPackService } from './services/voterPack.service'
import { DatabricksVoterService } from './databricks/databricksVoter.service'
import { DatabricksVoterDownloadService } from './databricks/databricksVoterDownload.service'
import { DatabricksVoterPackService } from './databricks/databricksVoterPack.service'
import { PeopleDbxStatementClient } from './databricks/peopleDbxStatement.client'
import { VoterReadLogService } from './databricks/voterReadLog.service'
import { VoterRecommendedListsService } from './services/voterRecommendedLists.service'
import { PeopleDatasetService } from './services/peopleDataset.service'
import { PeopleEmailFixtureService } from './services/peopleEmailFixture.service'

@Module({
  imports: [DistrictsModule, PositionsModule],
  providers: [
    PeopleDbxStatementClient,
    VoterReadLogService,
    DatabricksVoterService,
    DatabricksVoterDownloadService,
    DatabricksVoterPackService,
    ElectionDistrictService,
    StatsService,
    VoterQueryService,
    VoterDownloadService,
    VoterDoorKnockingService,
    VoterPackService,
    VoterRecommendedListsService,
    PeopleDatasetService,
    PeopleEmailFixtureService,
  ],
  exports: [
    StatsService,
    VoterQueryService,
    VoterDownloadService,
    VoterDoorKnockingService,
    VoterPackService,
    VoterRecommendedListsService,
    PeopleDatasetService,
    PeopleEmailFixtureService,
  ],
})
export class PeopleQueryModule {}
