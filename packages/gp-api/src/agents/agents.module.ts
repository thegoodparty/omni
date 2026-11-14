import { Module } from '@nestjs/common'
import { resolveDatabricksConnection } from '@/llm/tools/databricksConnection'
import { DatabricksSqlProvider } from '@/llm/tools/databricksProvider'
import { CommunityIssuesModule } from '@/communityIssues/communityIssues.module'
import { MeetingsModule } from '@/meetings/meetings.module'
import { PrioritiesModule } from '@/priorities/priorities.module'
import { AGENT_RUNTIME, AgentsService } from './agents.service'
import { LangGraphModule } from './langgraph/langGraph.module'
import { LangGraphAgentRuntime } from './langgraph/langGraphRuntime'
import { AgentToolsModule } from './tools/agentTools.module'
import {
  BRIEFING_CONSTITUENT_DATA,
  ConstituentSentimentService,
} from './meetingBriefing/constituentSentiment.service'

@Module({
  imports: [
    AgentToolsModule,
    LangGraphModule,
    MeetingsModule,
    PrioritiesModule,
    CommunityIssuesModule,
  ],
  providers: [
    AgentsService,
    LangGraphAgentRuntime,
    { provide: AGENT_RUNTIME, useExisting: LangGraphAgentRuntime },
    ConstituentSentimentService,
    {
      provide: BRIEFING_CONSTITUENT_DATA,
      useFactory: () => {
        const conn = resolveDatabricksConnection()
        return conn ? new DatabricksSqlProvider(conn) : null
      },
    },
  ],
  exports: [AgentsService, LangGraphAgentRuntime],
})
export class AgentsModule {}
