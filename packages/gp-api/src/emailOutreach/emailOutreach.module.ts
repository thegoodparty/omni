import { Module } from '@nestjs/common'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { EmailModule } from 'src/email/email.module'
import { OutreachEmailController } from './outreachEmail.controller'
import { OutreachServeEmailController } from './outreachServeEmail.controller'
import { EmailDomainCheckService } from './services/emailDomainCheck.service'
import { EmailOutreachQueueService } from './services/emailOutreachQueue.service'
import { OutreachEmailService } from './services/outreachEmail.service'
import { OutreachEmailRecipientService } from './services/outreachEmailRecipient.service'
import { OutreachEmailScopeService } from './services/outreachEmailScope.service'
import { OutreachEmailSenderService } from './services/outreachEmailSender.service'

@Module({
  imports: [ElectedOfficeModule, EmailModule],
  controllers: [OutreachEmailController, OutreachServeEmailController],
  providers: [
    EmailDomainCheckService,
    EmailOutreachQueueService,
    OutreachEmailScopeService,
    OutreachEmailSenderService,
    OutreachEmailService,
    OutreachEmailRecipientService,
  ],
  exports: [EmailOutreachQueueService],
})
export class EmailOutreachModule {}
