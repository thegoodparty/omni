import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PinoLogger } from 'nestjs-pino'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { RobocallOrphanedHoldService } from './robocallOrphanedHold.service'

// A Stripe-only slot free of the other robocall crons (capture :02, send :04,
// fresh-charge :05, staging :07, hold-recovery :08, completion :09, cleanup :00).
const ROBOCALL_HOLD_RECONCILE_CRON = '3,13,23,33,43,53 * * * *'
const ROBOCALL_HOLD_RECONCILE_JOB = 'robocallHoldReconcileSweep'

// Confirms + re-voids authorization holds whose best-effort void may not have
// landed (recorded in RobocallOrphanedHold at each void site), so the
// candidate's reserved money is released rather than waiting out the ~7-day auth
// expiry. For each recorded hold it re-reads the PaymentIntent: `requires_capture`
// (the void did NOT land — the hold is still live) → cancel it with the THROWING
// cancelHold and stamp voided; any terminal status (canceled / succeeded /
// expired — the void DID land, or the hold was captured/expired) → stamp voided,
// nothing to do; a read/cancel failure leaves the row to retry next sweep. It
// only ever touches intent ids recorded at a real void site (never an
// account-wide scan), so it can NEVER void a hold a live run still needs. Never
// captures — only voids (releases money) — so prod-only but deliberately NOT
// kill-switch-gated: an orphan can arise whenever a void fails, regardless of
// whether dialing/capture are enabled, and stranded reserved money is the harm.
@Injectable()
export class OutreachRobocallHoldReconcileService {
  constructor(
    private readonly orphans: RobocallOrphanedHoldService,
    private readonly stripe: StripeService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachRobocallHoldReconcileService.name)
  }

  // No CronLockService: idempotent per record behind the markVoided CAS, so two
  // replicas racing both re-read + (idempotently) cancel but only one stamps.
  // Prod-only (real Stripe calls, stubbed on dev/preview).
  @Cron(ROBOCALL_HOLD_RECONCILE_CRON, {
    name: ROBOCALL_HOLD_RECONCILE_JOB,
    timeZone: EASTERN_TIMEZONE,
  })
  async sweepOrphanedHolds(): Promise<void> {
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') return

    const orphans = await this.orphans.findUnvoided()
    for (const orphan of orphans) {
      try {
        await this.reconcileOne(orphan.id, orphan.paymentIntentId)
      } catch (err) {
        // Per-record isolation: one hold's Stripe failure must not abort the
        // rest. The row stays unvoided and retries next pass.
        this.logger.error(
          { err, paymentIntentId: orphan.paymentIntentId },
          'robocall orphaned-hold reconcile failed; continuing sweep',
        )
      }
    }
  }

  private async reconcileOne(
    id: number,
    paymentIntentId: string,
  ): Promise<void> {
    // Re-read the authoritative status. Never trust that the best-effort void
    // landed — only a fresh read decides.
    const intent = await this.stripe.retrievePaymentIntent(paymentIntentId)
    if (intent.status === 'requires_capture') {
      // The void did NOT land — the hold is still live, reserving money. Cancel
      // it with the throwing cancelHold; a failure propagates to the per-record
      // catch so the row stays unvoided and is retried (never stamped voided
      // while the hold is still live).
      await this.stripe.cancelHold(paymentIntentId)
      this.logger.info(
        { paymentIntentId },
        'robocall orphaned-hold reconcile: re-voided a still-live hold',
      )
    }
    // Either we just canceled it, or it was already terminal (canceled /
    // succeeded / expired) — nothing more to release. Stamp voided so it leaves
    // the queue.
    await this.orphans.markVoided(id)
  }
}
