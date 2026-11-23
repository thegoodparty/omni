import { Module } from '@nestjs/common'
import { AgentModels } from './agentModels'
import { AgentsService } from './agents.service'
import { AgentBrowserService } from './tools/agentBrowser.service'
import { AgentWebService } from './tools/agentWeb.service'

@Module({
  providers: [AgentsService, AgentModels, AgentWebService, AgentBrowserService],
  exports: [AgentsService],
})
export class AgentsModule {}
