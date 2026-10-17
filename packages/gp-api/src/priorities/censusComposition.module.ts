import { Module } from '@nestjs/common'
import { PeopleQueryModule } from '@/peopleDb/peopleQuery.module'
import {
  CENSUS_COMPOSITION_SOURCE,
  DistrictCensusComposition,
} from './services/censusComposition'

// One binding for every page that compares people with their district: a
// priority's results and the civic panel read the same source.
@Module({
  imports: [PeopleQueryModule],
  providers: [
    { provide: CENSUS_COMPOSITION_SOURCE, useClass: DistrictCensusComposition },
  ],
  exports: [CENSUS_COMPOSITION_SOURCE],
})
export class CensusCompositionModule {}
