import { Module } from '@nestjs/common'
import { AgentExperimentsModule } from '@/agentExperiments/agentExperiments.module'
import { AgentsModule } from '@/agents/agents.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { AwsModule } from '@/vendors/aws/aws.module'
import { AgentRunRoutesController } from './agentRunRoutes.controller'
import { AgentRunRoutesService } from './agentRunRoutes.service'

// The judge's run routes, kept out of AgentsModule so no product request path
// gains them: a caller here starts a paid run of any agent.
@Module({
  imports: [
    AgentExperimentsModule,
    AgentsModule,
    AwsModule,
    OrganizationsModule,
  ],
  controllers: [AgentRunRoutesController],
  providers: [AgentRunRoutesService],
})
export class AgentRunRoutesModule {}
