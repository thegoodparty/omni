import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { PrismaService } from '@/prisma/prisma.service'
import { changeNames } from '@/jobs/changes.registry'

// Rows one DELETE takes. The stamp and id indexes make each batch cheap; the
// cap only keeps one statement's lock and transaction small.
const CLEANUP_BATCH_SIZE = 5_000

// How long a relayed row is kept: long enough that a dead-lettered job
// redriven a couple of days later still has its change to read.
const RETENTION_DAYS = 7

// Deletes relayed changes past their retention, batched, until the hour's
// worth is gone. An unsent row is never deleted, however old: it is work the
// relay still owes a handler.
//
// Nor is a row a queued job still points at. A job can outlive its row — one
// waiting behind a slow group, one retrying with the backoff capped at ten
// minutes, a dead letter redriven by hand — and a handler whose row is gone has
// nothing to resync from. The job's state is checked rather than its age
// because a retry holds its row indefinitely.
//
// The dead-letter queue counts, which is what makes the real retention seven
// days or the life of the dead letter, whichever is longer: a dead letter sits
// in its own queue in state `created` until it is redriven, deleted, or 14 days
// pass, and redriving it must still find its change.
@Injectable()
export class DbChangeCleanupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DbChangeCleanupService.name)
  }

  async sweepRelayed(signal?: AbortSignal): Promise<number> {
    // pg-boss keeps one pgboss.job row per queued job, whatever its state, and
    // names the queue in `name`. Every change queue, and its own dead-letter
    // queue, which holds a copy of a job that already failed: a dead letter
    // redriven a day later needs its change row too.
    const queues = changeNames().flatMap((name) => [name, `${name}-dlq`])
    let deleted = 0
    for (;;) {
      const batch = await this.prisma.$executeRaw`
        DELETE FROM db_change
        WHERE id IN (
          SELECT c.id FROM db_change c
          WHERE c.relayed_at IS NOT NULL
            AND c.relayed_at < now() - make_interval(days => ${RETENTION_DAYS}::int)
            AND NOT EXISTS (
              SELECT 1 FROM pgboss.job j
              WHERE j.state IN ('created', 'retry', 'active')
                AND j.name = ANY(${queues}::text[])
                AND j.data->>'changeId' = c.id::text
            )
          ORDER BY c.id
          LIMIT ${CLEANUP_BATCH_SIZE}
        )
      `
      deleted += batch
      if (batch > 0) this.logger.info({ deleted: batch }, 'changes deleted')
      if (batch < CLEANUP_BATCH_SIZE || signal?.aborted) break
    }
    return deleted
  }
}
