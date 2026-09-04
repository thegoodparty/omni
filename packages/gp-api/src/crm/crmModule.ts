import { Module } from '@nestjs/common'
import { HubspotService } from './hubspot.service'
import { CrmTeamMembersService } from './crmTeamMembers.service'
import { AssociationLabelsService } from './associationLabels.service'
import { HubspotSingleSendService } from './hubspotSingleSend.service'
import { HttpModule } from '@nestjs/axios'
import { CrmController } from './crm.controller'

@Module({
  providers: [
    HubspotService,
    CrmTeamMembersService,
    AssociationLabelsService,
    HubspotSingleSendService,
  ],
  imports: [HttpModule],
  exports: [
    HubspotService,
    CrmTeamMembersService,
    AssociationLabelsService,
    HubspotSingleSendService,
  ],
  controllers: [CrmController],
})
export class CrmModule {}
