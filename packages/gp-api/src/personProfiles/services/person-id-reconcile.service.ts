import { Injectable } from '@nestjs/common'
import { PersonIdBackfillService } from './person-id-backfill.service'

// Per-run cap so the sweep can never fan out to the whole users table.
const RECONCILE_BATCH_LIMIT = 500

// Daily backstop for the lazy GET /mine backfill, run by the personIdReconcile
// schedule (src/jobs/jobs.registry.ts). Off-peak so a bounded sweep of the
// scoped cohort doesn't compete with request traffic.
@Injectable()
export class PersonIdReconcileService {
  constructor(private readonly backfill: PersonIdBackfillService) {}

  async reconcile(): Promise<void> {
    // Linking the unlinked and re-checking the linked are the same job seen
    // from both ends, but they share nothing — so each half runs under its own
    // catch, sequentially. Letting the first throw would skip the second
    // entirely, and if the first keeps failing every retry would too, so the
    // drift half would not run at all.
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

    // Re-thrown after both halves ran so the run retries. One half failing is
    // no reason to hide the other, so both are surfaced.
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
