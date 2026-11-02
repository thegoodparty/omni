import { Module } from '@nestjs/common'
import { ContactsModule } from '@/contacts/contacts.module'
import { CronModule } from '@/cron/cron.module'
import { PeopleQueryModule } from '@/peopleDb/peopleQuery.module'
import { QueueProducerModule } from '@/queue/producer/queueProducer.module'
import { AwsModule } from '@/vendors/aws/aws.module'
import { ContactSourcesController } from './contactSources.controller'
import { ContactUploadFilesModule } from './contactUploadFiles.module'
import { ContactUploadsController } from './contactUploads.controller'
import { ContactUploadAbandonedSweepService } from './services/contactUploadAbandonedSweep.service'
import { ContactUploadMatchService } from './services/contactUploadMatch.service'
import { ContactUploadProcessJobService } from './services/contactUploadProcessJob.service'
import { ContactUploadsService } from './services/contactUploads.service'

@Module({
  imports: [
    ContactsModule,
    ContactUploadFilesModule,
    CronModule,
    PeopleQueryModule,
    QueueProducerModule,
    AwsModule,
  ],
  controllers: [ContactUploadsController, ContactSourcesController],
  providers: [
    ContactUploadsService,
    ContactUploadMatchService,
    ContactUploadProcessJobService,
    ContactUploadAbandonedSweepService,
  ],
  exports: [ContactUploadMatchService, ContactUploadProcessJobService],
})
export class ContactUploadsModule {}
