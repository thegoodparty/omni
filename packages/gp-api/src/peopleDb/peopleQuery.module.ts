import { Module } from '@nestjs/common'
import { DistrictService } from './services/district.service'
import { StatsService } from './services/stats.service'
import { VoterSampleService } from './services/voterSample.service'
import { VoterQueryService } from './services/voterQuery.service'
import { VoterDownloadService } from './services/voterDownload.service'
import { VoterDoorKnockingService } from './services/voterDoorKnocking.service'
import { VoterPackService } from './services/voterPack.service'
import { ShadowReadService } from './shadowRead.service'
import { DatabricksVoterService } from './databricks/databricksVoter.service'
import { PeopleDbxStatementClient } from './databricks/peopleDbxStatement.client'

@Module({
  providers: [
    PeopleDbxStatementClient,
    DatabricksVoterService,
    ShadowReadService,
    DistrictService,
    StatsService,
    VoterSampleService,
    VoterQueryService,
    VoterDownloadService,
    VoterDoorKnockingService,
    VoterPackService,
  ],
  exports: [
    ShadowReadService,
    DistrictService,
    StatsService,
    VoterSampleService,
    VoterQueryService,
    VoterDownloadService,
    VoterDoorKnockingService,
    VoterPackService,
  ],
})
export class PeopleQueryModule {}
