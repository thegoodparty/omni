import { Module, forwardRef } from '@nestjs/common'
import { CronModule } from '@/cron/cron.module'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { LlmModule } from '@/llm/llm.module'
import { CensusCompositionModule } from './censusComposition.module'
import { PrioritiesController } from './priorities.controller'
import { PrioritiesService } from './services/priorities.service'
import { PriorityAnswerCodingService } from './services/priorityAnswerCoding.service'
import { PriorityOnboardingService } from './services/priorityOnboarding.service'
import { PriorityResultsService } from './services/priorityResults.service'
import { PriorityStatusService } from './services/priorityStatus.service'

@Module({
  imports: [
    forwardRef(() => ElectedOfficeModule),
    CensusCompositionModule,
    CronModule,
    LlmModule,
  ],
  controllers: [PrioritiesController],
  providers: [
    PrioritiesService,
    PriorityStatusService,
    PriorityOnboardingService,
    PriorityResultsService,
    PriorityAnswerCodingService,
  ],
  exports: [PrioritiesService, PriorityStatusService, PriorityResultsService],
})
export class PrioritiesModule {}
