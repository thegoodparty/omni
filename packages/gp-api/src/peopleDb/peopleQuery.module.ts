import { Module } from '@nestjs/common'
import { DistrictService } from './services/district.service'
import { StatsService } from './services/stats.service'

@Module({
  providers: [DistrictService, StatsService],
  exports: [DistrictService, StatsService],
})
export class PeopleQueryModule {}
