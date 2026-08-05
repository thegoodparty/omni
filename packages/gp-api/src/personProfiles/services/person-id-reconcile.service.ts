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

    await this.backfill.reconcileNullPersonIds(RECONCILE_BATCH_LIMIT)
    await this.cronLock.markCompleted(PERSON_ID_BACKFILL_CRON_JOB, now)
  }
}
