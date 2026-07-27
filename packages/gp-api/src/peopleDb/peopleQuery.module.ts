import { Module } from '@nestjs/common'
import { DistrictService } from './services/district.service'
import { StatsService } from './services/stats.service'
import { VoterSampleService } from './services/voterSample.service'
import { VoterQueryService } from './services/voterQuery.service'
import { VoterDownloadService } from './services/voterDownload.service'
import { VoterDoorKnockingService } from './services/voterDoorKnocking.service'

@Module({
  providers: [
    DistrictService,
    StatsService,
    VoterSampleService,
    VoterQueryService,
    VoterDownloadService,
    VoterDoorKnockingService,
  ],
  exports: [
    DistrictService,
    StatsService,
    VoterSampleService,
    VoterQueryService,
    VoterDownloadService,
    VoterDoorKnockingService,
  ],
})
export class PeopleQueryModule {}
