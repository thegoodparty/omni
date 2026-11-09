import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { useTestService } from '@/test-service'
import { defineJob, JOBS } from './jobs.registry'
import { JobsService } from './jobs.service'

// A second queue, registered before the app boots, so there is a max across
// queues to read.
Object.assign(JOBS, {
  waitPressureProbe: defineJob({
    schema: z.object({}),
    worker: () => Promise.resolve(),
    alertAfterWaitingMinutes: 1,
  }),
})

const service = useTestService()

const insertJob = async ({
  name = 'contactUploadProcess',
  group,
  state = 'created',
  waitedSeconds,
}: {
  name?: string
  group: string
  state?: 'created' | 'retry' | 'active'
  waitedSeconds: number
}): Promise<void> => {
  await service.prisma.$executeRaw`
    INSERT INTO pgboss.job
      (name, singleton_key, policy, state, created_on, start_after)
    VALUES (
      ${name}, ${group}, 'key_strict_fifo', ${state}::pgboss.job_state,
      now() - make_interval(secs => ${waitedSeconds}),
      now() - make_interval(secs => ${waitedSeconds})
    )`
}

describe('JobsService.refreshWaitPressure', () => {
  it('is 0 when nothing waits', async () => {
    expect(await service.app.get(JobsService).refreshWaitPressure()).toBe(0)
  })

  it('is the oldest waiting job over its allowed wait', async () => {
    await insertJob({ group: 'eo-springfield', waitedSeconds: 5 * 60 })
    await insertJob({ group: 'eo-shelbyville', waitedSeconds: 60 })

    expect(
      await service.app.get(JobsService).refreshWaitPressure(),
    ).toBeCloseTo(0.5, 2)
  })

  it('leaves out a job queued behind an active job of its group', async () => {
    await insertJob({
      group: 'eo-springfield',
      state: 'active',
      waitedSeconds: 20 * 60,
    })
    await insertJob({ group: 'eo-springfield', waitedSeconds: 9 * 60 })
    await insertJob({ group: 'eo-shelbyville', waitedSeconds: 60 })

    expect(
      await service.app.get(JobsService).refreshWaitPressure(),
    ).toBeCloseTo(0.1, 2)
  })

  it('counts a due retry, not the jobs behind it, from when it came due', async () => {
    await insertJob({ group: 'eo-springfield', waitedSeconds: 9 * 60 })
    await service.prisma.$executeRaw`
      INSERT INTO pgboss.job
        (name, singleton_key, policy, state, created_on, start_after)
      VALUES (
        'contactUploadProcess', 'eo-springfield', 'key_strict_fifo', 'retry',
        now() - interval '30 minutes', now() - interval '2 minutes'
      )`

    expect(
      await service.app.get(JobsService).refreshWaitPressure(),
    ).toBeCloseTo(0.2, 2)
  })

  it('reports the highest queue', async () => {
    await insertJob({ group: 'eo-springfield', waitedSeconds: 5 * 60 })
    await insertJob({
      name: 'waitPressureProbe',
      group: 'eo-shelbyville',
      waitedSeconds: 90,
    })

    expect(
      await service.app.get(JobsService).refreshWaitPressure(),
    ).toBeCloseTo(1.5, 2)
  })
})
