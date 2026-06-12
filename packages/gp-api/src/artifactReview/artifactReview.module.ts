import { Module } from '@nestjs/common'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { BriefingReviewVerdictController } from './controllers/briefingReviewVerdict.controller'
import { ArtifactReviewService } from './services/artifactReview.service'
import { BriefingReviewVerdictService } from './services/briefingReviewVerdict.service'

@Module({
  imports: [ElectedOfficeModule],
  controllers: [BriefingReviewVerdictController],
  providers: [ArtifactReviewService, BriefingReviewVerdictService],
  exports: [ArtifactReviewService],
})
export class ArtifactReviewModule {}
