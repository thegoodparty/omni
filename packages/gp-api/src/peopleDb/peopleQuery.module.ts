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
import { DatabricksVoterDownloadService } from './databricks/databricksVoterDownload.service'
import { DatabricksVoterPackService } from './databricks/databricksVoterPack.service'
import { PeopleDbxStatementClient } from './databricks/peopleDbxStatement.client'
import { VoterDensityService } from './services/voterDensity.service'

@Module({
  providers: [
    PeopleDbxStatementClient,
    DatabricksVoterService,
    DatabricksVoterDownloadService,
    DatabricksVoterPackService,
    ShadowReadService,
    DistrictService,
    StatsService,
    VoterSampleService,
    VoterQueryService,
    VoterDownloadService,
    VoterDoorKnockingService,
    VoterPackService,
    VoterDensityService,
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
    VoterDensityService,
  ],
})
export class PeopleQueryModule {}
