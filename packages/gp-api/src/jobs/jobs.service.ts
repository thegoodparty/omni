import {
  CloudWatchClient,
  PutMetricDataCommand,
  StandardUnit,
} from '@aws-sdk/client-cloudwatch'
import {
  Inject,
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { metrics } from '@opentelemetry/api'
import { randomUUID } from 'node:crypto'
import { PinoLogger } from 'nestjs-pino'
import { v5 as uuidv5 } from 'uuid'
import { z } from 'zod'
import {
  fromPrisma,
  PgBoss,
  type JobSpyInterface,
  type PrismaTransactionLike,
  type QueueResult,
  type WorkOptions,
} from 'pg-boss'
import { PrismaService } from '@/prisma/prisma.service'
import { requireEnv } from '@/shared/util/env.util'
import { OTEL_SERVICE_ENVIRONMENT } from '@/shared/util/appEnvironment.util'
// Types only: JobsModule hands the registry in (JOBS_REGISTRY), because the
// registry imports feature services and they import this file.
import type {
  JobData,
  JobDefinition,
  JobName,
  Jobs,
  ScheduleName,
  Schedules,
  WorkerContext,
} from './jobs.registry'

export const JOBS_REGISTRY = 'JOBS_REGISTRY'
export const SCHEDULES_REGISTRY = 'SCHEDULES_REGISTRY'

type QueueName = JobName | ScheduleName

export const deadLetterQueue = (name: string): string => `${name}-dlq`

// Per queue, the oldest claimable job's wait over the wait its job allows;
// highest is the largest, 0 when there are no queues.
export const jobWaitPressure = (
  queues: Array<{
    name: string
    waitedSeconds: number
    alertAfterWaitingMinutes: number
  }>,
): { byQueue: Map<string, number>; highest: number } => {
  const byQueue = new Map(
    queues.map((queue) => [
      queue.name,
      queue.waitedSeconds / (queue.alertAfterWaitingMinutes * 60),
    ]),
  )
  return { byQueue, highest: Math.max(0, ...byQueue.values()) }
}

const IS_TEST = process.env.NODE_ENV === 'test'

// A worker that dies mid-job stops heartbeating, and pg-boss retries the
// job on another task within about two minutes (this plus the 60s monitor
// pass) instead of waiting out the timeout.
const HEARTBEAT_SECONDS = 60

// Every queue is key_strict_fifo: one job per group at a time, in send
// order, and a job waiting on a retry holds its group. A failed job also
// holds its group until it is deleted, so finished jobs are deleted after a
// minute and maintenance runs every minute: a group moves on 1-2 minutes
// after its job dead-letters. The record of what happened is the logs this
// service writes for every job, and the dead-letter copy (14 days).
const DELETE_FINISHED_AFTER_SECONDS = 60
const MAINTENANCE_INTERVAL_SECONDS = 60

const RETRY_DELAY_SECONDS = 30
const RETRY_DELAY_MAX_SECONDS = 10 * 60

// How long a running job gets to finish once this task starts shutting
// down. Then JobsService puts the job back in its queue without spending an
// attempt (requeueRunning). Short under test so a suite's teardown does not
// wait on a job its test left running.
const SHUTDOWN_GRACE_MS = IS_TEST ? 1_000 : 20_000

// pg-boss's own grace: longer than ours, so it is our requeue, not pg-boss's
// fail (which spends an attempt), that ends a job still running at
// shutdown. Under ECS's 30s stop timeout.
const BOSS_STOP_TIMEOUT_MS = SHUTDOWN_GRACE_MS + 5_000

// A requeued job keeps its attempt count, so a claim of it on another task
// carries the attempt number this task's stale settle is fenced to. The
// delay keeps it unclaimable until that settle, which follows at once, has
// found nothing to settle.
const REQUEUE_DELAY_SECONDS = IS_TEST ? 0 : 10

const STATS_INTERVAL_MS = 60_000

// sendMany() derives each job id from the job name and the item's key with
// this namespace, so the same key always maps to the same id.
const SEND_MANY_ID_NAMESPACE = '42bdefc4-b9f4-4820-817b-03f15259366a'
const SEND_MANY_CHUNK_SIZE = 1000

export type JobSendOptions = {
  // Jobs in one group run one at a time, in send order. Without one the job
  // is its own group, so it runs whenever a worker is free.
  group?: string
  // A Prisma interactive-transaction client. The job commits or rolls back
  // with the transaction.
  tx?: PrismaTransactionLike
}

export type JobSendManyItem<T> = {
  data: T
  // Names the item and the occurrence, e.g. `${campaignId}:${windowStart}`.
  // The job id is derived from it, so sending the same key again while the
  // job is still in the queue inserts nothing.
  key: string
  // As on send().
  group?: string
}

@Injectable()
export class JobsService
  implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy
{
  private readonly boss: PgBoss
  private statsTimer: NodeJS.Timeout | null = null
  private queueStats: QueueResult[] = []
  private waitPressure = new Map<string, number>()
  private readonly cloudwatch = new CloudWatchClient({ region: 'us-west-2' })
  // Aborted when this task starts shutting down; every job's signal follows
  // it, so a long job can stop at a safe point.
  private readonly shutdown = new AbortController()
  // The jobs this task is running, by id, with the attempt each holds.
  private readonly running = new Map<
    string,
    { id: string; name: QueueName; retryCount: number }
  >()
  // Aborted when the shutdown grace ends, after requeueRunning has put
  // the jobs still running back in their queue (requeuedAtGraceEnd).
  private readonly graceEnd = new AbortController()
  private requeuedAtGraceEnd = new Set<string>()

  constructor(
    @Inject(JOBS_REGISTRY) private readonly jobs: Jobs,
    @Inject(SCHEDULES_REGISTRY) private readonly schedules: Schedules,
    private readonly prisma: PrismaService,
    private readonly moduleRef: ModuleRef,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(JobsService.name)
    // Read at construction, not import: useTestService swaps DATABASE_URL
    // per suite before it boots the app.
    this.boss = new PgBoss({
      connectionString: requireEnv('DATABASE_URL'),
      max: IS_TEST ? 3 : process.env.IS_PREVIEW === 'true' ? 3 : 10,
      application_name: 'gp-api-jobs',
      // Prisma migrations own the pgboss schema (src/jobs/AGENTS.md). With
      // migrate off, start() throws if the installed schema is not the one
      // this pg-boss version expects.
      migrate: false,
      openTelemetry: { enabled: true, propagateContext: true },
      // Workers wake on NOTIFY when a job is sent instead of polling every
      // 2 seconds; polling drops to a 30-second fallback.
      useListenNotify: !IS_TEST,
      maintenanceIntervalSeconds: MAINTENANCE_INTERVAL_SECONDS,
      // Without it the monitor pass does not record readyOldestSeconds,
      // which the jobs-backed-up alert reads.
      persistQueueStats: !IS_TEST,
      supervise: !IS_TEST,
      schedule: !IS_TEST,
      registerInstance: !IS_TEST,
      __test__enableSpies: IS_TEST,
    })
    this.boss.on('error', (err) => this.logger.error({ err }, 'pg-boss error'))
    this.boss.on('warning', (warning) =>
      this.logger.warn({ warning }, 'pg-boss warning'),
    )
  }

  async onModuleInit(): Promise<void> {
    for (const name of Object.keys(this.schedules)) {
      if (name in this.jobs) {
        throw new Error(`${name} is both a job and a schedule`)
      }
    }
    await this.boss.start()
    for (const name of this.names()) {
      const definition = this.definitionOf(name)
      const options = {
        retryLimit: (definition.attempts ?? 3) - 1,
        // Under test a retry starts at once, so a test can drive a job
        // through every attempt to its dead letter in a few seconds.
        ...(IS_TEST
          ? { retryDelay: 0, retryBackoff: false }
          : {
              retryDelay: RETRY_DELAY_SECONDS,
              retryBackoff: true,
              retryDelayMax: RETRY_DELAY_MAX_SECONDS,
            }),
        expireInSeconds: (definition.timeoutMinutes ?? 15) * 60,
        heartbeatSeconds: HEARTBEAT_SECONDS,
        deleteAfterSeconds: DELETE_FINISHED_AFTER_SECONDS,
        notify: true,
        deadLetter: deadLetterQueue(name),
      }
      await this.boss.createQueue(options.deadLetter)
      await this.boss.createQueue(name, {
        ...options,
        policy: 'key_strict_fifo',
      })
      // createQueue leaves an existing queue alone, so this is what applies
      // a changed setting.
      await this.boss.updateQueue(name, options)
    }
    await this.syncSchedules()
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!IS_TEST || process.env.TEST_JOBS === 'on') {
      const context: WorkerContext = {
        get: (type) => this.moduleRef.get(type, { strict: false }),
      }
      for (const name of this.names()) await this.startWorker(name, context)
    }
    if (IS_TEST) return
    this.observeQueues()
    this.statsTimer = setInterval(() => {
      void this.refreshQueueStats()
    }, STATS_INTERVAL_MS)
  }

  async onModuleDestroy(): Promise<void> {
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.shutdown.abort()
    const graceTimer = setTimeout(() => {
      void this.requeueRunning()
    }, SHUTDOWN_GRACE_MS)
    try {
      await this.boss.stop({ graceful: true, timeout: BOSS_STOP_TIMEOUT_MS })
    } finally {
      clearTimeout(graceTimer)
    }
  }

  /**
   * Queue a job. Throws if the data does not match the job's schema or the
   * insert fails. Pass `tx` to insert inside a Prisma interactive
   * transaction; otherwise it goes through the app's Prisma client.
   * Resolves to the job id.
   */
  async send<N extends JobName>(
    name: N,
    data: JobData<N>,
    options: JobSendOptions = {},
  ): Promise<string> {
    const { schema, maxConcurrent } = this.definitionOf(name)
    const parsed = schema.parse(data)
    const id = randomUUID()
    const group = options.group ?? null
    await this.boss.send(name, parsed, {
      id,
      // key_strict_fifo needs a key on every job.
      singletonKey: group ?? id,
      // Not our group (singletonKey): pg-boss's groupConcurrency caps the
      // active jobs of one pg-boss group across every task, so every job of
      // a capped queue shares one, named by the queue.
      ...(maxConcurrent ? { group: { id: name } } : {}),
      db: fromPrisma(options.tx ?? this.prisma),
    })
    this.logger.info(
      {
        job: name,
        jobId: id,
        group,
        data: parsed,
        inTransaction: !!options.tx,
      },
      'job sent',
    )
    return id
  }

  /**
   * Queue one job per item, in chunks of 1,000. Every item is checked
   * against the job's schema before anything is inserted. Each job id comes
   * from the item's key, so a retried fan-out skips the jobs it already sent.
   * Without `tx` each chunk commits on its own; a retry fills in the rest.
   * Resolves to the job ids, in item order.
   */
  async sendMany<N extends JobName>(
    name: N,
    items: Array<JobSendManyItem<JobData<N>>>,
    options: { tx?: PrismaTransactionLike } = {},
  ): Promise<string[]> {
    const { schema, maxConcurrent } = this.definitionOf(name)
    const jobs = items.map((item) => {
      const id = uuidv5(`${name}:${item.key}`, SEND_MANY_ID_NAMESPACE)
      return {
        id,
        data: schema.parse(item.data),
        // key_strict_fifo needs a key on every job.
        singletonKey: item.group ?? id,
        // As in send().
        ...(maxConcurrent ? { group: { id: name } } : {}),
      }
    })
    if (new Set(jobs.map((job) => job.id)).size !== jobs.length) {
      throw new Error(`sendMany ${name}: two items share a key`)
    }
    const db = fromPrisma(options.tx ?? this.prisma)
    let chunks = 0
    for (let at = 0; at < jobs.length; at += SEND_MANY_CHUNK_SIZE) {
      // insert() ends in ON CONFLICT DO NOTHING, so an id already in the
      // queue is skipped rather than failing the chunk.
      await this.boss.insert(name, jobs.slice(at, at + SEND_MANY_CHUNK_SIZE), {
        db,
      })
      chunks++
    }
    this.logger.info(
      { job: name, count: jobs.length, chunks, inTransaction: !!options.tx },
      'jobs sent',
    )
    return jobs.map((job) => job.id)
  }

  /**
   * Per queue, how long its oldest claimable job has waited over its
   * alertAfterWaitingMinutes, 0 when nothing waits. Stores the values for
   * the jobs.wait_pressure gauge and resolves to the highest.
   */
  async refreshWaitPressure(): Promise<number> {
    // A key_strict_fifo job behind an active, retrying or failed job of its
    // group cannot be started by a new task, so only each group's head
    // counts, chosen as pg-boss's fetch picks it (strict_fifo_heads, on
    // job_i10). Waiting starts at GREATEST(created_on, start_after), as in
    // pg-boss's readyOldestSeconds. A job of a queue at its maxConcurrent
    // cannot start either, however many tasks run, so it does not count:
    // pg-boss's groupConcurrency check, on the queue-wide group send() gives
    // a capped queue's jobs.
    const capped = this.names().flatMap((name) => {
      const { maxConcurrent } = this.definitionOf(name)
      return maxConcurrent ? [{ name, maxConcurrent }] : []
    })
    const rows = await this.prisma.$queryRaw<
      Array<{ name: string; waited_seconds: number }>
    >`SELECT h.name,
        extract(epoch FROM now() - min(h.ready_on))::float8
          AS waited_seconds
      FROM (
        SELECT DISTINCT ON (j.name, j.singleton_key)
          j.id, j.name, j.singleton_key, j.group_id,
          GREATEST(j.created_on, j.start_after) AS ready_on
        FROM pgboss.job j
        WHERE j.name = ANY(${this.names()})
          AND j.state < 'active'
          AND NOT j.blocked
          AND j.policy = 'key_strict_fifo'
          AND j.start_after <= now()
        ORDER BY j.name, j.singleton_key, j.state DESC, j.created_on, j.id
      ) h
      WHERE NOT EXISTS (
        SELECT 1 FROM pgboss.job b
        WHERE b.name = h.name
          AND b.singleton_key = h.singleton_key
          AND b.state IN ('active', 'retry', 'failed')
          AND b.policy = 'key_strict_fifo'
          AND b.id <> h.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(
          ${capped.map((queue) => queue.name)}::text[],
          ${capped.map((queue) => queue.maxConcurrent)}::int[]
        ) AS c(name, max_concurrent)
        WHERE c.name = h.name
          AND h.group_id = h.name
          AND (
            SELECT count(*) FROM pgboss.job a
            WHERE a.name = h.name
              AND a.group_id = h.name
              AND a.state = 'active'
          ) >= c.max_concurrent
      )
      GROUP BY h.name`
    const waited = new Map(rows.map((row) => [row.name, row.waited_seconds]))
    const { byQueue, highest } = jobWaitPressure(
      this.names().map((name) => ({
        name,
        waitedSeconds: waited.get(name) ?? 0,
        alertAfterWaitingMinutes:
          this.definitionOf(name).alertAfterWaitingMinutes,
      })),
    )
    this.waitPressure = byQueue
    return highest
  }

  /**
   * Test only: wait on a queue's jobs. Requires NODE_ENV=test. Prefer
   * `service.jobs.settle()` from useTestService (src/jobs/AGENTS.md § Tests).
   */
  getSpy<N extends JobName>(name: N): JobSpyInterface<JobData<N>> {
    return this.boss.getSpy<JobData<N>>(name)
  }

  /**
   * Test only: queue one run of a schedule, as pg-boss's cron does when it
   * comes due. Throws outside NODE_ENV=test. Tests call it through
   * `service.jobs.runSchedule()` from useTestService.
   */
  async sendScheduleRunForTest(name: ScheduleName): Promise<void> {
    if (!IS_TEST) throw new Error('sendScheduleRunForTest is test only')
    // The singletonKey syncSchedules gives every run: the schedule's group.
    await this.boss.send(name, {}, { singletonKey: name })
  }

  // Makes the pgboss.schedule table match SCHEDULES. Every task does this at
  // boot; schedule() is an upsert, so they agree.
  private async syncSchedules(): Promise<void> {
    for (const name of this.scheduleNames()) {
      const { cron } = this.schedules[name]
      await this.boss.schedule(
        name,
        cron,
        {},
        {
          // No tz: every schedule is read in UTC.
          // An occurrence that came due while no task ran a cron pass (an
          // outage) is not run late: a late run of time-sensitive work can be
          // worse than none, and the next occurrence does the work.
          missed: 'skip',
          // pg-boss's own once-per-occurrence dedupe across tasks happens
          // before this: each pass files the occurrence on its internal
          // send-it queue under its own singleton key and minute slot, and a
          // second pass's copy conflicts and is dropped. Only the job forwarded
          // from there carries these options, so this key is free to be the
          // group key_strict_fifo needs: every run shares one group.
          singletonKey: name,
        },
      )
      this.logger.info({ schedule: name, cron }, 'schedule registered')
    }
    for (const { name, key } of await this.boss.getSchedules()) {
      if (key === '' && this.isScheduleName(name)) continue
      await this.boss.unschedule(name, key)
      this.logger.info({ schedule: name, key }, 'schedule removed')
    }
  }

  private scheduleNames(): ScheduleName[] {
    return Object.keys(this.schedules).filter((name) =>
      this.isScheduleName(name),
    )
  }

  private isScheduleName(name: string): name is ScheduleName {
    return name in this.schedules
  }

  private isJobName(name: string): name is JobName {
    return name in this.jobs
  }

  // Every queue: one per job and one per schedule.
  private names(): QueueName[] {
    return [
      ...Object.keys(this.jobs).filter((name) => this.isJobName(name)),
      ...this.scheduleNames(),
    ]
  }

  // Code that serves every queue reads definitions as the base type, so it
  // does not depend on which jobs the registry holds. A schedule reads as a
  // job with an empty payload.
  private definitionOf(name: QueueName): JobDefinition<object> {
    if (this.isJobName(name)) return this.jobs[name]
    const schedule = this.schedules[name]
    return {
      schema: z.object({}),
      worker: (job, context) => schedule.worker({ ...job, data: {} }, context),
      alertAfterWaitingMinutes: schedule.alertAfterWaitingMinutes,
      timeoutMinutes: schedule.timeoutMinutes,
      attempts: schedule.attempts,
    }
  }

  // One log line per step, so a job's history can be rebuilt from the logs
  // after pg-boss deletes it. An attempt lost to a crash, a stale heartbeat
  // or the timeout never reaches the catch below; it shows as a "job
  // started" with no outcome, followed by the next attempt's "job started".
  private async startWorker(
    name: QueueName,
    context: WorkerContext,
  ): Promise<void> {
    const definition = this.definitionOf(name)
    await this.boss.work<object, void, WorkOptions & { includeMetadata: true }>(
      name,
      {
        localConcurrency: definition.concurrency ?? 1,
        ...(definition.maxConcurrent
          ? { groupConcurrency: definition.maxConcurrent }
          : {}),
        includeMetadata: true,
        ...(IS_TEST ? { pollingIntervalSeconds: 0.5 } : {}),
      },
      async (jobs) => {
        for (const job of jobs) {
          const log = {
            job: name,
            jobId: job.id,
            group: job.singletonKey === job.id ? null : job.singletonKey,
            attempt: job.retryCount + 1,
            attempts: job.retryLimit + 1,
          }
          const startedAt = Date.now()
          this.logger.info(
            {
              ...log,
              waitedSeconds: Math.round(
                (startedAt - job.createdOn.getTime()) / 1000,
              ),
            },
            'job started',
          )
          const held = { id: job.id, name, retryCount: job.retryCount }
          this.running.set(job.id, held)
          const finished = new AbortController()
          const graceEnded = new Promise<'grace ended'>((resolve) => {
            if (this.graceEnd.signal.aborted) resolve('grace ended')
            this.graceEnd.signal.addEventListener(
              'abort',
              () => resolve('grace ended'),
              { once: true, signal: finished.signal },
            )
          })
          try {
            const working = definition.worker(
              {
                id: job.id,
                data: definition.schema.parse(job.data),
                retryCount: job.retryCount,
                retryLimit: job.retryLimit,
                signal: AbortSignal.any([job.signal, this.shutdown.signal]),
              },
              context,
            )
            // A handler still running when the grace ends is left to run,
            // as pg-boss leaves one past its timeout, and its outcome no
            // longer settles anything.
            working.catch(() => undefined)
            const outcome = await Promise.race([
              working.then(() => 'returned' as const),
              graceEnded,
            ])
            if (outcome === 'grace ended') {
              if (!this.requeuedAtGraceEnd.has(job.id)) {
                throw new Error('job still running when this task shut down')
              }
              this.logger.info(
                { ...log, durationMs: Date.now() - startedAt },
                'job requeued at shutdown',
              )
              continue
            }
          } catch (err) {
            const durationMs = Date.now() - startedAt
            // A job that stops because this task is shutting down, as its
            // signal asks, goes back without spending an attempt. So does
            // any other error thrown during shutdown.
            if (this.shutdown.signal.aborted) {
              let requeued = false
              try {
                requeued = (await this.requeue([held])).has(job.id)
              } catch (requeueErr) {
                this.logger.error(
                  { ...log, err: requeueErr },
                  'job requeue at shutdown failed',
                )
              }
              if (requeued) {
                this.logger.info(
                  { ...log, err, durationMs },
                  'job requeued at shutdown',
                )
                continue
              }
            }
            if (job.retryCount >= job.retryLimit) {
              this.logger.error(
                { ...log, err, durationMs, data: job.data },
                'job dead-lettered',
              )
            } else {
              this.logger.warn(
                { ...log, err, durationMs },
                'job attempt failed; will retry',
              )
            }
            throw err
          } finally {
            this.running.delete(job.id)
            finished.abort()
          }
          this.logger.info(
            { ...log, durationMs: Date.now() - startedAt },
            'job completed',
          )
        }
      },
    )
  }

  // At the end of the shutdown grace: every job still running goes back to
  // its queue in one statement, and their handlers return.
  private async requeueRunning(): Promise<void> {
    try {
      this.requeuedAtGraceEnd = await this.requeue([...this.running.values()])
    } catch (err) {
      this.logger.error({ err }, 'job requeue at shutdown failed')
    }
    this.graceEnd.abort()
  }

  // Puts jobs this task holds back in their queue at the attempt they are
  // on. pg-boss adds an attempt on a claim only when started_on is set, so
  // clearing it makes the next claim the same attempt, as pg-boss's own
  // restore() does. State retry rather than created, so a job keeps its
  // group's place (key_strict_fifo) through REQUEUE_DELAY_SECONDS. Fenced,
  // as pg-boss's settles are, to the attempt this task holds. Through
  // pg-boss's pool, which stays open until its stop() returns. Resolves to
  // the ids it requeued.
  private async requeue(
    jobs: Array<{ id: string; name: QueueName; retryCount: number }>,
  ): Promise<Set<string>> {
    if (jobs.length === 0) return new Set()
    const { rows } = await this.boss.getDb().executeSql(
      `UPDATE pgboss.job
      SET state = 'retry',
        started_on = NULL,
        heartbeat_on = NULL,
        start_after = now() + make_interval(secs => $3)
      WHERE name = ANY($1::text[])
        AND state = 'active'
        AND (id::text || ':' || retry_count::text) = ANY($2::text[])
      RETURNING id::text AS id`,
      [
        jobs.map((job) => job.name),
        jobs.map((job) => `${job.id}:${job.retryCount}`),
        REQUEUE_DELAY_SECONDS,
      ],
    )
    return new Set(
      z
        .array(z.object({ id: z.string() }))
        .parse(rows)
        .map((row) => row.id),
    )
  }

  private observeQueues(): void {
    const meter = metrics.getMeter('gp-api')
    // Every task reports the same numbers; alerts take the max per queue.
    meter
      .createObservableGauge('jobs.ready_oldest_seconds', {
        description: 'How long the oldest ready job in a queue has waited',
      })
      .addCallback((result) => {
        for (const queue of this.queueStats) {
          result.observe(queue.readyOldestSeconds ?? 0, { queue: queue.name })
        }
      })
    meter
      .createObservableGauge('jobs.max_wait_seconds', {
        description:
          "A queue's alertAfterWaitingMinutes from the registry, in seconds",
      })
      .addCallback((result) => {
        for (const name of this.names()) {
          result.observe(
            this.definitionOf(name).alertAfterWaitingMinutes * 60,
            {
              queue: name,
            },
          )
        }
      })
    meter
      .createObservableGauge('jobs.wait_pressure', {
        description:
          'How long the oldest claimable job has waited, over its ' +
          'alertAfterWaitingMinutes',
      })
      .addCallback((result) => {
        for (const [queue, pressure] of this.waitPressure) {
          result.observe(pressure, { queue })
        }
      })
  }

  private async refreshQueueStats(): Promise<void> {
    try {
      this.queueStats = await this.boss.getQueues(this.names())
    } catch (err) {
      this.logger.error({ err }, 'job queue stats read failed')
      return
    }
    if (
      OTEL_SERVICE_ENVIRONMENT !== 'dev' &&
      OTEL_SERVICE_ENVIRONMENT !== 'prod'
    ) {
      return
    }
    let pressure: number
    try {
      pressure = await this.refreshWaitPressure()
    } catch (err) {
      this.logger.error({ err }, 'job wait pressure read failed')
      return
    }
    // Dev and prod autoscaling can only read CloudWatch (deploy/components/
    // service.ts). Each task publishes the same number; the alarm reads
    // Maximum.
    try {
      await this.cloudwatch.send(
        new PutMetricDataCommand({
          Namespace: 'GpApi/Jobs',
          MetricData: [
            {
              MetricName: 'JobWaitPressure',
              Dimensions: [
                { Name: 'Environment', Value: OTEL_SERVICE_ENVIRONMENT },
              ],
              Unit: StandardUnit.None,
              Value: pressure,
            },
          ],
        }),
      )
    } catch (err) {
      this.logger.error({ err }, 'job queue metric publish failed')
    }
  }
}
