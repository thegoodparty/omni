import { Module } from '@nestjs/common'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { OutreachModule } from '@/outreach/outreach.module'
import { OutreachProposalController } from './outreachProposal.controller'

@Module({
  imports: [OrganizationsModule, OutreachModule],
  controllers: [OutreachProposalController],
})
export class OutreachProposalModule {}
