import { Module } from '@nestjs/common'
import { DistrictService } from './services/district.service'
import { StatsService } from './services/stats.service'
import { VoterSampleService } from './services/voterSample.service'
import { VoterQueryService } from './services/voterQuery.service'
import { VoterDownloadService } from './services/voterDownload.service'

@Module({
  providers: [
    DistrictService,
    StatsService,
    VoterSampleService,
    VoterQueryService,
    VoterDownloadService,
  ],
  exports: [
    DistrictService,
    StatsService,
    VoterSampleService,
    VoterQueryService,
    VoterDownloadService,
  ],
})
export class PeopleQueryModule {}
