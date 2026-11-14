import { Module } from '@nestjs/common'
import { resolveDatabricksConnection } from '@/llm/tools/databricksConnection'
import { DatabricksSqlProvider } from '@/llm/tools/databricksProvider'
import { CommunityIssuesModule } from '@/communityIssues/communityIssues.module'
import { MeetingsModule } from '@/meetings/meetings.module'
import { PrioritiesModule } from '@/priorities/priorities.module'
import { AiSdkAgentRuntime } from './aiSdk/aiSdkAgentRuntime.service'
import { AgentModels } from './aiSdk/agentModels'
import { AGENT_RUNTIME, AgentsService } from './agents.service'
import { AgentToolsModule } from './tools/agentTools.module'
import {
  BRIEFING_CONSTITUENT_DATA,
  ConstituentSentimentService,
} from './meetingBriefing/constituentSentiment.service'

@Module({
  imports: [
    AgentToolsModule,
    MeetingsModule,
    PrioritiesModule,
    CommunityIssuesModule,
  ],
  providers: [
    AgentsService,
    AgentModels,
    AiSdkAgentRuntime,
    { provide: AGENT_RUNTIME, useExisting: AiSdkAgentRuntime },
    ConstituentSentimentService,
    {
      provide: BRIEFING_CONSTITUENT_DATA,
      useFactory: () => {
        const conn = resolveDatabricksConnection()
        return conn ? new DatabricksSqlProvider(conn) : null
      },
    },
  ],
  exports: [AgentsService, AiSdkAgentRuntime],
})
export class AgentsModule {}
