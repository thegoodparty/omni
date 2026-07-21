import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { ElectionsModule } from '@/elections/elections.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { GeoapifyModule } from '@/vendors/geoapify/geoapify.module'
import { DoorKnockingController } from './doorKnocking.controller'
import { DoorKnockingTurfService } from './services/doorKnockingTurf.service'
import { DoorKnockingKnockService } from './services/doorKnockingKnock.service'
import { DoorKnockingPeopleApiService } from './services/doorKnockingPeopleApi.service'

@Module({
  imports: [
    ClerkModule,
    HttpModule,
    ElectionsModule,
    OrganizationsModule,
    GeoapifyModule,
  ],
  controllers: [DoorKnockingController],
  providers: [
    DoorKnockingTurfService,
    DoorKnockingKnockService,
    DoorKnockingPeopleApiService,
  ],
})
export class DoorKnockingModule {}
