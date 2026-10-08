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

  // `checkoutSessionId` is the `cs_...` id from the completed webhook. The caller
  // (the p2p post-purchase handler) only invokes this on the paid checkout path
  // under the flag, so the session always has a PaymentIntent.
  async recordHold({
    outreachId,
    checkoutSessionId,
  }: {
    outreachId: number
    checkoutSessionId: string
  }): Promise<void> {
    const intent = await this.resolveHeldIntent(checkoutSessionId)
    if (!intent) {
      this.logger.error(
        { outreachId, checkoutSessionId },
        'win sms hold: no PaymentIntent on completed session; nothing to record',
      )
      return
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
      return
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
      return
    }

    this.logger.info(
      {
        outreachId,
        authorizationIntentId: intent.id,
        authorizedAmountInCents: intent.amount,
      },
      'win sms hold: authorized hold recorded on satellite',
    )
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
