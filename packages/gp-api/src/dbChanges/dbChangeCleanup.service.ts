import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { PrismaService } from '@/prisma/prisma.service'

// Rows one DELETE takes. The stamp and id indexes make each batch cheap; the
// cap only keeps one statement's lock and transaction small.
const CLEANUP_BATCH_SIZE = 5_000

// How long a relayed row is kept: long enough that a dead-lettered job
// redriven a couple of days later still has its change to read.
const RETENTION_DAYS = 7

// Deletes relayed changes past their retention, batched, until the hour's
// worth is gone. An unsent row is never deleted, however old: it is work the
// relay still owes a handler.
@Injectable()
export class DbChangeCleanupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DbChangeCleanupService.name)
  }

  async sweepRelayed(signal?: AbortSignal): Promise<number> {
    let deleted = 0
    for (;;) {
      const batch = await this.prisma.$executeRaw`
        DELETE FROM db_change
        WHERE id IN (
          SELECT id FROM db_change
          WHERE relayed_at IS NOT NULL
            AND relayed_at < now() - make_interval(days => ${RETENTION_DAYS}::int)
          ORDER BY id
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
