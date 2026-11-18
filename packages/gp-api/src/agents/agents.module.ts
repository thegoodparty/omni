import { Module } from '@nestjs/common'
import { AgentModels } from './agentModels'
import { AgentsService } from './agents.service'
import { AgentWebService } from './tools/agentWeb.service'
import { AgentPageReplayService } from './tools/judgeReplay'

@Module({
  providers: [
    AgentsService,
    AgentModels,
    AgentWebService,
    AgentPageReplayService,
  ],
  exports: [AgentsService],
})
export class AgentsModule {}
