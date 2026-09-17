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

    // Linking the unlinked and re-checking the linked are the same job seen
    // from both ends, but they share nothing beyond this lock — so each half
    // runs under its own catch, sequentially. Letting the first throw would
    // skip the second entirely, and because the day is stamped complete either
    // way, that half is lost until tomorrow's 04:00 with no retry in between.
    let nullSweepError: unknown
    let driftSweepError: unknown

    try {
      await this.backfill.reconcileNullPersonIds(RECONCILE_BATCH_LIMIT)
    } catch (error) {
      nullSweepError = error
    }

    try {
      await this.backfill.reconcileDriftedPersonIds(RECONCILE_BATCH_LIMIT)
    } catch (error) {
      driftSweepError = error
    }

    // Always release the daily-run lock: leaving the claim un-completed strands
    // it until the 6h stale takeover — well past the next 04:00 run — so the
    // day's sweep is lost with no retry.
    await this.cronLock.markCompleted(PERSON_ID_BACKFILL_CRON_JOB, now)

    // Re-thrown after the stamp so failures still reach the global logger. One
    // half failing is no reason to hide the other, so both are surfaced.
    if (nullSweepError && driftSweepError) {
      throw new AggregateError(
        [nullSweepError, driftSweepError],
        'both person_id reconcile sweeps failed',
      )
    }
    if (nullSweepError) throw nullSweepError
    if (driftSweepError) throw driftSweepError
  }
}
