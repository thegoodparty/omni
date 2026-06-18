import { Module } from '@nestjs/common'
import { AwsModule } from '@/vendors/aws/aws.module'
import { SlackModule } from '@/vendors/slack/slack.module'
import { ExperimentRunsService } from './services/experimentRuns.service'

@Module({
  imports: [AwsModule, SlackModule],
  controllers: [],
  providers: [ExperimentRunsService],
  exports: [ExperimentRunsService],
})
export class AgentExperimentsModule {}
