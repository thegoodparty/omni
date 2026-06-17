import { Module } from '@nestjs/common'
import { VoterOutreachActivityService } from './services/voterOutreachActivity.service'

@Module({
  providers: [VoterOutreachActivityService],
  exports: [VoterOutreachActivityService],
})
export class VoterOutreachActivityModule {}
