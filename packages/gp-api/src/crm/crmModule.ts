import { Module } from '@nestjs/common'
import { HubspotService } from './hubspot.service'
import { CrmTeamMembersService } from './crmTeamMembers.service'
import { AssociationLabelsService } from './associationLabels.service'
import { HttpModule } from '@nestjs/axios'
import { CrmController } from './crm.controller'

@Module({
  providers: [HubspotService, CrmTeamMembersService, AssociationLabelsService],
  imports: [HttpModule],
  exports: [HubspotService, CrmTeamMembersService, AssociationLabelsService],
  controllers: [CrmController],
})
export class CrmModule {}
