import { Module } from '@nestjs/common'
import { AgentBrowserService } from './agentBrowser.service'
import { AgentWebService } from './agentWeb.service'
import { AgentPageReplayService } from './judgeReplay'

@Module({
  providers: [AgentBrowserService, AgentPageReplayService, AgentWebService],
  exports: [AgentBrowserService, AgentPageReplayService, AgentWebService],
})
export class AgentToolsModule {}
