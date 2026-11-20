import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { PgBoss } from 'pg-boss'
import {
  JobDeadLetter,
  JobDeadLettersListQuery,
  JOB_DEAD_LETTERS_MAX_LIMIT,
  PaginatedList,
  RedriveJobDeadLetterResult,
} from '@goodparty_org/contracts'
import { Prisma } from '@/generated/prisma'
import { PrismaService } from '@/prisma/prisma.service'
import { requireEnv } from '@/shared/util/env.util'
import { isJsonObject } from '@/shared/util/objects.util'
import { DEFAULT_PAGINATION_OFFSET } from '@/shared/constants/paginationOptions.consts'
import { deadLetterQueue } from '@/jobs/jobs.service'

type DeadLetterRow = {
  name: string
  source_name: string | null
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
      this.boss = new PgBoss({
        connectionString: requireEnv('DATABASE_URL'),
        max: 2,
        migrate: false,
        supervise: false,
        schedule: false,
        registerInstance: false,
      }).start()
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
        Array<{
          id: string
          created_on: Date
          source_name: string | null
          source_retry_count: number | null
          data: JobDeadLetter['data']
          source_output: Prisma.JsonValue
        }>
      >`SELECT id::text AS id, created_on, source_name, source_retry_count,
          data, source_output
        FROM pgboss.job WHERE ${where}
        ORDER BY created_on DESC, id
        LIMIT ${limit} OFFSET ${offset}`,
      this.prisma.$queryRaw<Array<{ total: number }>>`
        SELECT count(*)::int AS total FROM pgboss.job WHERE ${where}`,
    ])
    return {
      data: rows.map((row) => ({
        id: row.id,
        sourceQueue: row.source_name,
        createdAt: row.created_on,
        retriesUsed: row.source_retry_count,
        data: row.data,
        error: errorOf(row.source_output),
      })),
      meta: { total: count[0]?.total ?? 0, offset, limit },
    }
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
      // The insert is dropped when key_strict_fifo's source queue still holds
      // an active, retrying or failed job under this one's key, which it does
      // until pg-boss deletes the failed row, about two minutes after the
      // dead letter.
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

  private async findDeadLetter(id: string): Promise<DeadLetterRow | undefined> {
    const [row] = await this.prisma.$queryRaw<DeadLetterRow[]>`
      SELECT name, source_name FROM pgboss.job
      WHERE id = ${id}::uuid AND name LIKE ${'%-dlq'}`
    return row
  }
}
