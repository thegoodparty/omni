import { Module } from '@nestjs/common'
import { ContactsModule } from '@/contacts/contacts.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { PeopleQueryModule } from '@/peopleDb/peopleQuery.module'
import { PocOrgLayerController } from './pocOrgLayer.controller'
import { PocOrgLayerService } from './services/pocOrgLayer.service'

@Module({
  imports: [ContactsModule, OrganizationsModule, PeopleQueryModule],
  controllers: [PocOrgLayerController],
  providers: [PocOrgLayerService],
})
export class PocOrgLayerModule {}
