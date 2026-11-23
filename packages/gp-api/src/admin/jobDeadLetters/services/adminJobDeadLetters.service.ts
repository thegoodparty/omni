import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { PgBoss } from 'pg-boss'
import {
  DeleteJobDeadLetterResult,
  DeleteJobDeadLettersResult,
  JobDeadLetter,
  JobDeadLetterBatchFailure,
  JobDeadLettersListQuery,
  JOB_DEAD_LETTERS_MAX_LIMIT,
  PaginatedList,
  RedriveJobDeadLetterResult,
  RedriveJobDeadLettersResult,
} from '@goodparty_org/contracts'
import { Prisma } from '@/generated/prisma'
import { PrismaService } from '@/prisma/prisma.service'
import { requireEnv } from '@/shared/util/env.util'
import { isJsonObject } from '@/shared/util/objects.util'
import { DEFAULT_PAGINATION_OFFSET } from '@/shared/constants/paginationOptions.consts'
import { deadLetterQueue } from '@/jobs/jobs.service'

type DeadLetterRow = {
  id: string
  name: string
  created_on: Date
  source_name: string | null
  source_retry_count: number | null
  data: JobDeadLetter['data']
  source_output: Prisma.JsonValue
}

// pg-boss keeps a failed attempt's error as serialize-error's object, nested
// under `value` when the job failed through its fail(failJobs) path and at
// the top level when it failed its own attempt out.
const errorOf = (output: Prisma.JsonValue): string | null => {
  if (!isJsonObject(output)) return null
  const nested = output['value']
  const message = isJsonObject(nested) ? nested['message'] : output['message']
  return typeof message === 'string' ? message : null
}

// A batch reports what stopped one entry rather than failing all of them, so
// it carries the same message the single-entry route would have answered
// with. Anything that is not one of our own refusals is a real fault and
// belongs to the whole request, not to the entry.
const batchFailureMessage = (error: unknown, id: string): string => {
  if (!(error instanceof HttpException)) throw error
  const response = error.getResponse()
  const message =
    typeof response === 'string'
      ? response
      : isJsonObject(response) && typeof response['message'] === 'string'
        ? response['message']
        : null
  return message ?? `Dead letter ${id} could not be handled`
}

const toDeadLetter = (row: Omit<DeadLetterRow, 'name'>): JobDeadLetter => ({
  id: row.id,
  sourceQueue: row.source_name,
  createdAt: row.created_on,
  retriesUsed: row.source_retry_count,
  data: row.data,
  error: errorOf(row.source_output),
})

@Injectable()
export class AdminJobDeadLettersService implements OnModuleDestroy {
  // Its own pg-boss instance rather than the app's JobsService: reading or
  // redriving a dead letter must not touch this task's workers, and
  // scripts/jobs-dead-letter.ts reads the same queues the same way. Opened on
  // first use, so a process that never opens a dead letter holds no extra
  // pool.
  private boss: Promise<PgBoss> | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdminJobDeadLettersService.name)
  }

  async onModuleDestroy(): Promise<void> {
    const boss = await this.boss?.catch(() => null)
    if (boss) await boss.stop({ graceful: false })
  }

  // Remembers the starting instance, not the started one, so two requests
  // arriving together open one pool between them. A start that failed is
  // forgotten, so the next request tries again rather than replaying it.
  private async reader(): Promise<PgBoss> {
    if (!this.boss) {
      const boss = new PgBoss({
        connectionString: requireEnv('DATABASE_URL'),
        max: 2,
        migrate: false,
        supervise: false,
        schedule: false,
        registerInstance: false,
      })
      // PgBoss is an EventEmitter and forwards pool errors as 'error', which
      // is uncaught with no listener and would take the whole API task down.
      boss.on('error', (err) =>
        this.logger.error({ err }, 'dead letter pg-boss error'),
      )
      this.boss = boss.start()
      void this.boss.catch(() => {
        this.boss = null
      })
    }
    return this.boss
  }

  // Every `<job queue>-dlq` has no worker (src/jobs/AGENTS.md § Dead
  // letters), so every row in one is a dead letter. `source_name` is the
  // queue the job failed on, recorded by pg-boss as it moved the job; it is
  // what a redrive routes back to.
  async list({
    sourceQueue,
    offset = DEFAULT_PAGINATION_OFFSET,
    limit = JOB_DEAD_LETTERS_MAX_LIMIT,
  }: JobDeadLettersListQuery): Promise<PaginatedList<JobDeadLetter>> {
    const where = sourceQueue
      ? Prisma.sql`name = ${deadLetterQueue(sourceQueue)}`
      : Prisma.sql`name LIKE ${'%-dlq'}`
    const [rows, count] = await Promise.all([
      this.prisma.$queryRaw<
        Array<Omit<DeadLetterRow, 'name'>>
      >`SELECT id::text AS id, created_on, source_name, source_retry_count,
          data, source_output
        FROM pgboss.job WHERE ${where}
        ORDER BY created_on DESC, id
        LIMIT ${limit} OFFSET ${offset}`,
      this.prisma.$queryRaw<Array<{ total: number }>>`
        SELECT count(*)::int AS total FROM pgboss.job WHERE ${where}`,
    ])
    return {
      data: rows.map(toDeadLetter),
      meta: { total: count[0]?.total ?? 0, offset, limit },
    }
  }

  async queues(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ source_name: string }>>`
      SELECT DISTINCT source_name FROM pgboss.job
      WHERE name LIKE ${'%-dlq'} AND source_name IS NOT NULL
      ORDER BY source_name`
    return rows.map((row) => row.source_name)
  }

  async get(id: string): Promise<JobDeadLetter> {
    const row = await this.findDeadLetter(id)
    if (!row) throw new NotFoundException(`No dead letter ${id}`)
    return toDeadLetter(row)
  }

  /**
   * Put one dead letter back on the queue it failed on as a fresh job with
   * its attempts reset. pg-boss moves it in a single statement selecting the
   * dead letter by id and source queue, so two redrives of the same dead
   * letter cannot both move it: the second finds nothing to move.
   */
  async redrive(id: string): Promise<RedriveJobDeadLetterResult> {
    const deadLetter = await this.findDeadLetter(id)
    if (!deadLetter) throw new NotFoundException(`No dead letter ${id}`)
    if (!deadLetter.source_name) {
      throw new NotFoundException(
        `Dead letter ${id} records no source queue, so it cannot be redriven`,
      )
    }
    const sourceQueue = deadLetter.source_name
    const boss = await this.reader()
    if (!(await boss.getQueue(sourceQueue))) {
      throw new ConflictException(
        `Source queue ${sourceQueue} no longer exists, so this dead letter ` +
          'has nowhere to go',
      )
    }
    const moved = await boss.redrive(deadLetter.name, {
      ids: [id],
      sourceName: sourceQueue,
    })
    if (moved !== 1) {
      // pg-boss skips a dead letter from a key_strict_fifo queue while another
      // active, retrying or failed job there holds its singleton key, and
      // leaves it in the dead letter queue.
      if (await this.findDeadLetter(id)) {
        throw new ConflictException(
          `Dead letter ${id} was not requeued: another redrive holds it, or ` +
            `${sourceQueue} still holds a job under its key`,
        )
      }
      throw new ConflictException(`Dead letter ${id} was already redriven`)
    }
    this.logger.info(
      { deadLetterId: id, sourceQueue },
      'job dead letter redriven',
    )
    return { id, sourceQueue }
  }

  /**
   * Drop one dead letter for good. Like a redrive, the queue comes from the
   * row itself: the delete is fenced on the dead-letter naming, so an id that
   * names a live job on a real queue matches nothing here.
   */
  async delete(id: string): Promise<DeleteJobDeadLetterResult> {
    const deleted = await this.deleteDeadLetter(id)
    if (!deleted) throw new NotFoundException(`No dead letter ${id}`)
    this.logger.info({ deadLetterId: id }, 'job dead letter deleted')
    return { id }
  }

  /**
   * Redrive each named dead letter on its own, reporting the ones that could
   * not move instead of failing the batch. Every entry goes through the same
   * move a single redrive does, so a batch is exactly as safe per entry: an
   * entry that is already gone, has no source queue, or whose key is held is
   * reported back and the rest still move.
   */
  async redriveMany(ids: string[]): Promise<RedriveJobDeadLettersResult> {
    const redriven: string[] = []
    const failed: JobDeadLetterBatchFailure[] = []
    for (const id of ids) {
      try {
        await this.redrive(id)
        redriven.push(id)
      } catch (error: unknown) {
        failed.push({ id, message: batchFailureMessage(error, id) })
      }
    }
    return { redriven, failed }
  }

  async deleteMany(ids: string[]): Promise<DeleteJobDeadLettersResult> {
    const deleted: string[] = []
    const failed: JobDeadLetterBatchFailure[] = []
    for (const id of ids) {
      try {
        await this.delete(id)
        deleted.push(id)
      } catch (error: unknown) {
        failed.push({ id, message: batchFailureMessage(error, id) })
      }
    }
    return { deleted, failed }
  }

  private async deleteDeadLetter(id: string): Promise<boolean> {
    const deleted = await this.prisma.$executeRaw`
      DELETE FROM pgboss.job
      WHERE id = ${id}::uuid AND name LIKE ${'%-dlq'}`
    return deleted > 0
  }

  private async findDeadLetter(id: string): Promise<DeadLetterRow | undefined> {
    const [row] = await this.prisma.$queryRaw<DeadLetterRow[]>`
      SELECT id::text AS id, name, created_on, source_name, source_retry_count,
        data, source_output
      FROM pgboss.job
      WHERE id = ${id}::uuid AND name LIKE ${'%-dlq'}`
    return row
  }
}
