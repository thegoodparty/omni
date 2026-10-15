import { Injectable } from '@nestjs/common'
import { addDays, fromUnixTime } from 'date-fns'
import Stripe from 'stripe'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { isUniqueConstraintError } from 'src/prisma/util/prismaErrors.util'
import { StripeService } from 'src/vendors/stripe/services/stripe.service'
import { WIN_SMS_HOLD_WINDOW_DAYS } from 'src/shared/util/winSmsHold.util'
import { P2pSmsSettleState } from '../../generated/prisma'

// Records the Win p2p SMS authorization hold on the OutreachP2pSms satellite
// after the checkout session completes. The hold itself is placed by Stripe at
// checkout (payment_intent_data.capture_method = 'manual'); this service's job
// is to VERIFY that hold against the live PaymentIntent and record it durably,
// single-owner. Because the hold is already placed, recording is pure DB work
// with no in-flight external call — so the transition is a single CAS straight
// from pending_payment -> authorized (guarded on the exact prior state), rather
// than the hold_pending intermediate the robocall placement needs for a Stripe
// call that runs between claim and commit. There is no stale-recovery sweep for
// this satellite, and a direct transition can never strand a row mid-record. The
// `@unique` outreachId plus the CAS guarantee exactly one hold per send: a
// webhook replay or a second completed session for the same send finds the row
// already advanced and no-ops. No capture here (slice C1) and no approve/send
// gate change (slice D1).
@Injectable()
export class OutreachP2pSmsHoldService extends createPrismaBase(
  MODELS.OutreachP2pSms,
) {
  constructor(private readonly stripe: StripeService) {
    super()
  }

  // `checkoutSessionId` is the `cs_...` id from the completed webhook. The
  // caller (the p2p post-purchase handler) invokes this on every paid p2p
  // checkout now — NOT gated on a fresh flag read, because a flag flip
  // between session-creation and this webhook must never stymie recording a
  // hold Stripe already placed. Returns whether this WAS a hold-model
  // (manual-capture) checkout at all, durably read off the live PI's
  // capture_method — the caller uses this, not the flag, to decide whether
  // the rest of the webhook's hold-only steps (the per-send free-texts stamp,
  // the post-hold capture attempt) should run.
  async recordHold({
    outreachId,
    checkoutSessionId,
    peerlyPhoneListId,
  }: {
    outreachId: number
    checkoutSessionId: string
    // The PeerlyPhoneList this send bills against, resolved by the caller from
    // the draft (the same list calculateAmount priced). Linked NOW — before the
    // list is `ready` and before Outreach.phoneListId exists — because the
    // build-ready edge (finalize) and the capture both find a pre-build draft
    // through this satellite link rather than Outreach.phoneListId, which is
    // null until the build finishes.
    peerlyPhoneListId?: string
  }): Promise<boolean> {
    const intent = await this.resolveHeldIntent(checkoutSessionId)
    if (!intent) {
      this.logger.error(
        { outreachId, checkoutSessionId },
        'win sms hold: no PaymentIntent on completed session; nothing to record',
      )
      return false
    }

    // DURABLE hold-model signal: capture_method is set ('manual') at checkout-
    // session CREATION time (entry) and never changes afterward, so reading it
    // here tells us what entry decided WITHOUT re-reading the flag. An
    // immediate-charge (automatic-capture) session reaching this webhook is
    // not a hold at all — nothing to record on the satellite.
    if (intent.capture_method !== 'manual') {
      return false
    }

    // Seed the satellite at pending_payment if it does not exist yet. The unique
    // outreachId makes this idempotent; a concurrent seed that loses the race
    // raises a unique-constraint error, which means the row already exists.
    try {
      await this.model.upsert({
        where: { outreachId },
        create: { outreachId },
        update: {},
      })
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err
    }

    // LINK the satellite to its PeerlyPhoneList. This is the only handle to the
    // list before it is `ready`, so it is what the build-ready finalize edge and
    // the capture use to find a pre-build draft (whose Outreach.phoneListId is
    // still null). Written as its OWN idempotent update (guarded on
    // peerlyPhoneListId IS NULL), separate from the authorize CAS below — so a
    // webhook replay that now resolves the list backfills a link that an earlier
    // authorize left unset, which the pending_payment-guarded CAS could never
    // add once the row is past pending_payment.
    //
    // The link is set in practice: the caller resolves it from the draft the
    // same way calculateAmount did before the Stripe session existed, and that
    // lookup threw if it found nothing. Reaching the missing branch means the
    // list or draft changed between checkout and the webhook, which nothing
    // does; it is logged (loud, observable) but not fatal, because an unlinked
    // hold simply lapses and releases at the ~7-day Stripe auth with NO charge —
    // the capture projectId gate never charges for a send that was not
    // submitted.
    if (!peerlyPhoneListId) {
      this.logger.warn(
        { outreachId, checkoutSessionId },
        'win sms hold: could not resolve phone list; satellite left unlinked',
      )
    } else {
      await this.model.updateMany({
        where: { outreachId, peerlyPhoneListId: null },
        data: { peerlyPhoneListId },
      })
    }

    // VERIFY BEFORE STAMPING: a confirmed PI that did not reach requires_capture
    // (requires_action / processing / canceled) is NOT a usable hold — it is a
    // decline, not money we can later capture. Move to the hold_failed terminal
    // and never stamp an authorized amount against it. CAS-guarded on the exact
    // prior state (pending_payment, no intent) so a replay or a second completed
    // session no-ops.
    if (intent.status !== 'requires_capture') {
      await this.model.updateMany({
        where: {
          outreachId,
          settleState: P2pSmsSettleState.pending_payment,
          authorizationIntentId: null,
        },
        data: { settleState: P2pSmsSettleState.hold_failed },
      })
      this.logger.error(
        { outreachId, checkoutSessionId, status: intent.status },
        'win sms hold: PI not in requires_capture; recorded hold_failed',
      )
      return true
    }

    // STAMP: a single single-owner CAS straight from pending_payment ->
    // authorized. The hold is ALREADY placed by Stripe at checkout, so recording
    // it is pure DB work with no in-flight external call to crash between a claim
    // and its commit — a direct transition (rather than a hold_pending
    // intermediate, which the satellite has no stale-recovery sweep for) can
    // never strand a row mid-record. The `@unique` outreachId plus this CAS
    // guarantee exactly one hold is recorded per send: a webhook replay or a
    // second completed session for the same outreach finds the row already past
    // pending_payment and no-ops (count 0). authorizedAmountInCents is the amount
    // Stripe actually authorized (the undiscounted estimate), read off the live
    // PI, never a client-supplied number.
    const stamp = await this.model.updateMany({
      where: {
        outreachId,
        settleState: P2pSmsSettleState.pending_payment,
        authorizationIntentId: null,
      },
      data: {
        settleState: P2pSmsSettleState.authorized,
        authorizationIntentId: intent.id,
        authorizedAmountInCents: intent.amount,
        captureBefore: this.resolveCaptureBefore(intent),
      },
    })
    if (stamp.count === 0) {
      this.logger.info(
        { outreachId, checkoutSessionId },
        'win sms hold: satellite already past pending_payment; skipping (replay)',
      )
      return true
    }

    this.logger.info(
      {
        outreachId,
        authorizationIntentId: intent.id,
        authorizedAmountInCents: intent.amount,
      },
      'win sms hold: authorized hold recorded on satellite',
    )
    return true
  }

  // Resolves the manual-capture PaymentIntent behind a completed checkout
  // session, re-read live so the stamp reflects the authoritative money state.
  private async resolveHeldIntent(
    checkoutSessionId: string,
  ): Promise<Stripe.PaymentIntent | null> {
    const session = await this.stripe.retrieveCheckoutSession(checkoutSessionId)
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id
    if (!paymentIntentId) return null
    return this.stripe.retrievePaymentIntent(paymentIntentId)
  }

  // Stripe returns capture_before (Unix seconds) on a manual-capture auth, but
  // the SDK type does not expose it. Fall back to the standard ~7-day lifetime
  // when it is absent so a downstream capture-window check always has a bound.
  private resolveCaptureBefore(intent: Stripe.PaymentIntent): Date {
    const captureBeforeUnix = (
      intent as Stripe.PaymentIntent & { capture_before?: number | null }
    ).capture_before
    return captureBeforeUnix
      ? fromUnixTime(captureBeforeUnix)
      : addDays(new Date(), WIN_SMS_HOLD_WINDOW_DAYS)
  }
}
