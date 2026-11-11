import { Module, forwardRef } from '@nestjs/common'
import { CronModule } from '@/cron/cron.module'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { LlmModule } from '@/llm/llm.module'
import { PersonProfilesModule } from '@/personProfiles/personProfiles.module'
import { CensusCompositionModule } from './censusComposition.module'
import { PrioritiesController } from './priorities.controller'
import { PrioritiesService } from './services/priorities.service'
import { PriorityAnswerCodingService } from './services/priorityAnswerCoding.service'
import { PriorityOnboardingService } from './services/priorityOnboarding.service'
import { PriorityReadService } from './services/priorityRead.service'
import { PriorityResultsService } from './services/priorityResults.service'
import { PriorityRoundTwoDrawService } from './services/priorityRoundTwoDraw.service'
import { PriorityStatusService } from './services/priorityStatus.service'
import { PriorityThemeCommentsService } from './services/priorityThemeComments.service'

@Module({
  imports: [
    forwardRef(() => ElectedOfficeModule),
    CensusCompositionModule,
    CronModule,
    LlmModule,
    PersonProfilesModule,
  ],
  controllers: [PrioritiesController],
  providers: [
    PrioritiesService,
    PriorityStatusService,
    PriorityOnboardingService,
    PriorityReadService,
    PriorityResultsService,
    PriorityAnswerCodingService,
    PriorityRoundTwoDrawService,
    PriorityThemeCommentsService,
  ],
  exports: [PrioritiesService, PriorityStatusService, PriorityResultsService],
})
export class PrioritiesModule {}
