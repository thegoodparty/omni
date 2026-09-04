import { Module } from '@nestjs/common'
import { HubspotService } from './hubspot.service'
import { CrmTeamMembersService } from './crmTeamMembers.service'
import { HttpModule } from '@nestjs/axios'
import { CrmController } from './crm.controller'

@Module({
  providers: [HubspotService, CrmTeamMembersService],
  imports: [HttpModule],
  exports: [HubspotService, CrmTeamMembersService],
  controllers: [CrmController],
})
export class CrmModule {}
