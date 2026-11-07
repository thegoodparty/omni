import { Reflector } from '@nestjs/core'
import type { JobName, JobRun } from './jobs.registry'

export const JobHandlerMetadata = Reflector.createDecorator<JobName>()

// Marks the provider method that works a JOBS queue. JobsService finds it at
// boot and fails the boot if a queue has no handler or two of them. The
// descriptor type makes a handler that takes the wrong payload a type error.
export const JobHandler =
  <N extends JobName>(name: N) =>
  (
    target: object,
    key: string | symbol,
    descriptor: TypedPropertyDescriptor<(job: JobRun<N>) => Promise<void>>,
  ) => {
    JobHandlerMetadata(name)(target, key, descriptor)
  }
