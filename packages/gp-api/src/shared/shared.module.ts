import { Global, Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { VoterFileDownloadAccessService } from './services/voterFileDownloadAccess.service'
import { ProcessTimersService } from './services/process-timers.service'
import { AudioTranscodeService } from './services/audioTranscode.service'

@Global()
@Module({
  imports: [HttpModule],
  providers: [
    VoterFileDownloadAccessService,
    ProcessTimersService,
    AudioTranscodeService,
  ],
  exports: [
    VoterFileDownloadAccessService,
    ProcessTimersService,
    AudioTranscodeService,
  ],
})
export class SharedModule {}
