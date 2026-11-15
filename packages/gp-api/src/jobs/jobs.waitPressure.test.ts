import { ModuleRef } from '@nestjs/core'
import { PinoLogger } from 'nestjs-pino'
import { describe, expect, it } from 'vitest'
import { PrismaService } from '@/prisma/prisma.service'
import { useTestService } from '@/test-service'
import { JOBS, SCHEDULES } from './jobs.registry'
import { JobsService, jobWaitPressure } from './jobs.service'

const service = useTestService()

const insertJob = async ({
  group,
  state = 'created',
  waitedSeconds,
  pgBossGroup = null,
}: {
  group: string
  state?: 'created' | 'active'
  waitedSeconds: number
  // The queue-wide group send() gives a capped queue's jobs.
  pgBossGroup?: string | null
}): Promise<void> => {
  await service.prisma.$executeRaw`
    INSERT INTO pgboss.job
      (name, singleton_key, group_id, policy, state, created_on, start_after)
    VALUES (
      'contactUploadProcess', ${group}, ${pgBossGroup}, 'key_strict_fifo',
      ${state}::pgboss.job_state,
      now() - make_interval(secs => ${waitedSeconds}),
      now() - make_interval(secs => ${waitedSeconds})
    )`
}

describe('jobWaitPressure', () => {
  it('reports each queue and the highest across them', () => {
    const { byQueue, highest } = jobWaitPressure([
      { name: 'imports', waitedSeconds: 300, alertAfterWaitingMinutes: 10 },
      { name: 'emails', waitedSeconds: 90, alertAfterWaitingMinutes: 1 },
      { name: 'idle', waitedSeconds: 0, alertAfterWaitingMinutes: 5 },
    ])

    expect(byQueue).toEqual(
      new Map([
        ['imports', 0.5],
        ['emails', 1.5],
        ['idle', 0],
      ]),
    )
    expect(highest).toBe(1.5)
  })

  it('is 0 with no queues', () => {
    expect(jobWaitPressure([]).highest).toBe(0)
  })
})

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

  it('leaves out a job of a queue at its maxConcurrent', async () => {
    const capped = new JobsService(
      {
        ...JOBS,
        contactUploadProcess: {
          ...JOBS.contactUploadProcess,
          maxConcurrent: 1,
        },
      },
      SCHEDULES,
      service.app.get(PrismaService),
      service.app.get(ModuleRef),
      await service.app.resolve(PinoLogger),
    )
    await insertJob({
      group: 'eo-springfield',
      state: 'active',
      waitedSeconds: 20 * 60,
      pgBossGroup: 'contactUploadProcess',
    })
    await insertJob({
      group: 'eo-shelbyville',
      waitedSeconds: 9 * 60,
      pgBossGroup: 'contactUploadProcess',
    })
    // Sent before the queue had a cap, so the cap does not hold it.
    await insertJob({ group: 'eo-ogdenville', waitedSeconds: 60 })

    expect(await capped.refreshWaitPressure()).toBeCloseTo(0.1, 2)
    expect(
      await service.app.get(JobsService).refreshWaitPressure(),
    ).toBeCloseTo(0.9, 2)
  })
})
