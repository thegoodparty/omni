import { Module } from '@nestjs/common'
import { VoterIssuesService } from './voterIssues.service'

@Module({
  providers: [VoterIssuesService],
  exports: [VoterIssuesService],
})
export class VoterIssuesModule {}
