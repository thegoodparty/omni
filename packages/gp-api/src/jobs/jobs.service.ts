import {
  CloudWatchClient,
  PutMetricDataCommand,
  StandardUnit,
} from '@aws-sdk/client-cloudwatch'
import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import {
  fromPrisma,
  PgBoss,
  type JobSpyInterface,
  type PrismaTransactionLike,
  type SendOptions,
  type WorkOptions,
} from 'pg-boss'
import { PrismaService } from '@/prisma/prisma.service'
import { requireEnv } from '@/shared/util/env.util'
import { OTEL_SERVICE_ENVIRONMENT } from '@/shared/util/appEnvironment.util'
import {
  deadLetterQueue,
  JOB_NAMES,
  JOBS,
  type JobData,
  type JobDefinition,
  type JobName,
  type JobRun,
} from './jobs.registry'

const IS_TEST = process.env.NODE_ENV === 'test'

// Published from every dev and prod task for prod autoscaling, which can
// only read CloudWatch (deploy/components/service.ts). Each task publishes
// the same number, so the policy reads Maximum. Everything else about the
// queues, the dead-letter alert included, reads pg-boss's own OpenTelemetry
// metrics in Grafana.
const METRIC_NAMESPACE = 'GpApi/Jobs'
const METRIC_INTERVAL_MS = 60_000

// Under ECS's 30s stop timeout. A handler still running when it passes is
// aborted and its job retried on another task.
const STOP_TIMEOUT_MS = 20_000

// A worker that dies mid-job stops heartbeating, and pg-boss retries the
// job on another task within about two minutes (this plus the 60s monitor
// pass) instead of waiting out expireInSeconds. One value for every queue.
const HEARTBEAT_SECONDS = 60

// Reads a definition as the base type, so code that serves every job does
// not depend on which jobs JOBS holds.
const definitionOf = (name: JobName): JobDefinition => JOBS[name]

export type JobSendOptions = Omit<SendOptions, 'db'> & {
  // A Prisma interactive-transaction client. The job commits or rolls back
  // with the transaction.
  tx?: PrismaTransactionLike
}

@Injectable()
export class JobsService
  implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy
{
  private readonly boss: PgBoss
  private metricTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly prisma: PrismaService,
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
    for (const name of JOB_NAMES) {
      const options = {
        ...definitionOf(name).queue,
        heartbeatSeconds: HEARTBEAT_SECONDS,
        deadLetter: deadLetterQueue(name),
      }
      await this.boss.createQueue(options.deadLetter)
      await this.boss.createQueue(name, options)
      // createQueue leaves an existing queue alone, so this is what applies
      // a changed setting.
      await this.boss.updateQueue(name, options)
    }
  }

  onApplicationBootstrap(): void {
    if (
      OTEL_SERVICE_ENVIRONMENT === 'dev' ||
      OTEL_SERVICE_ENVIRONMENT === 'prod'
    ) {
      const cloudwatch = new CloudWatchClient({ region: 'us-west-2' })
      this.metricTimer = setInterval(() => {
        void this.publishQueueMetrics(cloudwatch)
      }, METRIC_INTERVAL_MS)
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.metricTimer) clearInterval(this.metricTimer)
    await this.boss.stop({ graceful: true, timeout: STOP_TIMEOUT_MS })
  }

  /**
   * Queue a job. Throws if the data does not match the job's schema or the
   * insert fails. Pass `tx` to insert inside a Prisma interactive
   * transaction; otherwise it goes through the app's Prisma client. Resolves
   * to the job id, or null when a singletonKey dropped it as a duplicate.
   */
  async send<N extends JobName>(
    name: N,
    data: JobData<N>,
    options: JobSendOptions = {},
  ): Promise<string | null> {
    const { tx, ...sendOptions } = options
    const parsed = definitionOf(name).schema.parse(data)
    return this.boss.send(name, parsed, {
      ...sendOptions,
      db: fromPrisma(tx ?? this.prisma),
    })
  }

  /** Starts this task's worker for a job. Only JobWorkersService calls it. */
  async work<N extends JobName>(
    name: N,
    worker: (job: JobRun<N>) => Promise<void>,
  ): Promise<void> {
    const definition = definitionOf(name)
    await this.boss.work<
      JobData<N>,
      void,
      WorkOptions & { includeMetadata: true }
    >(
      name,
      {
        ...definition.work,
        includeMetadata: true,
        ...(IS_TEST ? { pollingIntervalSeconds: 0.5 } : {}),
      },
      async (jobs) => {
        for (const job of jobs) {
          try {
            // send() stored the schema's output, so this only checks it:
            // a payload an older release sent fails here, not in a worker.
            definition.schema.parse(job.data)
            await worker({
              id: job.id,
              data: job.data,
              retryCount: job.retryCount,
              retryLimit: job.retryLimit,
              signal: job.signal,
            })
          } catch (err) {
            this.logger.error(
              {
                err,
                job: name,
                jobId: job.id,
                retryCount: job.retryCount,
                retryLimit: job.retryLimit,
              },
              'job failed',
            )
            throw err
          }
        }
      },
    )
  }

  /** Test only: wait on a queue's jobs. Requires NODE_ENV=test. */
  getSpy<N extends JobName>(name: N): JobSpyInterface<JobData<N>> {
    return this.boss.getSpy<JobData<N>>(name)
  }

  private async publishQueueMetrics(
    cloudwatch: CloudWatchClient,
  ): Promise<void> {
    try {
      const queues = await this.boss.getQueues(JOB_NAMES)
      const queued = queues.reduce((sum, queue) => sum + queue.readyCount, 0)
      await cloudwatch.send(
        new PutMetricDataCommand({
          Namespace: METRIC_NAMESPACE,
          MetricData: [
            {
              MetricName: 'QueuedJobs',
              Dimensions: [
                { Name: 'Environment', Value: OTEL_SERVICE_ENVIRONMENT },
              ],
              Unit: StandardUnit.Count,
              Value: queued,
            },
          ],
        }),
      )
    } catch (err) {
      this.logger.error({ err }, 'job queue metrics publish failed')
    }
  }
}
