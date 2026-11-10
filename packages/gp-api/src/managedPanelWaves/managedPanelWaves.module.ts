import { forwardRef, Module } from '@nestjs/common'
import { ContactInteractionModule } from '@/contactInteraction/contactInteraction.module'
import { ContactsModule } from '@/contacts/contacts.module'
import { CronModule } from '@/cron/cron.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { ManagedWaveFundingModule } from '@/managedWaveFunding/managedWaveFunding.module'
import { OutreachModule } from '@/outreach/outreach.module'
import { SlackModule } from '@/vendors/slack/slack.module'
import { ManagedPanelWaveJobService } from './managedPanelWaveJob.service'

// The hourly managed civic panel wave job. It has no controller, and nothing
// that serves a request may import this module: it reaches claimFree.
@Module({
  imports: [
    ContactInteractionModule,
    forwardRef(() => ContactsModule),
    CronModule,
    ManagedWaveFundingModule,
    OrganizationsModule,
    forwardRef(() => OutreachModule),
    SlackModule,
  ],
  providers: [ManagedPanelWaveJobService],
})
export class ManagedPanelWavesModule {}
