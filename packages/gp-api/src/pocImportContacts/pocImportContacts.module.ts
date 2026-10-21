import { Module } from '@nestjs/common'
import { ContactsModule } from '@/contacts/contacts.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { PeopleQueryModule } from '@/peopleDb/peopleQuery.module'
import { PocImportContactsController } from './pocImportContacts.controller'
import { PocContactImportService } from './services/pocContactImport.service'
import { PocMirrorShimService } from './services/pocMirrorShim.service'

@Module({
  imports: [ContactsModule, OrganizationsModule, PeopleQueryModule],
  controllers: [PocImportContactsController],
  providers: [PocContactImportService, PocMirrorShimService],
})
export class PocImportContactsModule {}
