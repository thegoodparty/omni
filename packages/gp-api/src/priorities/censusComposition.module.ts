import { Module } from '@nestjs/common'
import {
  CENSUS_COMPOSITION_SOURCE,
  SampleCensusComposition,
} from './services/censusComposition'

// One binding for every page that compares people with their district: a
// priority's results and the civic panel read the same source.
@Module({
  providers: [
    // Sample figures until the district and block group census tables are
    // readable from mart_gp_api; swapping the class here is the whole switch.
    { provide: CENSUS_COMPOSITION_SOURCE, useClass: SampleCensusComposition },
  ],
  exports: [CENSUS_COMPOSITION_SOURCE],
})
export class CensusCompositionModule {}
