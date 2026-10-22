import { Module } from '@nestjs/common'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { QueueProducerModule } from '@/queue/producer/queueProducer.module'
import { SlackModule } from '@/vendors/slack/slack.module'
import { ManagedWaveFundingService } from './managedWaveFunding.service'

// Free managed civic panel sends. Import this module only from the wave job;
// managedWaveFunding.imports.test.ts holds the list of who may.
@Module({
  imports: [OrganizationsModule, QueueProducerModule, SlackModule],
  providers: [ManagedWaveFundingService],
  exports: [ManagedWaveFundingService],
})
export class ManagedWaveFundingModule {}
