import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import {
  Outreach,
  OutreachStatus,
  RobocallSettleState,
} from '../../generated/prisma'
import { OutreachRobocallPromoService } from './outreachRobocallPromo.service'
import { RobocallOrphanedHoldService } from './robocallOrphanedHold.service'
import { NOT_YET_DIALED_STATES } from './outreachRobocallWebhook.service'

// Candidate cancel is the not-yet-dialed set MINUS `hold_pending`. That state is
// an in-flight authorize: a Stripe hold may already be placed but its intent id
// is persisted only at the authorize commit, so a crash in between leaves the
// row `hold_pending` with a live, unrecorded hold. Cancelling it would flip the
// row to `cancelled` and hide it from OutreachRobocallHoldRecoveryService, whose
// stale sweep scans ONLY `hold_pending` — the live hold would then never be
// released before its ~7-day auth expiry. The state is transient and never
// surfaced to the candidate, so the cancel refuses it and lets authorize
// commit/void its own hold, or the recovery sweep release a crashed one.
const CANDIDATE_CANCELABLE_STATES: RobocallSettleState[] =
  NOT_YET_DIALED_STATES.filter(
    (state) => state !== RobocallSettleState.hold_pending,
  )

// Candidate-initiated robocall cancel. A robocall's lifecycle runs off the
// satellite settleState, so canceling means unwinding the money the way the
// payment_method.detached webhook does — void the hold, hand back the promo —
// not just flipping the spine. Cancelable ONLY while NOT dialed
// (NOT_YET_DIALED_STATES); a dialed/settling/captured run has gone out and must
// settle, so it is refused. Mirrors OutreachRobocallWebhookService's per-row
// unwind, and stays silent (no email/Slack) because the candidate is present
// and sees the result.
@Injectable()
export class OutreachRobocallCancelService extends createPrismaBase(
  MODELS.OutreachRobocall,
) {
  constructor(
    private readonly stripe: StripeService,
    private readonly promos: OutreachRobocallPromoService,
    private readonly orphanedHolds: RobocallOrphanedHoldService,
  ) {
    super()
  }

  async cancel(
    outreachId: number,
    campaignId: number,
    attribution?: { canceledBy: string; byAdmin: boolean },
  ): Promise<{ outreach: Outreach; refunded: boolean }> {
    const satellite = await this.model.findFirst({
      where: { outreachId, outreach: { campaignId } },
    })
    if (!satellite) {
      throw new NotFoundException('Robocall not found')
    }
    if (satellite.settleState === RobocallSettleState.cancelled) {
      return this.result(outreachId)
    }
    if (satellite.settleState === RobocallSettleState.hold_pending) {
      throw new BadRequestException(
        'This robocall is still being scheduled. Try canceling again in a moment.',
      )
    }
    if (!CANDIDATE_CANCELABLE_STATES.includes(satellite.settleState)) {
      throw new BadRequestException(
        'This robocall has already started and can no longer be canceled',
      )
    }

    // Single-owner claim: a dial/capture CAS (or an authorize racing in from
    // pending_payment) could move the row between the read above and here, so
    // the transition is guarded on the cancelable set.
    const claim = await this.model.updateMany({
      where: {
        id: satellite.id,
        settleState: { in: CANDIDATE_CANCELABLE_STATES },
      },
      data: { settleState: RobocallSettleState.cancelled },
    })
    if (claim.count === 0) {
      const current = await this.model.findUniqueOrThrow({
        where: { id: satellite.id },
      })
      if (current.settleState === RobocallSettleState.cancelled) {
        return this.result(outreachId)
      }
      throw new BadRequestException(
        'This robocall has already started and can no longer be canceled',
      )
    }

    // We own the transition; the row is now `cancelled` and frozen against the
    // hold/staging/send CASes. Re-read AFTER the claim so an intent set between
    // the first read and the claim (a row that became `authorized` mid-flight)
    // is caught, matching the webhook unwind. Then unwind the money best-effort
    // — a lost void never fails the cancel.
    const cancelled = await this.model.findUniqueOrThrow({
      where: { id: satellite.id },
    })

    await this.markSpineCanceled(outreachId, attribution)

    try {
      await this.promos.restore(outreachId)
    } catch (err) {
      this.logger.error(
        { err, outreachId },
        'robocall: failed to restore the promo code after cancel',
      )
    }

    if (cancelled.authorizationIntentId) {
      await this.stripe.voidHold(cancelled.authorizationIntentId)
      // Record the hold so the reconcile sweep re-voids it if this best-effort
      // void did not land (best-effort — never fail the cancel over it).
      try {
        await this.orphanedHolds.record(
          cancelled.authorizationIntentId,
          outreachId,
          'cancel_before_send',
        )
      } catch (err) {
        this.logger.error(
          { err, outreachId },
          'robocall: failed to record orphaned hold for reconcile after cancel',
        )
      }
    }

    return this.result(outreachId)
  }

  // The spine as it stands now, read fresh so the `canceled` status the cancel
  // just wrote is reflected rather than a pre-cancel snapshot. `refunded` is
  // always false: a robocall releases a hold (an authorization), never a
  // captured charge, so there is no Stripe refund to promise.
  private async result(
    outreachId: number,
  ): Promise<{ outreach: Outreach; refunded: boolean }> {
    const outreach = await this.client.outreach.findUniqueOrThrow({
      where: { id: outreachId },
    })
    return { outreach, refunded: false }
  }

  // Flip the spine → canceled after the satellite cancel, stamping the same
  // audit fields the p2p cancel does so a canceled robocall records who ended it
  // and when. The robocall spine is `pending_payment` for an unpaid draft or
  // `pending` once the pay step committed, so guard on both. Best-effort: the
  // satellite cancel already committed, so a transient failure must not throw.
  private async markSpineCanceled(
    outreachId: number,
    attribution?: { canceledBy: string; byAdmin: boolean },
  ): Promise<void> {
    try {
      await this.client.outreach.updateMany({
        where: {
          id: outreachId,
          status: {
            in: [OutreachStatus.pending, OutreachStatus.pending_payment],
          },
        },
        data: {
          status: OutreachStatus.canceled,
          canceledAt: new Date(),
          canceledBy: attribution?.canceledBy ?? null,
          canceledByAdmin: attribution?.byAdmin ?? false,
        },
      })
    } catch (err) {
      this.logger.error(
        { err, outreachId },
        'robocall: failed to cancel spine after candidate cancel',
      )
    }
  }
}
