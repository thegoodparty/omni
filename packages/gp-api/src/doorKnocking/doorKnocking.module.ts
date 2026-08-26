import { forwardRef, Module } from '@nestjs/common'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { ContactInteractionModule } from '@/contactInteraction/contactInteraction.module'
import { ContactsModule } from '@/contacts/contacts.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { GeoapifyModule } from '@/vendors/geoapify/geoapify.module'
import { PeopleQueryModule } from '@/peopleDb/peopleQuery.module'
import { DoorKnockingController } from './doorKnocking.controller'
import { DoorKnockingActivityService } from './services/doorKnockingActivity.service'
import { DoorKnockingTurfService } from './services/doorKnockingTurf.service'
import { DoorKnockingKnockService } from './services/doorKnockingKnock.service'
import { DoorKnockingNotesService } from './services/doorKnockingNotes.service'
import { DoorKnockingPeopleApiService } from './services/doorKnockingPeopleApi.service'
import { DoorKnockingServeService } from './services/doorKnockingServe.service'
import { DoorKnockingStatusService } from './services/doorKnockingStatus.service'
import { DoorKnockingTurfCountsService } from './services/doorKnockingTurfCounts.service'
import { DoorKnockingInteractionService } from './services/doorKnockingInteraction.service'
import { DoorKnockingPackService } from './services/doorKnockingPack.service'
import { DoorKnockingPreviewService } from './services/doorKnockingPreview.service'

@Module({
  imports: [
    ClerkModule,
    ContactInteractionModule,
    // Deferred since OutreachModule started importing this one for the counts
    // aggregate: Contacts → Campaigns → Peerly → Outreach now loops back here,
    // so this edge is inside a module cycle rather than at the end of a chain.
    forwardRef(() => ContactsModule),
    OrganizationsModule,
    GeoapifyModule,
    PeopleQueryModule,
  ],
  controllers: [DoorKnockingController],
  providers: [
    DoorKnockingActivityService,
    DoorKnockingTurfService,
    DoorKnockingTurfCountsService,
    DoorKnockingKnockService,
    DoorKnockingNotesService,
    DoorKnockingPeopleApiService,
    DoorKnockingServeService,
    DoorKnockingStatusService,
    DoorKnockingInteractionService,
    DoorKnockingPackService,
    DoorKnockingPreviewService,
  ],
  // The rail's counts aggregate, exported so the outreach detail read can
  // report doors/people/logged for a nativeDoorKnocking envelope off the same
  // computation rather than a second one of its own (ADR 0010).
  exports: [DoorKnockingTurfCountsService],
})
export class DoorKnockingModule {}
