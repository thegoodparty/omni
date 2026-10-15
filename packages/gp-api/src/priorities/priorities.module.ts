import { Module, forwardRef } from '@nestjs/common'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { CensusCompositionModule } from './censusComposition.module'
import { PrioritiesController } from './priorities.controller'
import { PrioritiesService } from './services/priorities.service'
import { PriorityOnboardingService } from './services/priorityOnboarding.service'
import { PriorityResultsService } from './services/priorityResults.service'
import { PriorityStatusService } from './services/priorityStatus.service'

@Module({
  imports: [forwardRef(() => ElectedOfficeModule), CensusCompositionModule],
  controllers: [PrioritiesController],
  providers: [
    PrioritiesService,
    PriorityStatusService,
    PriorityOnboardingService,
    PriorityResultsService,
  ],
  exports: [PrioritiesService, PriorityStatusService, PriorityResultsService],
})
export class PrioritiesModule {}
