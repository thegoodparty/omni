import { ContactInteractionModule } from '@/contactInteraction/contactInteraction.module'
import { ContactNoteModule } from '@/contactNote/contactNote.module'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { PollsModule } from '@/polls/polls.module'
import { VoterOutreachActivityModule } from '@/voterOutreachActivity/voterOutreachActivity.module'
import { Module } from '@nestjs/common'
import { ContactEngagementController } from './contactEngagement.controller'
import { ContactEngagementService } from './contactEngagement.service'
import { UseEngagementContextGuard } from './guards/UseEngagementContext.guard'

@Module({
  imports: [
    ElectedOfficeModule,
    PollsModule,
    VoterOutreachActivityModule,
    ContactInteractionModule,
    ContactNoteModule,
  ],
  controllers: [ContactEngagementController],
  providers: [ContactEngagementService, UseEngagementContextGuard],
  exports: [ContactEngagementService],
})
export class ContactEngagementModule {}
