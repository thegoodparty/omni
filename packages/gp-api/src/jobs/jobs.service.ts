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
  WorkerContext,
} from './jobs.registry'

export const JOBS_REGISTRY = 'JOBS_REGISTRY'

export const deadLetterQueue = (name: string): string => `${name}-dlq`

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

// Under ECS's 30s stop timeout. A handler still running when it passes is
// aborted and its job retried on another task.
const STOP_TIMEOUT_MS = 20_000

const STATS_INTERVAL_MS = 60_000

export type JobSendOptions = {
  // Jobs in one group run one at a time, in send order. Without one the job
  // is its own group, so it runs whenever a worker is free.
  group?: string
  // A Prisma interactive-transaction client. The job commits or rolls back
  // with the transaction.
  tx?: PrismaTransactionLike
}

@Injectable()
export class JobsService
  implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy
{
  private readonly boss: PgBoss
  private statsTimer: NodeJS.Timeout | null = null
  private queueStats: QueueResult[] = []
  private readonly cloudwatch = new CloudWatchClient({ region: 'us-west-2' })

  constructor(
    @Inject(JOBS_REGISTRY) private readonly jobs: Jobs,
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
    await this.boss.start()
    for (const name of this.names()) {
      const definition = this.definitionOf(name)
      const options = {
        retryLimit: (definition.attempts ?? 3) - 1,
        retryDelay: RETRY_DELAY_SECONDS,
        retryBackoff: true,
        retryDelayMax: RETRY_DELAY_MAX_SECONDS,
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
    await this.boss.stop({ graceful: true, timeout: STOP_TIMEOUT_MS })
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
    const parsed = this.definitionOf(name).schema.parse(data)
    const id = randomUUID()
    const group = options.group ?? null
    await this.boss.send(name, parsed, {
      id,
      // key_strict_fifo needs a key on every job.
      singletonKey: group ?? id,
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

  /** Test only: wait on a queue's jobs. Requires NODE_ENV=test. */
  getSpy<N extends JobName>(name: N): JobSpyInterface<JobData<N>> {
    return this.boss.getSpy<JobData<N>>(name)
  }

  private names(): JobName[] {
    return Object.keys(this.jobs).filter(
      (name): name is JobName => name in this.jobs,
    )
  }

  // Code that serves every job reads definitions as the base type, so it does
  // not depend on which jobs the registry holds.
  private definitionOf(name: JobName): JobDefinition<object> {
    return this.jobs[name]
  }

  // One log line per step, so a job's history can be rebuilt from the logs
  // after pg-boss deletes it. An attempt lost to a crash, a stale heartbeat
  // or the timeout never reaches the catch below; it shows as a "job
  // started" with no outcome, followed by the next attempt's "job started".
  private async startWorker(
    name: JobName,
    context: WorkerContext,
  ): Promise<void> {
    const definition = this.definitionOf(name)
    await this.boss.work<object, void, WorkOptions & { includeMetadata: true }>(
      name,
      {
        localConcurrency: definition.concurrency ?? 1,
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
          try {
            await definition.worker(
              {
                id: job.id,
                data: definition.schema.parse(job.data),
                retryCount: job.retryCount,
                retryLimit: job.retryLimit,
                signal: job.signal,
              },
              context,
            )
          } catch (err) {
            const durationMs = Date.now() - startedAt
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
          }
          this.logger.info(
            { ...log, durationMs: Date.now() - startedAt },
            'job completed',
          )
        }
      },
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
  }

  private async refreshQueueStats(): Promise<void> {
    try {
      this.queueStats = await this.boss.getQueues(this.names())
    } catch (err) {
      this.logger.error({ err }, 'job queue stats read failed')
      return
    }
    // Prod autoscaling can only read CloudWatch (deploy/components/
    // service.ts), so the backlog it scales on goes there too. Each task
    // publishes the same number; the policy reads Maximum.
    if (
      OTEL_SERVICE_ENVIRONMENT !== 'dev' &&
      OTEL_SERVICE_ENVIRONMENT !== 'prod'
    ) {
      return
    }
    try {
      await this.cloudwatch.send(
        new PutMetricDataCommand({
          Namespace: 'GpApi/Jobs',
          MetricData: [
            {
              MetricName: 'QueuedJobs',
              Dimensions: [
                { Name: 'Environment', Value: OTEL_SERVICE_ENVIRONMENT },
              ],
              Unit: StandardUnit.Count,
              Value: this.queueStats.reduce(
                (sum, queue) => sum + queue.readyCount,
                0,
              ),
            },
          ],
        }),
      )
    } catch (err) {
      this.logger.error({ err }, 'job queue metric publish failed')
    }
  }
}
