import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import type { JobRun, ScheduleData } from '@/jobs/jobs.registry'
import { JobsService } from '@/jobs/jobs.service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { RobocallOrphanedHoldService } from './robocallOrphanedHold.service'
import { VENDOR_CRONS_ENABLED } from 'src/shared/util/appEnvironment.util'

// Confirms + re-voids authorization holds whose best-effort void may not have
// landed (recorded in RobocallOrphanedHold at each void site), so the
// candidate's reserved money is released rather than waiting out the ~7-day auth
// expiry. For each recorded hold it re-reads the PaymentIntent: `requires_capture`
// (the void did NOT land — the hold is still live) → cancel it with the THROWING
// cancelHold and stamp voided; any terminal status (canceled / succeeded /
// expired — the void DID land, or the hold was captured/expired) → stamp voided,
// nothing to do; a read/cancel failure leaves the row to retry. It
// only ever touches intent ids recorded at a real void site (never an
// account-wide scan), so it can NEVER void a hold a live run still needs. Never
// captures — only voids (releases money), the safe direction — so it needs no
// gate beyond VENDOR_CRONS_ENABLED: an orphan can arise whenever a void fails, and
// stranded reserved money is the harm.
@Injectable()
export class OutreachRobocallHoldReconcileService {
  constructor(
    private readonly orphans: RobocallOrphanedHoldService,
    private readonly stripe: StripeService,
    private readonly logger: PinoLogger,
    private readonly jobs: JobsService,
  ) {
    this.logger.setContext(OutreachRobocallHoldReconcileService.name)
  }

  // The robocallHoldReconcileSweep schedule (src/jobs/jobs.registry.ts) sends
  // one robocallOrphanedHoldReconcile job per recorded hold. Idempotent per
  // record behind the markVoided CAS: a job that runs twice re-reads and
  // (idempotently) cancels, and stamps once. VENDOR_CRONS_ENABLED (real Stripe
  // calls on prod, test mode elsewhere). Each job checks it too, since any
  // gp-api pointed at a database works its queues.
  async sweepOrphanedHolds(sweep: JobRun<ScheduleData>): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const orphans = await this.orphans.findUnvoided()
    await this.jobs.sendMany(
      'robocallOrphanedHoldReconcile',
      orphans.map(({ id }) => ({
        data: { orphanedHoldId: id },
        key: `${id}:${sweep.id}`,
      })),
    )
  }

  // One recorded hold. A Stripe read or cancel failure throws and the job
  // retries: the retry re-reads the intent, and a cancel only releases money.
  async reconcileOrphanedHold(
    job: JobRun<{ orphanedHoldId: number }>,
  ): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const orphan = await this.orphans.findFirst({
      where: { id: job.data.orphanedHoldId, voidedAt: null },
    })
    if (!orphan) return
    const { id, paymentIntentId } = orphan
    // Re-read the authoritative status. Never trust that the best-effort void
    // landed — only a fresh read decides.
    const intent = await this.stripe.retrievePaymentIntent(paymentIntentId)
    if (intent.status === 'requires_capture') {
      // The void did NOT land — the hold is still live, reserving money. Cancel
      // it with the throwing cancelHold; a failure fails the job so the row
      // stays unvoided and is retried (never stamped voided while the hold is
      // still live).
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
