import { Module, forwardRef } from '@nestjs/common'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { PrioritiesController } from './priorities.controller'
import {
  CENSUS_COMPOSITION_SOURCE,
  SampleCensusComposition,
} from './services/censusComposition'
import { PrioritiesService } from './services/priorities.service'
import { PriorityOnboardingService } from './services/priorityOnboarding.service'
import { PriorityResultsService } from './services/priorityResults.service'
import { PriorityStatusService } from './services/priorityStatus.service'

@Module({
  imports: [forwardRef(() => ElectedOfficeModule)],
  controllers: [PrioritiesController],
  providers: [
    PrioritiesService,
    PriorityStatusService,
    PriorityOnboardingService,
    PriorityResultsService,
    // Sample figures until the district and block group census tables are
    // readable from mart_gp_api; swapping the class here is the whole switch.
    { provide: CENSUS_COMPOSITION_SOURCE, useClass: SampleCensusComposition },
  ],
  exports: [PrioritiesService, PriorityStatusService],
})
export class PrioritiesModule {}
