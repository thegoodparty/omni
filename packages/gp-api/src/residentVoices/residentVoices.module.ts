import { Module } from '@nestjs/common'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { PeopleQueryModule } from '@/peopleDb/peopleQuery.module'
import { ResidentVoicesController } from './residentVoices.controller'
import { ResidentVoicesService } from './services/residentVoices.service'

@Module({
  imports: [OrganizationsModule, PeopleQueryModule],
  controllers: [ResidentVoicesController],
  providers: [ResidentVoicesService],
})
export class ResidentVoicesModule {}
