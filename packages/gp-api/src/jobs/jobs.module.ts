import { Global, Module } from '@nestjs/common'
import { DiscoveryModule } from '@nestjs/core'
import { JobsService } from './jobs.service'

// Global so any provider can inject JobsService to send a job without
// importing this module.
@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
