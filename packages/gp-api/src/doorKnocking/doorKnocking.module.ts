import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { ContactsModule } from '@/contacts/contacts.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { GeoapifyModule } from '@/vendors/geoapify/geoapify.module'
import { DoorKnockingController } from './doorKnocking.controller'
import { DoorKnockingTurfService } from './services/doorKnockingTurf.service'
import { DoorKnockingKnockService } from './services/doorKnockingKnock.service'
import { DoorKnockingPeopleApiService } from './services/doorKnockingPeopleApi.service'
import { DoorKnockingServeService } from './services/doorKnockingServe.service'

@Module({
  imports: [
    ClerkModule,
    HttpModule,
    ContactsModule,
    OrganizationsModule,
    GeoapifyModule,
  ],
  controllers: [DoorKnockingController],
  providers: [
    DoorKnockingTurfService,
    DoorKnockingKnockService,
    DoorKnockingPeopleApiService,
    DoorKnockingServeService,
  ],
})
export class DoorKnockingModule {}
