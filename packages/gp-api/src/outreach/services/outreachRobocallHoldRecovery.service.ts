import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { subMinutes } from 'date-fns'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { ROBOCALL_HOLD_PENDING_STALE_MINUTES } from '@/shared/util/robocallHold.util'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { RobocallSettleState } from '../../generated/prisma'

// A free slot in the 6-per-hour robocall family (send :04, staging :07,
// completion :09, capture :02) — :08 is a Stripe-search-only sweep, no CallHub
// rate-limit overlap with its neighbors.
const ROBOCALL_HOLD_RECOVERY_SWEEP_CRON = '8,18,28,38,48,58 * * * *'
const ROBOCALL_HOLD_RECOVERY_SWEEP_JOB = 'robocallHoldRecoverySweep'

// Recovers robocall drafts stranded in hold_pending — a placement that won the
// pending_payment -> hold_pending claim but died before its commit / decline /
// revert (an ECS SIGTERM mid-request, a crash after the Stripe hold create but
// before the DB commit). No other sweep touches hold_pending, so such a row is
// stuck AND a hold placed just before the crash reserves the candidate's money
// with nothing to capture or void it — the intent id is persisted only at
// commit, so it was never recorded. The recovery finds any live hold for the
// outreach by metadata, CANCELS it (release the money — the conservative
// direction) with a THROWING cancel so a cancel failure leaves the row
// hold_pending rather than reverting with a still-live orphan, and reverts the
// row to pending_payment with a bumped payAttempt so the normal on-session
// re-authorize (or the deferred sweep) re-places cleanly under a fresh
// idempotency key rather than replaying the just-cancelled PI. It never places
// or captures — only cancels and reverts, both safe — so it needs no gate
// beyond prod-only: a hold_pending strand can happen whenever a placement dies
// mid-commit, and leaving reserved money stranded is the harm it exists to
// rescue.
@Injectable()
export class OutreachRobocallHoldRecoveryService extends createPrismaBase(
  MODELS.OutreachRobocall,
) {
  constructor(private readonly stripe: StripeService) {
    super()
  }

  // No CronLockService: recovery is idempotent per record behind the stale-
  // guarded self-transition claim, so two replicas racing both SELECT the same
  // stranded rows but only ONE wins each row's reclaim. @Cron (not @Interval) so
  // the schedule survives deploys and every replica fires on the same instant.
  // Prod-only (it voids real holds via Stripe, stubbed on dev/preview).
  @Cron(ROBOCALL_HOLD_RECOVERY_SWEEP_CRON, {
    name: ROBOCALL_HOLD_RECOVERY_SWEEP_JOB,
    timeZone: EASTERN_TIMEZONE,
  })
  async sweepStaleHoldPending(): Promise<void> {
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') return

    const staleCutoff = subMinutes(
      new Date(),
      ROBOCALL_HOLD_PENDING_STALE_MINUTES,
    )
    const stale = await this.model.findMany({
      where: {
        settleState: RobocallSettleState.hold_pending,
        updatedAt: { lt: staleCutoff },
      },
      select: { outreachId: true },
    })

    for (const { outreachId } of stale) {
      try {
        await this.recoverStaleHoldPending(outreachId)
      } catch (err) {
        // Per-record isolation: one draft's Stripe/DB failure must not abort
        // recovering the rest. The next sweep re-claims and retries it.
        this.logger.error(
          { err, outreachId },
          'robocall hold_pending recovery failed for a draft; continuing sweep',
        )
      }
    }
  }

  // Recovers one row stranded in hold_pending past the stale window. Re-claims it
  // with a stale-guarded CAS (writing hold_pending bumps @updatedAt, so a
  // concurrent recoverer finds updatedAt no longer < cutoff and loses — electing
  // exactly one), voids any live orphan hold, then reverts to pending_payment.
  async recoverStaleHoldPending(outreachId: number): Promise<void> {
    const staleCutoff = subMinutes(
      new Date(),
      ROBOCALL_HOLD_PENDING_STALE_MINUTES,
    )
    const reclaim = await this.model.updateMany({
      where: {
        outreachId,
        settleState: RobocallSettleState.hold_pending,
        updatedAt: { lt: staleCutoff },
      },
      data: { settleState: RobocallSettleState.hold_pending },
    })
    if (reclaim.count === 0) return

    const draft = await this.findFirst({ where: { outreachId } })
    if (!draft) {
      this.logger.error(
        { outreachId },
        'CRITICAL robocall hold recovery: claimed row vanished',
      )
      return
    }

    // Find and cancel any live hold placed by the crashed attempt. The intent id
    // was never persisted (commit did not run), so locate it by metadata.
    // Cancelling releases the reserved money — the conservative direction; a
    // re-authorize re-places a fresh hold. Both the search AND the cancel use
    // THROWING calls (cancelHold, not the best-effort voidHold): a found hold we
    // could not confirm cancelled must NOT fall through to the revert below, or
    // the row would return to pending_payment while a possibly-live orphan still
    // reserves the card and a re-auth stacks a second hold. A throw here is
    // caught per-record by the sweep, leaving the row hold_pending to retry.
    // This "never revert with a live orphan" guarantee is bounded by Stripe
    // SEARCH completeness, not absolute: a search index false-negative (a live
    // hold not yet indexed) reverts anyway and a re-auth double-RESERVES — never
    // a double-capture (an orphan's intent id was never persisted, so nothing
    // captures it), and it self-heals at the ~7-day auth expiry. The 15-min
    // stale window vastly exceeds Stripe's sub-minute index lag, so this is a
    // residual, not an expected, outcome; the 2a orphan-hold reconcile is its
    // durable backstop.
    const liveHoldIds =
      await this.stripe.findLiveManualHoldsByOutreach(outreachId)
    for (const paymentIntentId of liveHoldIds) {
      await this.stripe.cancelHold(paymentIntentId)
    }
    if (liveHoldIds.length > 0) {
      this.logger.error(
        { outreachId, cancelledHoldCount: liveHoldIds.length },
        'CRITICAL robocall hold recovery: cancelled orphan hold(s) from a ' +
          'crashed placement; reverting draft to pending_payment',
      )
    }

    // Revert to pending_payment so the normal placement path re-picks it. Bump
    // payAttempt so a re-authorize derives a FRESH idempotency key
    // (robocall-hold-<id>-<attempt+1>) — reusing the old key would replay the PI
    // we just voided and read back `canceled`, which the hold create treats as a
    // decline. Clear the authorization fields (already null on an uncommitted
    // row; defensive) so no stale intent id survives into pending_payment.
    await this.model.updateMany({
      where: { outreachId, settleState: RobocallSettleState.hold_pending },
      data: {
        settleState: RobocallSettleState.pending_payment,
        payAttempt: draft.payAttempt + 1,
        authorizationIntentId: null,
        authorizedAmountInCents: null,
        captureBefore: null,
      },
    })
  }
}
