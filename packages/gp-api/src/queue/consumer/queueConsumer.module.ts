import { Module } from '@nestjs/common'
import { SqsModule } from '@ssut/nestjs-sqs'
import { QueueConsumerService } from './queueConsumer.service'
import { queueConfig } from '../queue.config'
import { CampaignsModule } from 'src/campaigns/campaigns.module'
import { ElectionsModule } from 'src/elections/elections.module'
import { OrganizationsModule } from 'src/organizations/organizations.module'
import { QueueProducerModule } from '../producer/queueProducer.module'
import { WebsitesModule } from '../../websites/websites.module'
import { SlackModule } from 'src/vendors/slack/slack.module'
import { PollsModule } from 'src/polls/polls.module'
import { ElectedOfficeModule } from 'src/electedOffice/electedOffice.module'
import { ContactsModule } from 'src/contacts/contacts.module'
import { AwsModule } from 'src/vendors/aws/aws.module'
import { OrdinancesModule } from 'src/ordinances/ordinances.module'
import { OutreachModule } from 'src/outreach/outreach.module'
import { PeerlyModule } from 'src/vendors/peerly/peerly.module'
import { EmailOutreachModule } from '@/emailOutreach/emailOutreach.module'

@Module({
  imports: [
    SqsModule.register({
      consumers: [
        {
          ...queueConfig,
          pollingWaitTimeMs: 1000,
        },
      ],
    }),
    CampaignsModule,
    ElectionsModule,
    OrganizationsModule,
    QueueProducerModule,
    WebsitesModule,
    SlackModule,
    ElectedOfficeModule,
    PollsModule,
    ContactsModule,
    AwsModule,
    OrdinancesModule,
    // For OutreachTextDeliveryService, which the `outreachTextSend` case
    // calls. Nothing imports QueueConsumerModule except AppModule, so this
    // edge adds no cycle.
    OutreachModule,
    // For P2pPhoneListUploadService, which the `p2pPhoneListBuild` case
    // calls.
    PeerlyModule,
    // For EmailOutreachQueueService, which hands email messages to pg-boss.
    EmailOutreachModule,
  ],
  providers: [QueueConsumerService],
})
export class QueueConsumerModule {}
