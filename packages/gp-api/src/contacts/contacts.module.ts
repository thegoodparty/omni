import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { ContactNoteModule } from '@/contactNote/contactNote.module'
import { HttpModule } from '@nestjs/axios'
import { forwardRef, Module } from '@nestjs/common'
import { CampaignsModule } from 'src/campaigns/campaigns.module'
import { ContactInteractionModule } from 'src/contactInteraction/contactInteraction.module'
import { ElectionsModule } from 'src/elections/elections.module'
import { OrganizationsModule } from 'src/organizations/organizations.module'
import { VotersModule } from 'src/voters/voters.module'
import { ContactNotesController } from './contactNotes.controller'
import { ContactsController } from './contacts.controller'
import { ContactsService } from './services/contacts.service'

@Module({
  imports: [
    ClerkModule,
    HttpModule,
    forwardRef(() => CampaignsModule),
    VotersModule,
    ElectionsModule,
    OrganizationsModule,
    ContactInteractionModule,
    ContactNoteModule,
  ],
  controllers: [ContactsController, ContactNotesController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
