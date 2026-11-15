import { Global, Module } from '@nestjs/common'
import { JOBS, SCHEDULES } from './jobs.registry'
import { JOBS_REGISTRY, JobsService, SCHEDULES_REGISTRY } from './jobs.service'

// Global so any provider can inject JobsService to send a job without
// importing this module. The only runtime importer of the registry; see
// jobs.registry.ts.
@Global()
@Module({
  providers: [
    { provide: JOBS_REGISTRY, useValue: JOBS },
    { provide: SCHEDULES_REGISTRY, useValue: SCHEDULES },
    JobsService,
  ],
  exports: [JobsService],
})
export class JobsModule {}
