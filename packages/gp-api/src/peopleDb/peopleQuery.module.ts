import { Module } from '@nestjs/common'
import { DistrictService } from './services/district.service'
import { StatsService } from './services/stats.service'
import { VoterSampleService } from './services/voterSample.service'

@Module({
  providers: [DistrictService, StatsService, VoterSampleService],
  exports: [DistrictService, StatsService, VoterSampleService],
})
export class PeopleQueryModule {}
