import { Module } from '@nestjs/common'
import { ContactsModule } from '@/contacts/contacts.module'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { OutreachModule } from '@/outreach/outreach.module'
import { PhoneBankingModule } from '@/phoneBanking/phoneBanking.module'
import { PrioritiesModule } from '@/priorities/priorities.module'
import { OutreachProposalController } from './outreachProposal.controller'
import { OutreachProposalService } from './services/outreachProposal.service'

// A leaf: it imports both OutreachModule and PhoneBankingModule, and nothing
// imports it back. That is the whole reason this lives outside OutreachModule
// — PhoneBankingModule already depends on OutreachModule, so the dispatch had
// to sit downstream of both rather than inside either.
@Module({
  imports: [
    ContactsModule,
    ElectedOfficeModule,
    OrganizationsModule,
    OutreachModule,
    PhoneBankingModule,
    PrioritiesModule,
  ],
  controllers: [OutreachProposalController],
  providers: [OutreachProposalService],
})
export class OutreachProposalModule {}
