import { Module } from '@nestjs/common'
import { ElectedOfficeModule } from 'src/electedOffice/electedOffice.module'
import { LlmModule } from 'src/llm/llm.module'
import { UsersModule } from 'src/users/users.module'
import { AwsModule } from 'src/vendors/aws/aws.module'
import { PollsController } from './polls.controller'
import { PollBiasAnalysisService } from './services/pollBiasAnalysis.service'
import { PollIssuesService } from './services/pollIssues.service'
import { PollsService } from './services/polls.service'
import { PollIndividualMessageService } from './services/pollIndividualMessage.service'
import { PollResponsesDownloadService } from './services/pollResponsesDownload.service'
import { ContactsModule } from '@/contacts/contacts.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { OutreachModule } from '@/outreach/outreach.module'

@Module({
  imports: [
    ElectedOfficeModule,
    UsersModule,
    AwsModule,
    LlmModule,
    ContactsModule,
    OrganizationsModule,
    OutreachModule,
  ],
  providers: [
    PollsService,
    PollIssuesService,
    PollBiasAnalysisService,
    PollIndividualMessageService,
    PollResponsesDownloadService,
  ],
  controllers: [PollsController],
  exports: [
    PollsService,
    PollIssuesService,
    PollBiasAnalysisService,
    PollIndividualMessageService,
  ],
})
export class PollsModule {}
