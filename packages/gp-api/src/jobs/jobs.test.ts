import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { ModuleRef } from '@nestjs/core'
import { PinoLogger } from 'nestjs-pino'
import { PgBoss, TestClock } from 'pg-boss'
import { describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'
import { ContactUploadProcessJobService } from '@/contactUploads/services/contactUploadProcessJob.service'
import { PrismaService } from '@/prisma/prisma.service'
import { requireEnv } from '@/shared/util/env.util'
import { useTestService } from '@/test-service'
import { JOBS, type Jobs, SCHEDULES } from './jobs.registry'
import { JobsService } from './jobs.service'

const service = useTestService()

// Another gp-api task's JobsService, with workers, on the test database.
// The test app's own runs no workers, so these do all the work.
const startTask = async (jobs: Jobs = JOBS): Promise<JobsService> => {
  const task = new JobsService(
    jobs,
    SCHEDULES,
    service.app.get(PrismaService),
    service.app.get(ModuleRef),
    await service.app.resolve(PinoLogger),
  )
  vi.stubEnv('TEST_JOBS', 'on')
  try {
    await task.onModuleInit()
    await task.onApplicationBootstrap()
  } finally {
    vi.unstubAllEnvs()
  }
  return task
}

const waitFor = async (check: () => Promise<boolean> | boolean) => {
  const deadline = performance.now() + 15_000
  while (!(await check())) {
    if (performance.now() > deadline) throw new Error('waitFor timed out')
    await sleep(100)
  }
}

const jobRow = async (id: string) => {
  const [row] = await service.prisma.$queryRaw<Array<{ state: string }>>`
    SELECT state::text FROM pgboss.job WHERE id = ${id}::uuid`
  return row
}

const databaseNow = async () => {
  const [row] = await service.prisma.$queryRaw<Array<{ now: Date }>>`
    SELECT now()`
  if (!row) throw new Error('SELECT now() returned no row')
  return row.now
}

// Seconds from `since` until the job can be claimed, by the database's clock.
const claimableAfterSeconds = async (id: string, since: Date) => {
  const [row] = await service.prisma.$queryRaw<Array<{ seconds: number }>>`
    SELECT extract(epoch FROM start_after - ${since}::timestamptz)::float8
      AS seconds
    FROM pgboss.job WHERE id = ${id}::uuid`
  return row?.seconds
}

// Stands in for waiting out a requeued job's delay.
const makeClaimableNow = async (id: string) => {
  await service.prisma.$executeRaw`
    UPDATE pgboss.job SET start_after = now() WHERE id = ${id}::uuid`
}

const queuedUploadIds = async (): Promise<string[]> => {
  const rows = await service.prisma.$queryRaw<
    Array<{ upload_id: string }>
  >`SELECT data->>'uploadId' AS upload_id FROM pgboss.job
    WHERE name = 'contactUploadProcess'`
  return rows.map((row) => row.upload_id)
}

describe('JobsService', () => {
  it('boots against the pgboss schema the Prisma migration installed', async () => {
    const [row] = await service.prisma.$queryRaw<Array<{ version: number }>>`
      SELECT version FROM pgboss.version`
    expect(row?.version).toBe(46)
  })

  it('tells a test without workers that settle and runSchedule need them', async () => {
    await expect(service.jobs.settle()).rejects.toThrow(
      'needs useTestService({ jobs: true })',
    )
    await expect(service.jobs.runSchedule('weeklyTasksDigest')).rejects.toThrow(
      'needs useTestService({ jobs: true })',
    )
    expect(
      await service.prisma.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM pgboss.job`,
    ).toEqual([{ count: 0 }])
  })

  it('queues a job', async () => {
    const uploadId = randomUUID()
    const id = await service.app
      .get(JobsService)
      .send('contactUploadProcess', { uploadId })
    expect(id).toEqual(expect.any(String))
    expect(await queuedUploadIds()).toEqual([uploadId])
  })

  it('commits a job with the Prisma transaction it was sent in', async () => {
    const uploadId = randomUUID()
    await service.prisma.$transaction(async (tx) => {
      await service.app
        .get(JobsService)
        .send('contactUploadProcess', { uploadId }, { tx })
      expect(await queuedUploadIds()).toEqual([])
    })
    expect(await queuedUploadIds()).toEqual([uploadId])
  })

  it('drops a job when its Prisma transaction rolls back', async () => {
    await expect(
      service.prisma.$transaction(async (tx) => {
        await service.app
          .get(JobsService)
          .send('contactUploadProcess', { uploadId: randomUUID() }, { tx })
        throw new Error('rollback')
      }),
    ).rejects.toThrow('rollback')
    expect(await queuedUploadIds()).toEqual([])
  })

  it('rejects data that does not match the job schema', async () => {
    await expect(
      service.app
        .get(JobsService)
        .send('contactUploadProcess', { uploadId: 'not-a-uuid' }),
    ).rejects.toBeInstanceOf(ZodError)
    expect(await queuedUploadIds()).toEqual([])
  })

  it('makes every queue FIFO per group, with a heartbeat and a dead-letter queue', async () => {
    const rows = await service.prisma.$queryRaw<
      Array<{
        name: string
        policy: string
        dead_letter: string | null
        heartbeat_seconds: number | null
        retry_limit: number
      }>
    >`SELECT name, policy, dead_letter, heartbeat_seconds, retry_limit
      FROM pgboss.queue WHERE NOT starts_with(name, '__pgboss__')
      ORDER BY name`
    // A dead-letter queue has no worker, so only its existence matters.
    expect(rows).toMatchObject([
      {
        name: 'agentExperimentResult',
        policy: 'key_strict_fifo',
        dead_letter: 'agentExperimentResult-dlq',
        heartbeat_seconds: 60,
        retry_limit: 2,
      },
      { name: 'agentExperimentResult-dlq' },
      {
        name: 'campaignPlanComplete',
        policy: 'key_strict_fifo',
        dead_letter: 'campaignPlanComplete-dlq',
        heartbeat_seconds: 60,
        retry_limit: 2,
      },
      { name: 'campaignPlanComplete-dlq' },
      {
        name: 'contactUploadProcess',
        policy: 'key_strict_fifo',
        dead_letter: 'contactUploadProcess-dlq',
        heartbeat_seconds: 60,
        retry_limit: 5,
      },
      { name: 'contactUploadProcess-dlq' },
      {
        name: 'contactUploadStuckSweep',
        policy: 'key_strict_fifo',
        dead_letter: 'contactUploadStuckSweep-dlq',
        heartbeat_seconds: 60,
        retry_limit: 2,
      },
      { name: 'contactUploadStuckSweep-dlq' },
      {
        name: 'extractChatAttachment',
        policy: 'key_strict_fifo',
        dead_letter: 'extractChatAttachment-dlq',
        heartbeat_seconds: 60,
        retry_limit: 2,
      },
      { name: 'extractChatAttachment-dlq' },
      {
        name: 'feedbackSynthesisComplete',
        policy: 'key_strict_fifo',
        dead_letter: 'feedbackSynthesisComplete-dlq',
        heartbeat_seconds: 60,
        retry_limit: 2,
      },
      { name: 'feedbackSynthesisComplete-dlq' },
      {
        name: 'ocrAttachment',
        policy: 'key_strict_fifo',
        dead_letter: 'ocrAttachment-dlq',
        heartbeat_seconds: 60,
        retry_limit: 2,
      },
      { name: 'ocrAttachment-dlq' },
      {
        name: 'panelRepliesUploaded',
        policy: 'key_strict_fifo',
        dead_letter: 'panelRepliesUploaded-dlq',
        heartbeat_seconds: 60,
        retry_limit: 2,
      },
      { name: 'panelRepliesUploaded-dlq' },
      {
        name: 'paymentHoldExpiryGuard',
        policy: 'key_strict_fifo',
        dead_letter: 'paymentHoldExpiryGuard-dlq',
        heartbeat_seconds: 60,
        retry_limit: 2,
      },
      { name: 'paymentHoldExpiryGuard-dlq' },
      {
        name: 'paymentHoldPlace',
        policy: 'key_strict_fifo',
        dead_letter: 'paymentHoldPlace-dlq',
        heartbeat_seconds: 60,
        retry_limit: 2,
      },
      { name: 'paymentHoldPlace-dlq' },
      {
        name: 'paymentHoldPlacementSweep',
        policy: 'key_strict_fifo',
        dead_letter: 'paymentHoldPlacementSweep-dlq',
        heartbeat_seconds: 60,
        retry_limit: 2,
      },
      { name: 'paymentHoldPlacementSweep-dlq' },
      {
        name: 'paymentHoldReconcileOrphan',
        policy: 'key_strict_fifo',
        dead_letter: 'paymentHoldReconcileOrphan-dlq',
        heartbeat_seconds: 60,
        retry_limit: 2,
      },
      { name: 'paymentHoldReconcileOrphan-dlq' },
      {
        name: 'paymentHoldReconcileSweep',
        policy: 'key_strict_fifo',
        dead_letter: 'paymentHoldReconcileSweep-dlq',
        heartbeat_seconds: 60,
        retry_limit: 2,
      },
      { name: 'paymentHoldReconcileSweep-dlq' },
      {
        name: 'paymentHoldRecover',
        policy: 'key_strict_fifo',
        dead_letter: 'paymentHoldRecover-dlq',
        heartbeat_seconds: 60,
        retry_limit: 2,
      },
      { name: 'paymentHoldRecover-dlq' },
      {
        name: 'paymentHoldRecoverySweep',
        policy: 'key_strict_fifo',
        dead_letter: 'paymentHoldRecoverySweep-dlq',
        heartbeat_seconds: 60,
        retry_limit: 2,
      },
      { name: 'paymentHoldRecoverySweep-dlq' },
      {
        name: 'paymentHoldReleaseUnpaid',
        policy: 'key_strict_fifo',
        dead_letter: 'paymentHoldReleaseUnpaid-dlq',
        heartbeat_seconds: 60,
        retry_limit: 2,
      },
      { name: 'paymentHoldReleaseUnpaid-dlq' },
      {
        name: 'paymentHoldRemind',
        policy: 'key_strict_fifo',
        dead_letter: 'paymentHoldRemind-dlq',
        heartbeat_seconds: 60,
        retry_limit: 2,
      },
      { name: 'paymentHoldRemind-dlq' },
      {
        name: 'paymentHoldReminderSweep',
        policy: 'key_strict_fifo',
        dead_letter: 'paymentHoldReminderSweep-dlq',
        heartbeat_seconds: 60,
        retry_limit: 2,
      },
      { name: 'paymentHoldReminderSweep-dlq' },
      {
        name: 'paymentHoldSettleExpiring',
        policy: 'key_strict_fifo',
        dead_letter: 'paymentHoldSettleExpiring-dlq',
        heartbeat_seconds: 60,
        retry_limit: 2,
      },
      { name: 'paymentHoldSettleExpiring-dlq' },
      {
        name: 'paymentHoldUnpaidSweep',
        policy: 'key_strict_fifo',
        dead_letter: 'paymentHoldUnpaidSweep-dlq',
        heartbeat_seconds: 60,
        retry_limit: 2,
      },
      { name: 'paymentHoldUnpaidSweep-dlq' },
      {
        name: 'pollAnalysisComplete',
        policy: 'key_strict_fifo',
        dead_letter: 'pollAnalysisComplete-dlq',
        heartbeat_seconds: 60,
        retry_limit: 2,
      },
      { name: 'pollAnalysisComplete-dlq' },
      {
        name: 'weeklyTasksDigest',
        policy: 'key_strict_fifo',
        dead_letter: 'weeklyTasksDigest-dlq',
        heartbeat_seconds: 60,
        retry_limit: 2,
      },
      { name: 'weeklyTasksDigest-dlq' },
      {
        name: 'weeklyTasksDigestCampaign',
        policy: 'key_strict_fifo',
        dead_letter: 'weeklyTasksDigestCampaign-dlq',
        heartbeat_seconds: 60,
        retry_limit: 2,
      },
      { name: 'weeklyTasksDigestCampaign-dlq' },
    ])
  })

  it('puts a job sent without a group in a group of its own', async () => {
    const jobs = service.app.get(JobsService)
    const uploadId = randomUUID()
    const id = await jobs.send('contactUploadProcess', { uploadId })
    const grouped = await jobs.send(
      'contactUploadProcess',
      { uploadId: randomUUID() },
      { group: 'eo-springfield' },
    )
    const rows = await service.prisma.$queryRaw<
      Array<{ id: string; singleton_key: string }>
    >`SELECT id::text, singleton_key FROM pgboss.job
      WHERE name = 'contactUploadProcess' ORDER BY created_on`
    expect(rows).toEqual([
      { id, singleton_key: id },
      { id: grouped, singleton_key: 'eo-springfield' },
    ])
  })

  describe('sendMany', () => {
    const queuedJobs = () =>
      service.prisma.$queryRaw<
        Array<{ id: string; singleton_key: string; upload_id: string }>
      >`SELECT id::text, singleton_key, data->>'uploadId' AS upload_id
        FROM pgboss.job WHERE name = 'contactUploadProcess'
        ORDER BY created_on, id`

    it('queues one job per item, with an id fixed by its key', async () => {
      const jobs = service.app.get(JobsService)
      const items = [randomUUID(), randomUUID()].map((uploadId) => ({
        data: { uploadId },
        key: uploadId,
      }))

      const ids = await jobs.sendMany('contactUploadProcess', items)

      expect(await jobs.sendMany('contactUploadProcess', items)).toEqual(ids)
      const rows = await queuedJobs()
      expect(rows.map((row) => row.id).sort()).toEqual([...ids].sort())
      // No group: each job is its own.
      for (const row of rows) expect(row.singleton_key).toBe(row.id)
    })

    it('skips items whose job is already queued, without an error', async () => {
      const jobs = service.app.get(JobsService)
      const first = { data: { uploadId: randomUUID() }, key: 'a' }
      const second = { data: { uploadId: randomUUID() }, key: 'b' }
      await jobs.sendMany('contactUploadProcess', [first])

      await jobs.sendMany('contactUploadProcess', [first, second])
      await jobs.sendMany('contactUploadProcess', [first, second])

      expect((await queuedJobs()).map((row) => row.upload_id)).toEqual([
        first.data.uploadId,
        second.data.uploadId,
      ])
    })

    it('inserts in chunks of 1,000', async () => {
      const items = Array.from({ length: 2001 }, (_, index) => ({
        data: { uploadId: randomUUID() },
        key: String(index),
      }))

      await service.app.get(JobsService).sendMany('contactUploadProcess', items)

      expect(await queuedJobs()).toHaveLength(2001)
    })

    it('inserts nothing when any item fails the schema', async () => {
      await expect(
        service.app.get(JobsService).sendMany('contactUploadProcess', [
          { data: { uploadId: randomUUID() }, key: 'good' },
          { data: { uploadId: 'not-a-uuid' }, key: 'bad' },
        ]),
      ).rejects.toBeInstanceOf(ZodError)
      expect(await queuedJobs()).toEqual([])
    })

    it('rejects two items with the same key', async () => {
      await expect(
        service.app.get(JobsService).sendMany('contactUploadProcess', [
          { data: { uploadId: randomUUID() }, key: 'same' },
          { data: { uploadId: randomUUID() }, key: 'same' },
        ]),
      ).rejects.toThrow('two items share a key')
      expect(await queuedJobs()).toEqual([])
    })

    it('puts items in the group they name', async () => {
      await service.app.get(JobsService).sendMany('contactUploadProcess', [
        {
          data: { uploadId: randomUUID() },
          key: 'a',
          group: 'eo-springfield',
        },
      ])

      expect((await queuedJobs()).map((row) => row.singleton_key)).toEqual([
        'eo-springfield',
      ])
    })
  })

  describe('schedules', () => {
    const schedules = () =>
      service.prisma.$queryRaw<
        Array<{
          name: string
          key: string
          cron: string
          timezone: string
          options: object
        }>
      >`SELECT name, key, cron, timezone, options FROM pgboss.schedule
        ORDER BY name, key`

    it('registers every schedule at boot', async () => {
      expect(await schedules()).toEqual([
        {
          name: 'contactUploadStuckSweep',
          key: '',
          cron: '3-59/5 * * * *',
          timezone: 'UTC',
          options: expect.objectContaining({
            missed: 'skip',
            singletonKey: 'contactUploadStuckSweep',
          }),
        },
        {
          name: 'paymentHoldExpiryGuard',
          key: '',
          cron: '38 * * * *',
          timezone: 'UTC',
          options: expect.objectContaining({
            missed: 'skip',
            singletonKey: 'paymentHoldExpiryGuard',
          }),
        },
        {
          name: 'paymentHoldPlacementSweep',
          key: '',
          cron: '1,11,21,31,41,51 * * * *',
          timezone: 'UTC',
          options: expect.objectContaining({
            missed: 'skip',
            singletonKey: 'paymentHoldPlacementSweep',
          }),
        },
        {
          name: 'paymentHoldReconcileSweep',
          key: '',
          cron: '24 * * * *',
          timezone: 'UTC',
          options: expect.objectContaining({
            missed: 'skip',
            singletonKey: 'paymentHoldReconcileSweep',
          }),
        },
        {
          name: 'paymentHoldRecoverySweep',
          key: '',
          cron: '6,16,26,36,46,56 * * * *',
          timezone: 'UTC',
          options: expect.objectContaining({
            missed: 'skip',
            singletonKey: 'paymentHoldRecoverySweep',
          }),
        },
        {
          name: 'paymentHoldReminderSweep',
          key: '',
          cron: '18 15 * * *',
          timezone: 'UTC',
          options: expect.objectContaining({
            missed: 'skip',
            singletonKey: 'paymentHoldReminderSweep',
          }),
        },
        {
          name: 'paymentHoldUnpaidSweep',
          key: '',
          cron: '5,15,25,35,45,55 * * * *',
          timezone: 'UTC',
          options: expect.objectContaining({
            missed: 'skip',
            singletonKey: 'paymentHoldUnpaidSweep',
          }),
        },
        {
          name: 'weeklyTasksDigest',
          key: '',
          cron: '0 4 * * 1',
          timezone: 'UTC',
          options: expect.objectContaining({
            missed: 'skip',
            singletonKey: 'weeklyTasksDigest',
          }),
        },
      ])
    })

    it('removes schedules that are no longer in the registry', async () => {
      const boss = new PgBoss({
        connectionString: requireEnv('DATABASE_URL'),
        migrate: false,
        supervise: false,
        schedule: false,
        max: 1,
      })
      await boss.start()
      try {
        await boss.createQueue('retiredSchedule')
        await boss.schedule('retiredSchedule', '0 3 * * *')
        await boss.schedule(
          'weeklyTasksDigest',
          '0 4 * * *',
          {},
          {
            key: 'stray',
            singletonKey: 'weeklyTasksDigest',
          },
        )

        // Boot again: start() is a no-op on a started instance, and the
        // sync runs.
        await service.app.get(JobsService).onModuleInit()

        expect((await schedules()).map(({ name, key }) => [name, key])).toEqual(
          [
            ['contactUploadStuckSweep', ''],
            ['paymentHoldExpiryGuard', ''],
            ['paymentHoldPlacementSweep', ''],
            ['paymentHoldReconcileSweep', ''],
            ['paymentHoldRecoverySweep', ''],
            ['paymentHoldReminderSweep', ''],
            ['paymentHoldUnpaidSweep', ''],
            ['weeklyTasksDigest', ''],
          ],
        )
      } finally {
        await boss.deleteQueue('retiredSchedule')
        await boss.stop({ graceful: false })
      }
    })

    // pg-boss dedupes a scheduled occurrence across tasks on its own internal
    // queue, while ours are key_strict_fifo and need a singletonKey on every
    // job (jobs.service.ts, syncSchedules). Two instances on a test clock run
    // the cron pass inside one occurrence's due window.
    it('sends one job per due occurrence, in the schedule group, when two instances run the cron pass', async () => {
      // Monday 2026-04-20, 04:00 UTC, five seconds in.
      const clock = new TestClock('2026-04-20T04:00:05.000Z')
      const options = {
        connectionString: requireEnv('DATABASE_URL'),
        migrate: false,
        supervise: false,
        schedule: true,
        max: 2,
        clock,
      }
      const first = new PgBoss(options)
      const second = new PgBoss(options)
      try {
        // start() runs a cron pass right away, which claims this interval.
        await first.start()
        await clock.tick(1000)
        await first.stop({ graceful: false })
        // The second instance's next pass, 30 seconds after the first,
        // finds the same occurrence still due and sends it again.
        await second.start()
        await clock.tick(45_000)
      } finally {
        await first.stop({ graceful: false })
        await second.stop({ graceful: false })
      }

      // The second instance did run a pass inside the due window.
      const [version] = await service.prisma.$queryRaw<
        Array<{ cron_on: Date }>
      >`SELECT cron_on FROM pgboss.version`
      expect(version?.cron_on.toISOString()).toBe('2026-04-20T04:00:36.000Z')
      const passes = await service.prisma.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM pgboss.job
        WHERE name = '__pgboss__send-it'`
      const jobs = await service.prisma.$queryRaw<
        Array<{ singleton_key: string; data: object }>
      >`SELECT singleton_key, data FROM pgboss.job
        WHERE name = 'weeklyTasksDigest'`
      expect(passes).toEqual([{ count: 1 }])
      expect(jobs).toEqual([{ singleton_key: 'weeklyTasksDigest', data: {} }])
    })
  })

  describe('shutdown', () => {
    it('puts a job that stops on its signal back in its queue without spending an attempt', async () => {
      const attempts: number[] = []
      vi.spyOn(
        service.app.get(ContactUploadProcessJobService),
        'process',
      ).mockImplementation(async (job) => {
        attempts.push(job.retryCount)
        if (attempts.length === 1) throw new Error('Databricks down')
        if (attempts.length === 2) {
          await new Promise((resolve) =>
            job.signal.addEventListener('abort', resolve, { once: true }),
          )
          throw new Error('stopped between chunks')
        }
      })
      const first = await startTask()
      const id = await service.app
        .get(JobsService)
        .send('contactUploadProcess', { uploadId: randomUUID() })
      await waitFor(() => attempts.length === 2)

      const stopStartedAt = await databaseNow()
      await first.onModuleDestroy()

      expect((await jobRow(id))?.state).toBe('retry')
      // ECS kills a stopping task 30 seconds after SIGTERM.
      expect(await claimableAfterSeconds(id, stopStartedAt)).toBeGreaterThan(30)
      await makeClaimableNow(id)
      const second = await startTask()
      try {
        await waitFor(async () => (await jobRow(id))?.state === 'completed')
      } finally {
        await second.onModuleDestroy()
      }
      // The failure spent an attempt; the shutdown did not.
      expect(attempts).toEqual([0, 1, 1])
    })

    it('puts a job still running when the grace ends back in its queue without spending an attempt', async () => {
      const attempts: number[] = []
      let release: () => void = () => undefined
      vi.spyOn(
        service.app.get(ContactUploadProcessJobService),
        'process',
      ).mockImplementation(async (job) => {
        attempts.push(job.retryCount)
        // Ignores its signal.
        if (attempts.length === 1) {
          await new Promise<void>((resolve) => {
            release = resolve
          })
        }
      })
      const first = await startTask()
      const id = await service.app
        .get(JobsService)
        .send('contactUploadProcess', { uploadId: randomUUID() })
      await waitFor(() => attempts.length === 1)

      const stopStartedAt = await databaseNow()
      await first.onModuleDestroy()
      release()

      expect((await jobRow(id))?.state).toBe('retry')
      // Its handler may still be running, so the job waits until ECS has
      // killed this task, 30 seconds after SIGTERM.
      expect(await claimableAfterSeconds(id, stopStartedAt)).toBeGreaterThan(30)
      await makeClaimableNow(id)
      const second = await startTask()
      try {
        await waitFor(async () => (await jobRow(id))?.state === 'completed')
      } finally {
        await second.onModuleDestroy()
      }
      expect(attempts).toEqual([0, 0])
    })
  })

  it('runs no more than maxConcurrent jobs of a queue at once across tasks', async () => {
    const capped: Jobs = {
      ...JOBS,
      contactUploadProcess: { ...JOBS.contactUploadProcess, maxConcurrent: 2 },
    }
    let running = 0
    let mostRunning = 0
    const releases: Array<() => void> = []
    vi.spyOn(
      service.app.get(ContactUploadProcessJobService),
      'process',
    ).mockImplementation(async () => {
      running++
      mostRunning = Math.max(mostRunning, running)
      await new Promise<void>((resolve) => releases.push(resolve))
      running--
    })
    // Four workers each (concurrency 4), eight in all.
    const first = await startTask(capped)
    const second = await startTask(capped)
    try {
      await first.send('contactUploadProcess', { uploadId: randomUUID() })
      await second.sendMany(
        'contactUploadProcess',
        Array.from({ length: 4 }, (_, index) => ({
          data: { uploadId: randomUUID() },
          key: String(index),
        })),
      )
      await waitFor(() => running >= 2)
      // Several polls of every worker, none of which may start a third.
      await sleep(1500)
      expect(running).toBe(2)

      await waitFor(async () => {
        for (const release of releases.splice(0)) release()
        const [done] = await service.prisma.$queryRaw<
          Array<{ count: number }>
        >`SELECT count(*)::int AS count FROM pgboss.job
          WHERE name = 'contactUploadProcess' AND state = 'completed'`
        return done?.count === 5
      })
      expect(mostRunning).toBe(2)
    } finally {
      for (const release of releases) release()
      await first.onModuleDestroy()
      await second.onModuleDestroy()
    }
  })
})
