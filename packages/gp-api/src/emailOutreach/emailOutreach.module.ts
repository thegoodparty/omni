import { forwardRef, Module } from '@nestjs/common'
import { ContactsModule } from '@/contacts/contacts.module'
import { PeopleQueryModule } from '@/peopleDb/peopleQuery.module'
import { VotersModule } from '@/voters/voters.module'
import { PaymentHoldsModule } from '@/paymentHolds/paymentHolds.module'
import { PaymentHoldsService } from '@/paymentHolds/services/paymentHolds.service'
import { QueueProducerModule } from '@/queue/producer/queueProducer.module'
import { OutreachType } from '../generated/prisma'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { EmailModule } from 'src/email/email.module'
import { LlmModule } from '@/llm/llm.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { OutreachModule } from '@/outreach/outreach.module'
import { AwsModule } from '@/vendors/aws/aws.module'
import { OutreachEmailAdminController } from './outreachEmailAdmin.controller'
import { OutreachEmailAdminService } from './services/outreachEmailAdmin.service'
import { OutreachEmailPauseAlertService } from './services/outreachEmailPauseAlert.service'
import { SlackModule } from '@/vendors/slack/slack.module'
import { EmailPublicController } from './emailPublic.controller'
import { OutreachEmailController } from './outreachEmail.controller'
import { OutreachServeEmailController } from './outreachServeEmail.controller'
import { EmailDomainCheckService } from './services/emailDomainCheck.service'
import { EmailSnsWebhookService } from './services/emailSnsWebhook.service'
import { OutreachEmailInboundService } from './services/outreachEmailInbound.service'
import { OutreachEmailUnsubscribeService } from './services/outreachEmailUnsubscribe.service'
import { EmailOutreachQueueService } from './services/emailOutreachQueue.service'
import { OutreachEmailGenerationService } from './services/outreachEmailGeneration.service'
import { OutreachEmailImageService } from './services/outreachEmailImage.service'
import { OutreachEmailTestService } from './services/outreachEmailTest.service'
import { SesService } from './services/ses.service'
import { OutreachEmailConfirmService } from './services/outreachEmailConfirm.service'
import { OutreachEmailLifecycleService } from './services/outreachEmailLifecycle.service'
import { OutreachEmailPrepareService } from './services/outreachEmailPrepare.service'
import { OutreachEmailSendSweepService } from './services/outreachEmailSendSweep.service'
import { OutreachEmailSettlementAdapter } from './services/outreachEmailSettlementAdapter.service'
import { OutreachEmailService } from './services/outreachEmail.service'
import { OutreachEmailAudienceService } from './services/outreachEmailAudience.service'
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
    PaymentHoldsModule,
    QueueProducerModule,
    SlackModule,
    // Contacts and Voters reach Campaigns and on to Outreach, which this
    // module already imports.
    forwardRef(() => ContactsModule),
    forwardRef(() => VotersModule),
    PeopleQueryModule,
  ],
  controllers: [
    OutreachEmailController,
    OutreachServeEmailController,
    EmailPublicController,
    OutreachEmailAdminController,
  ],
  providers: [
    EmailDomainCheckService,
    EmailOutreachQueueService,
    EmailSnsWebhookService,
    OutreachEmailInboundService,
    OutreachEmailUnsubscribeService,
    OutreachEmailScopeService,
    OutreachEmailSenderService,
    OutreachEmailService,
    OutreachEmailAudienceService,
    OutreachEmailGenerationService,
    OutreachEmailImageService,
    OutreachEmailTestService,
    SesService,
    OutreachEmailConfirmService,
    OutreachEmailPrepareService,
    OutreachEmailSendSweepService,
    OutreachEmailLifecycleService,
    OutreachEmailSettlementAdapter,
    OutreachEmailAdminService,
    OutreachEmailPauseAlertService,
  ],
  exports: [EmailOutreachQueueService],
})
export class EmailOutreachModule {
  constructor(holds: PaymentHoldsService) {
    holds.registerSettlementAdapter(
      OutreachType.email,
      OutreachEmailSettlementAdapter,
    )
  }
}
