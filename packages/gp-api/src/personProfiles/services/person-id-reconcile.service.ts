import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { CronLockService } from '@/cron/services/cronLock.service'
import { PersonIdBackfillService } from './person-id-backfill.service'

// Daily backstop for the lazy GET /mine backfill. Off-peak so a bounded sweep
// of the scoped cohort doesn't compete with request traffic.
const PERSON_ID_BACKFILL_CRON = '0 4 * * *'
const PERSON_ID_BACKFILL_CRON_JOB = 'person-id-backfill'

// Per-run cap so the sweep can never fan out to the whole users table.
const RECONCILE_BATCH_LIMIT = 500

@Injectable()
export class PersonIdReconcileService {
  constructor(
    private readonly cronLock: CronLockService,
    private readonly backfill: PersonIdBackfillService,
  ) {}

  @Cron(PERSON_ID_BACKFILL_CRON, { name: PERSON_ID_BACKFILL_CRON_JOB })
  async reconcile(): Promise<void> {
    const now = new Date()
    const claimed = await this.cronLock.tryClaimDailyRun(
      PERSON_ID_BACKFILL_CRON_JOB,
      now,
    )
    if (!claimed) return

    // Always release the daily-run lock: if the sweep throws (e.g. a Prisma
    // error), leaving the claim un-completed strands it until the 6h stale
    // takeover — well past the next 04:00 run — so the day's sweep is lost with
    // no retry. finally lets the error still propagate to the global logger.
    try {
      await this.backfill.reconcileNullPersonIds(RECONCILE_BATCH_LIMIT)
      // Linking the unlinked and re-checking the linked are the same job seen
      // from both ends, and the drift half must not be skipped just because the
      // backfill half found nothing — so it runs on its own line, after.
      await this.backfill.reconcileDriftedPersonIds(RECONCILE_BATCH_LIMIT)
    } finally {
      await this.cronLock.markCompleted(PERSON_ID_BACKFILL_CRON_JOB, now)
    }
  }
}
