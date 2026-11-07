import type { Type } from '@nestjs/common'
import type { JobName, JobRun } from './jobs.registry'

export type WorkerContext = {
  // Any provider in the app, e.g. get(ContactUploadsService).
  get: <T>(type: Type<T>) => T
}

type Worker<N extends JobName> = (
  job: JobRun<N>,
  context: WorkerContext,
) => Promise<void>

// The one worker for each job in JOBS. The type requires an entry for every
// job and allows only one. Return to complete the job; throw to retry it.
export const WORKERS: { [N in JobName]: Worker<N> } = {}
