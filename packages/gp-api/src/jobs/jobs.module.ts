import { Global, Module } from '@nestjs/common'
import { JobWorkersService } from './jobWorkers.service'
import { JobsService } from './jobs.service'

// Global so any provider can inject JobsService to send a job without
// importing this module.
@Global()
@Module({
  providers: [JobsService, JobWorkersService],
  exports: [JobsService],
})
export class JobsModule {}
