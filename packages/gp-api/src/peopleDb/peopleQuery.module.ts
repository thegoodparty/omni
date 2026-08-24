import { Module } from '@nestjs/common'
import { DistrictService } from './services/district.service'
import { StatsService } from './services/stats.service'
import { VoterSampleService } from './services/voterSample.service'
import { VoterQueryService } from './services/voterQuery.service'
import { VoterDownloadService } from './services/voterDownload.service'
import { VoterDoorKnockingService } from './services/voterDoorKnocking.service'
import { VoterPackService } from './services/voterPack.service'
import { VoterDensityService } from './services/voterDensity.service'

@Module({
  providers: [
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
