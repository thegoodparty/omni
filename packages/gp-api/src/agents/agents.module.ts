import { Module } from '@nestjs/common'
import { AgentModels } from './agentModels'
import { AgentsService } from './agents.service'

@Module({
  providers: [AgentsService, AgentModels],
  exports: [AgentsService],
})
export class AgentsModule {}
