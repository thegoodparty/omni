import { Module } from '@nestjs/common'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { EmailModule } from 'src/email/email.module'
import { LlmModule } from '@/llm/llm.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { OutreachModule } from '@/outreach/outreach.module'
import { AwsModule } from '@/vendors/aws/aws.module'
import { OutreachEmailController } from './outreachEmail.controller'
import { OutreachServeEmailController } from './outreachServeEmail.controller'
import { EmailDomainCheckService } from './services/emailDomainCheck.service'
import { EmailOutreachQueueService } from './services/emailOutreachQueue.service'
import { OutreachEmailGenerationService } from './services/outreachEmailGeneration.service'
import { OutreachEmailImageService } from './services/outreachEmailImage.service'
import { OutreachEmailTestService } from './services/outreachEmailTest.service'
import { SesService } from './services/ses.service'
import { OutreachEmailService } from './services/outreachEmail.service'
import { OutreachEmailRecipientService } from './services/outreachEmailRecipient.service'
import { OutreachEmailScopeService } from './services/outreachEmailScope.service'
import { OutreachEmailSenderService } from './services/outreachEmailSender.service'

@Module({
  imports: [
    ElectedOfficeModule,
    EmailModule,
    LlmModule,
    OrganizationsModule,
    OutreachModule,
    AwsModule,
  ],
  controllers: [OutreachEmailController, OutreachServeEmailController],
  providers: [
    EmailDomainCheckService,
    EmailOutreachQueueService,
    OutreachEmailScopeService,
    OutreachEmailSenderService,
    OutreachEmailService,
    OutreachEmailRecipientService,
    OutreachEmailGenerationService,
    OutreachEmailImageService,
    OutreachEmailTestService,
    SesService,
  ],
  exports: [EmailOutreachQueueService],
})
export class EmailOutreachModule {}
