import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { RobocallSettleState } from '../../generated/prisma'

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
  constructor(private readonly stripe: StripeService) {
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
        select: { authorizationIntentId: true },
      })
      if (cancelled?.authorizationIntentId) {
        await this.stripe.voidHold(cancelled.authorizationIntentId)
      }
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

    // BLOCK-FUTURE-SENDS integration point. `campaignHasDisputedRobocall` below
    // is the consultable check the draft-create / authorize path can gate on to
    // refuse a new run for a campaign with a disputed robocall. It is
    // intentionally NOT wired here: whether ONE disputed run should block ALL of
    // a campaign's future robocalls (and whether the block belongs at draft
    // create, at authorize, or both) is a product call. FLAGGED for review.
  }

  // Consultable block-future-sends check: does this campaign already have a
  // robocall in the `disputed` terminal? Returns true so the draft-create /
  // authorize path can refuse a new run. See markDisputedByIntent — not yet
  // wired into a call site.
  async campaignHasDisputedRobocall(campaignId: number): Promise<boolean> {
    const count = await this.model.count({
      where: {
        settleState: RobocallSettleState.disputed,
        outreach: { campaignId },
      },
    })
    return count > 0
  }
}
