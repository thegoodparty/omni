import { Injectable } from '@nestjs/common'
import { addDays } from 'date-fns'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { ROBOCALL_HOLD_WINDOW_DAYS } from '@/shared/util/robocallHold.util'
import {
  OutreachStatus,
  OutreachType,
  RobocallSettleState,
} from '../../generated/prisma'
import { OutreachRobocallHoldService } from './outreachRobocallHold.service'
import { RobocallOrphanedHoldService } from './robocallOrphanedHold.service'

// The robocall settle states in which no call has been placed yet: a hold may be
// reserved (authorized / hold_pending / staging) or the card merely persisted
// (pending_payment), but nothing has dialed. A detached card cancels ONLY these.
// dialing/dialed/settling/captured/charged are excluded on purpose — those runs
// have dialed or are settling, cannot be un-dialed, and their capture must
// proceed.
const NOT_YET_DIALED_STATES = [
  RobocallSettleState.pending_payment,
  RobocallSettleState.authorized,
  RobocallSettleState.hold_pending,
  RobocallSettleState.staging,
] as const

// Robocall money-safety reactions to Stripe webhooks. Kept out of the hold /
// staging / send services (which own the dial-time state machine): these two
// entry points only VOID holds and MARK state, never capture or charge.
@Injectable()
export class OutreachRobocallWebhookService extends createPrismaBase(
  MODELS.OutreachRobocall,
) {
  constructor(
    private readonly stripe: StripeService,
    private readonly holds: OutreachRobocallHoldService,
    private readonly orphanedHolds: RobocallOrphanedHoldService,
  ) {
    super()
  }

  // payment_method.detached: the candidate removed a saved card. Cancel every
  // robocall run still bound to it that has NOT dialed, releasing any hold.
  // Single-owner per row: the cancel is a CAS scoped to the not-yet-dialed
  // states, so a Stripe redelivery finds the row already `cancelled` (out of the
  // set), transitions nothing, and voids nothing — the repeat is a no-op. The
  // per-row CAS also races safely against the hold service's own
  // `hold_pending → authorized` commit: whichever loses finds the row already
  // moved and voids the hold it must not keep.
  async cancelNotYetDialedForDetachedPaymentMethod(
    paymentMethodId: string,
  ): Promise<void> {
    const drafts = await this.model.findMany({
      where: {
        paymentMethodId,
        settleState: { in: [...NOT_YET_DIALED_STATES] },
      },
      select: { id: true },
    })

    for (const { id } of drafts) {
      const claim = await this.model.updateMany({
        where: { id, settleState: { in: [...NOT_YET_DIALED_STATES] } },
        data: { settleState: RobocallSettleState.cancelled },
      })
      if (claim.count === 0) {
        continue
      }
      // We own the transition; the row is now `cancelled` and frozen against the
      // hold/staging/send CASes, so this read of the hold intent is stable and
      // catches an intent the pre-CAS read could have missed (a row that became
      // `authorized` mid-flight). voidHold is best-effort (never throws).
      const cancelled = await this.model.findUnique({
        where: { id },
        select: { authorizationIntentId: true, outreachId: true },
      })
      // A card-save made the spine visible (`pending`); reflect the cancel there
      // too so the row doesn't linger as "In review" in history.
      if (cancelled) {
        await this.markSpineCanceled(cancelled.outreachId)
      }
      if (cancelled?.authorizationIntentId) {
        await this.stripe.voidHold(cancelled.authorizationIntentId)
        // Record the hold so the reconcile sweep re-voids it if this best-effort
        // void did not land (best-effort — never fail the cancel over it).
        try {
          await this.orphanedHolds.record(
            cancelled.authorizationIntentId,
            cancelled.outreachId,
            'cancel_before_send',
          )
        } catch (err) {
          this.logger.error(
            { err, outreachId: cancelled.outreachId },
            'robocall: failed to record orphaned hold for reconcile',
          )
        }
      }
    }
  }

  // Flip the spine `pending → canceled` after the satellite cancel. Guarded on
  // `pending` (idempotent, never touches a row that never became visible).
  // Best-effort: the satellite cancel already committed, so a transient failure
  // must not throw and abort the loop over the customer's other drafts.
  private async markSpineCanceled(outreachId: number): Promise<void> {
    try {
      await this.client.outreach.updateMany({
        where: { id: outreachId, status: OutreachStatus.pending },
        data: { status: OutreachStatus.canceled },
      })
    } catch (err) {
      this.logger.error(
        { err, outreachId },
        'robocall: failed to cancel spine after payment-method-detached cancel',
      )
    }
  }

  // charge.dispute.created: map the disputed charge's payment intent back to the
  // robocall it paid for — the manual-capture hold intent OR a fresh-charge
  // intent — and mark that run `disputed`. Exact match on the stored intent ids
  // so a dispute never lands on the wrong campaign's run. Idempotent by value: a
  // redelivery re-finds the same row and re-writes the same terminal state.
  async markDisputedByIntent(intentId: string): Promise<void> {
    const draft = await this.model.findFirst({
      where: {
        OR: [{ authorizationIntentId: intentId }, { chargeIntentId: intentId }],
      },
      select: { id: true },
    })
    if (!draft) {
      return
    }

    await this.model.update({
      where: { id: draft.id },
      data: { settleState: RobocallSettleState.disputed },
    })
  }

  // payment_method.attached: retry the authorization hold for this customer's
  // hold_failed robocall drafts whose send is IN THE WINDOW, using the newly
  // attached card. The filter is bounded to `now < date <= now + window` so
  // authorizeHold always takes the placement path (its hold_failed +
  // authorizationIntentId-null retry CAS re-picks the row), NEVER the defer
  // branch — whose persist CAS is pending_payment-only and would silently drop
  // the new card on a hold_failed row rescheduled out of the window. The lower
  // bound (`> now`) honors "updating the card after send time does not revive
  // it"; authorizeHold's own capture-window fit enforces the hard deadline.
  // authorizeHold owns the single-owner claim, the Stripe hold, and the
  // HoldPlaced/HoldFailed milestones, so a Stripe redelivery is idempotent (a
  // draft already advanced out of hold_failed is not re-selected) and per-draft
  // failures are isolated.
  async retryHoldFailedForAttachedCard(
    customerId: string,
    paymentMethodId: string,
  ): Promise<void> {
    const now = new Date()
    const drafts = await this.model.findMany({
      where: {
        stripeCustomerId: customerId,
        settleState: RobocallSettleState.hold_failed,
        outreach: {
          outreachType: OutreachType.robocall,
          date: { gt: now, lte: addDays(now, ROBOCALL_HOLD_WINDOW_DAYS) },
        },
      },
      include: {
        outreach: {
          include: {
            campaign: { include: { user: true } },
            organization: true,
          },
        },
      },
    })

    for (const draft of drafts) {
      const { campaign, organization } = draft.outreach
      const user = campaign?.user
      // A robocall draft always carries a user + org; a row missing either can't
      // place a hold, so log and skip rather than throw the whole handler.
      if (!user || !organization) {
        this.logger.error(
          { outreachId: draft.outreachId },
          'robocall card-update retry: draft missing user/org; skipping',
        )
        continue
      }
      try {
        await this.holds.authorizeHold(
          user,
          campaign,
          organization,
          draft.outreachId,
          paymentMethodId,
        )
      } catch (err) {
        // authorizeHold surfaces a genuine decline as a hold_failed RESULT (not a
        // throw) and emits HoldFailed itself; a throw here is a transient/infra
        // error, which authorizeHold has reverted to pending_payment carrying the
        // now-validated new card — so the deferred sweep retries THIS card next
        // pass. Just log and continue; one draft's failure must not abort the
        // rest.
        this.logger.error(
          { err, outreachId: draft.outreachId },
          'robocall card-update hold retry failed; reverted for the sweep',
        )
      }
    }
  }
}
