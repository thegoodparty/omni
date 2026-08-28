import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { ElectionApiDistrictService } from './services/electionApiDistrict.service'
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
import { VoterDensityService } from './services/voterDensity.service'

@Module({
  imports: [HttpModule, ClerkModule],
  providers: [
    PeopleDbxStatementClient,
    VoterReadLogService,
    DatabricksVoterService,
    DatabricksVoterDownloadService,
    DatabricksVoterPackService,
    ElectionApiDistrictService,
    StatsService,
    VoterQueryService,
    VoterDownloadService,
    VoterDoorKnockingService,
    VoterPackService,
    VoterDensityService,
  ],
  exports: [
    StatsService,
    VoterQueryService,
    VoterDownloadService,
    VoterDoorKnockingService,
    VoterPackService,
    VoterDensityService,
  ],
})
export class PeopleQueryModule {}
