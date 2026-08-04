import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { ContactInteractionModule } from '@/contactInteraction/contactInteraction.module'
import { ContactNoteModule } from '@/contactNote/contactNote.module'
import { forwardRef, Module } from '@nestjs/common'
import { CampaignsModule } from 'src/campaigns/campaigns.module'
import { ElectionsModule } from 'src/elections/elections.module'
import { OrganizationsModule } from 'src/organizations/organizations.module'
import { VotersModule } from 'src/voters/voters.module'
import { PeopleQueryModule } from '@/peopleDb/peopleQuery.module'
import { ContactInteractionsController } from './contactInteractions.controller'
import { ContactNotesController } from './contactNotes.controller'
import { ContactsController } from './contacts.controller'
import { ContactsService } from './services/contacts.service'

@Module({
  imports: [
    ClerkModule,
    forwardRef(() => CampaignsModule),
    // Contacts -> Voters -> Peerly -> Contacts: every cycle edge needs
    // forwardRef
    forwardRef(() => VotersModule),
    ElectionsModule,
    OrganizationsModule,
    ContactInteractionModule,
    ContactNoteModule,
    PeopleQueryModule,
  ],
  controllers: [
    ContactsController,
    ContactNotesController,
    ContactInteractionsController,
  ],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
