import { Module } from '@nestjs/common'
import { HubspotService } from './hubspot.service'
import { CrmTeamMembersService } from './crmTeamMembers.service'
import { HubspotSingleSendService } from './hubspotSingleSend.service'
import { HttpModule } from '@nestjs/axios'
import { CrmController } from './crm.controller'

@Module({
  providers: [HubspotService, CrmTeamMembersService, HubspotSingleSendService],
  imports: [HttpModule],
  exports: [HubspotService, CrmTeamMembersService, HubspotSingleSendService],
  controllers: [CrmController],
})
export class CrmModule {}
