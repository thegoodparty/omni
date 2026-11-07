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
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core'
import { PinoLogger } from 'nestjs-pino'
import {
  fromPrisma,
  PgBoss,
  type JobSpyInterface,
  type JobWithMetadata,
  type PrismaTransactionLike,
  type SendOptions,
} from 'pg-boss'
import { requireEnv } from '@/shared/util/env.util'
import { OTEL_SERVICE_ENVIRONMENT } from '@/shared/util/appEnvironment.util'
import { JobHandlerMetadata } from './jobHandler.decorator'
import {
  deadLetterQueue,
  JOB_NAMES,
  JOBS,
  type JobData,
  type JobName,
  type JobDefinition,
} from './jobs.registry'

const IS_TEST = process.env.NODE_ENV === 'test'

// Published from every dev and prod task; each publishes the same numbers,
// so CloudWatch reads them with Maximum. Prod autoscaling tracks QueuedJobs
// per task and the jobs-dead-letter alert reads DeadLetterJobs (deploy/).
const METRIC_NAMESPACE = 'GpApi/Jobs'
const METRIC_INTERVAL_MS = 60_000

// Under ECS's 30s stop timeout. A handler still running when it passes is
// aborted and its job retried on another task.
const STOP_TIMEOUT_MS = 20_000

// Internals work on any job, so they read definitions through JobDefinition
// rather than the per-job types send() and @JobHandler expose.
type JobHandlerFn = (
  job: Pick<
    JobWithMetadata<object>,
    'id' | 'data' | 'retryCount' | 'retryLimit' | 'signal'
  >,
) => Promise<void>
const definitionOf = (name: JobName): JobDefinition => JOBS[name]

// Providers are untyped to DiscoveryService. @JobHandler's descriptor type
// is what guarantees the signature of a method carrying its metadata.
const isHandler = (method: unknown): method is JobHandlerFn =>
  typeof method === 'function'

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
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
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
      const { queue, heartbeatSeconds } = definitionOf(name)
      const deadLetter = deadLetterQueue(name)
      await this.boss.createQueue(deadLetter)
      await this.boss.createQueue(name, {
        ...queue,
        heartbeatSeconds,
        deadLetter,
      })
      // createQueue leaves an existing queue alone, so this is what applies
      // a changed retry or expiry setting.
      await this.boss.updateQueue(name, { ...queue, deadLetter })
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    const handlers = this.discoverHandlers()
    if (!IS_TEST || process.env.TEST_JOBS === 'on') {
      for (const [name, handler] of handlers) {
        await this.startWorker(name, handler)
      }
    }
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
   * transaction. Resolves to the job id, or null when a singletonKey
   * dropped it as a duplicate.
   */
  async send<N extends JobName>(
    name: N,
    data: JobData<N>,
    options: JobSendOptions = {},
  ): Promise<string | null> {
    const { tx, ...sendOptions } = options
    const parsed = definitionOf(name).data.parse(data)
    return this.boss.send(name, parsed, {
      ...sendOptions,
      ...(tx ? { db: fromPrisma(tx) } : {}),
    })
  }

  /** Test only: wait on a queue's jobs. Requires NODE_ENV=test. */
  getSpy<N extends JobName>(name: N): JobSpyInterface<JobData<N>> {
    return this.boss.getSpy<JobData<N>>(name)
  }

  private discoverHandlers(): Map<JobName, JobHandlerFn> {
    const handlers = new Map<JobName, JobHandlerFn>()
    for (const wrapper of this.discovery.getProviders()) {
      const instance: unknown = wrapper.instance
      if (typeof instance !== 'object' || instance === null) continue
      const prototype = Reflect.getPrototypeOf(instance)
      if (!prototype) continue
      for (const key of this.scanner.getAllMethodNames(prototype)) {
        const method: unknown = Reflect.get(instance, key)
        if (!isHandler(method)) continue
        const name = this.reflector.get(JobHandlerMetadata, method)
        if (!name) continue
        if (handlers.has(name)) {
          throw new Error(`Job ${name} has more than one @JobHandler`)
        }
        // bind() is typed any without strictBindCallApply, which gp-api
        // leaves off; isHandler already narrowed method.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const handler: JobHandlerFn = method.bind(instance)
        handlers.set(name, handler)
      }
    }
    const missing = JOB_NAMES.filter((name) => !handlers.has(name))
    if (missing.length > 0) {
      throw new Error(`Jobs with no @JobHandler: ${missing.join(', ')}`)
    }
    return handlers
  }

  private async startWorker(
    name: JobName,
    handler: JobHandlerFn,
  ): Promise<void> {
    const definition = definitionOf(name)
    await this.boss.work(
      name,
      {
        ...definition.work,
        includeMetadata: true,
        ...(IS_TEST ? { pollingIntervalSeconds: 0.5 } : {}),
      },
      async (jobs) => {
        for (const job of jobs) {
          try {
            await handler({ ...job, data: definition.data.parse(job.data) })
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

  private async publishQueueMetrics(
    cloudwatch: CloudWatchClient,
  ): Promise<void> {
    try {
      const deadLetters = new Set<string>(JOB_NAMES.map(deadLetterQueue))
      const queues = await this.boss.getQueues([...JOB_NAMES, ...deadLetters])
      const queued = queues
        .filter((queue) => !deadLetters.has(queue.name))
        .reduce((sum, queue) => sum + queue.readyCount, 0)
      const deadLettered = queues
        .filter((queue) => deadLetters.has(queue.name))
        .reduce((sum, queue) => sum + queue.queuedCount, 0)
      const dimensions = [
        { Name: 'Environment', Value: OTEL_SERVICE_ENVIRONMENT },
      ]
      await cloudwatch.send(
        new PutMetricDataCommand({
          Namespace: METRIC_NAMESPACE,
          MetricData: [
            {
              MetricName: 'QueuedJobs',
              Dimensions: dimensions,
              Unit: StandardUnit.Count,
              Value: queued,
            },
            {
              MetricName: 'DeadLetterJobs',
              Dimensions: dimensions,
              Unit: StandardUnit.Count,
              Value: deadLettered,
            },
          ],
        }),
      )
    } catch (err) {
      this.logger.error({ err }, 'job queue metrics publish failed')
    }
  }
}
