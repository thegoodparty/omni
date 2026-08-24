import { Module } from '@nestjs/common'
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
    ContactsModule,
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
    DoorKnockingPeopleApiService,
    DoorKnockingServeService,
    DoorKnockingStatusService,
    DoorKnockingInteractionService,
    DoorKnockingPackService,
    DoorKnockingPreviewService,
  ],
})
export class DoorKnockingModule {}
