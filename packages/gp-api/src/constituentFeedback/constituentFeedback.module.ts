import { Module, forwardRef } from '@nestjs/common'
import { CronModule } from '@/cron/cron.module'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { FeaturesModule } from '@/features/features.module'
import { LlmModule } from '@/llm/llm.module'
import { SpeechModule } from '@/speech/speech.module'
import { AwsModule } from '@/vendors/aws/aws.module'
import { ConstituentFeedbackController } from './constituentFeedback.controller'
import { ConstituentFeedbackService } from './services/constituentFeedback.service'
import { ConstituentFeedbackExtractionService } from './services/constituentFeedbackExtraction.service'
import { FeedbackReportService } from './services/feedbackReport.service'
import { FeedbackSeedService } from './services/feedbackSeed.service'
import { FeedbackSynthesisService } from './services/feedbackSynthesis.service'
import { FeedbackSynthesisIngestService } from './services/feedbackSynthesisIngest.service'
import { IssueTagService } from './services/issueTag.service'
import { IssueTagSeedService } from './services/issueTagSeed.service'
import { MockSynthesisEngine } from './services/mockSynthesisEngine'
import { PendingTranscriptionService } from './services/pendingTranscription.service'
import { PipelineSynthesisEngine } from './services/pipelineSynthesisEngine'
import {
  SYNTHESIS_ENGINE,
  selectSynthesisEngine,
} from './services/synthesisEngine'
import { SynthesisStaleRunSweepService } from './services/synthesisStaleRunSweep.service'

@Module({
  imports: [
    AwsModule,
    CronModule,
    forwardRef(() => ElectedOfficeModule),
    FeaturesModule,
    LlmModule,
    SpeechModule,
  ],
  controllers: [ConstituentFeedbackController],
  providers: [
    ConstituentFeedbackService,
    ConstituentFeedbackExtractionService,
    FeedbackReportService,
    FeedbackSeedService,
    FeedbackSynthesisService,
    FeedbackSynthesisIngestService,
    IssueTagService,
    IssueTagSeedService,
    MockSynthesisEngine,
    PendingTranscriptionService,
    PipelineSynthesisEngine,
    SynthesisStaleRunSweepService,
    {
      provide: SYNTHESIS_ENGINE,
      useFactory: (
        mock: MockSynthesisEngine,
        pipeline: PipelineSynthesisEngine,
      ) => selectSynthesisEngine({ mock, pipeline }),
      inject: [MockSynthesisEngine, PipelineSynthesisEngine],
    },
  ],
  exports: [
    ConstituentFeedbackService,
    FeedbackSynthesisIngestService,
    FeedbackSynthesisService,
  ],
})
export class ConstituentFeedbackModule {}
