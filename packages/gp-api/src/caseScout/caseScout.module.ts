import { Module } from '@nestjs/common'
import { DistrictsModule } from '@/electionDb/districts/districts.module'
import { PositionsModule } from '@/electionDb/positions/positions.module'
import { CaseScoutBucketService } from './services/caseScoutBucket.service'
import { CaseScoutCaseListsService } from './services/caseScoutCaseLists.service'
import { CaseScoutDraftService } from './services/caseScoutDraft.service'
import { CaseScoutJudgeRecordsService } from './services/caseScoutJudgeRecords.service'
import { CaseScoutMessagesService } from './services/caseScoutMessages.service'
import { CaseScoutModelService } from './services/caseScoutModel.service'
import { CaseScoutNightlyService } from './services/caseScoutNightly.service'
import { CaseScoutPublisherService } from './services/caseScoutPublisher.service'
import { CaseScoutScoreService } from './services/caseScoutScore.service'

@Module({
  imports: [PositionsModule, DistrictsModule],
  providers: [
    CaseScoutBucketService,
    CaseScoutCaseListsService,
    CaseScoutDraftService,
    CaseScoutJudgeRecordsService,
    CaseScoutMessagesService,
    CaseScoutModelService,
    CaseScoutNightlyService,
    CaseScoutPublisherService,
    CaseScoutScoreService,
  ],
})
export class CaseScoutModule {}
