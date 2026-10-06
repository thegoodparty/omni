import { Module, forwardRef } from '@nestjs/common'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { FeaturesModule } from '@/features/features.module'
import { LlmModule } from '@/llm/llm.module'
import { ConstituentFeedbackController } from './constituentFeedback.controller'
import { ConstituentFeedbackService } from './services/constituentFeedback.service'
import { ConstituentFeedbackExtractionService } from './services/constituentFeedbackExtraction.service'

@Module({
  imports: [forwardRef(() => ElectedOfficeModule), FeaturesModule, LlmModule],
  controllers: [ConstituentFeedbackController],
  providers: [ConstituentFeedbackService, ConstituentFeedbackExtractionService],
  exports: [ConstituentFeedbackService],
})
export class ConstituentFeedbackModule {}
