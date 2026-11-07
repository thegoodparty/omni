import { Injectable, OnApplicationBootstrap } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { JOB_NAMES, type JobName } from './jobs.registry'
import { JobsService } from './jobs.service'
import { WORKERS, type WorkerContext } from './jobs.workers'

// Starts jobs.workers.ts on every task. Separate from JobsService because
// workers import feature services, and feature services import JobsService.
@Injectable()
export class JobWorkersService implements OnApplicationBootstrap {
  constructor(
    private readonly jobs: JobsService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test' && process.env.TEST_JOBS !== 'on') {
      return
    }
    const context: WorkerContext = {
      get: (type) => this.moduleRef.get(type, { strict: false }),
    }
    const start = <N extends JobName>(name: N) =>
      this.jobs.work(name, (job) => WORKERS[name](job, context))
    for (const name of JOB_NAMES) await start(name)
  }
}
