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
import { CensusCompositionModule } from '@/priorities/censusComposition.module'
import { ContactsService } from './services/contacts.service'
import { IndependentAffinityColumnService } from './services/independentAffinityColumn.service'
import { CivicPanelSummaryService } from './services/civicPanelSummary.service'
import { CivicPanelBuildPlanService } from './services/civicPanelBuildPlan.service'
import { CensusTractNameService } from './services/censusTractName.service'
import { GeoapifyModule } from '@/vendors/geoapify/geoapify.module'

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
    CensusCompositionModule,
    GeoapifyModule,
  ],
  controllers: [
    ContactsController,
    ContactNotesController,
    ContactInteractionsController,
  ],
  providers: [
    ContactsService,
    CivicPanelSummaryService,
    CivicPanelBuildPlanService,
    CensusTractNameService,
    IndependentAffinityColumnService,
  ],
  exports: [
    ContactsService,
    CivicPanelBuildPlanService,
    IndependentAffinityColumnService,
  ],
})
export class ContactsModule {}
