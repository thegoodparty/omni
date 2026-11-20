import { Module } from '@nestjs/common'
import { DistrictsModule } from '@/electionDb/districts/districts.module'
import { PositionsModule } from '@/electionDb/positions/positions.module'
import { SlackModule } from '@/vendors/slack/slack.module'
import { CaseScoutBucketService } from './services/caseScoutBucket.service'
import { CaseScoutCaseListsService } from './services/caseScoutCaseLists.service'
import { CaseScoutDraftService } from './services/caseScoutDraft.service'
import { CaseScoutHandoffService } from './services/caseScoutHandoff.service'
import { CaseScoutJudgeRecordsService } from './services/caseScoutJudgeRecords.service'
import { CaseScoutMessagesService } from './services/caseScoutMessages.service'
import { CaseScoutModelService } from './services/caseScoutModel.service'
import { CaseScoutNightlyService } from './services/caseScoutNightly.service'
import { CaseScoutScoreService } from './services/caseScoutScore.service'

@Module({
  imports: [PositionsModule, DistrictsModule, SlackModule],
  providers: [
    CaseScoutBucketService,
    CaseScoutCaseListsService,
    CaseScoutDraftService,
    CaseScoutHandoffService,
    CaseScoutJudgeRecordsService,
    CaseScoutMessagesService,
    CaseScoutModelService,
    CaseScoutNightlyService,
    CaseScoutScoreService,
  ],
})
export class CaseScoutModule {}
