import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { isBefore } from 'date-fns'
import Stripe from 'stripe'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { StripeService } from 'src/vendors/stripe/services/stripe.service'
import { PeerlyP2pJobService } from 'src/vendors/peerly/services/peerlyP2pJob.service'
import {
  Outreach,
  OutreachStatus,
  P2pSmsSettleState,
} from '../../generated/prisma'
import { OutreachP2pSmsFreeTextsService } from './outreachP2pSmsFreeTexts.service'

// Stripe leaves latest_charge as a string id or an expanded Charge; normalize to
// the charge id the charge-keyed refund targets (same as the capture service).
const resolveChargeId = (intent: Stripe.PaymentIntent): string | null => {
  const charge = intent.latest_charge
  if (!charge) return null
  return typeof charge === 'string' ? charge : charge.id
}

type Satellite = {
  settleState: P2pSmsSettleState
  authorizationIntentId: string | null
  chargeIntentId: string | null
}

// Release (void + refund) for a Win p2p SMS HOLD-MODEL row — one whose
// OutreachP2pSms satellite exists. A hold-model send runs its money off the
// satellite settleState, so canceling or denying it means unwinding the hold
// (void it while authorized, refund it once captured) off the satellite intent,
// NOT the shared checkout-session refund the immediate-charge path uses.
//
// SATELLITE-GATED, NEVER FLAG-GATED (kill switch): the flag gates whether new
// rows ENTER the hold model, but once a row IS a hold its money guards apply
// regardless of the flag — a satellite that exists must be released correctly
// even on a WIN_SMS_HOLD_BILLING rollback. A non-satellite row never reaches
// this service; its cancel/deny stays byte-for-byte on the shared path.
//
// MONEY SAFETY. Release NEVER voids a captured charge or refunds an uncaptured
// hold: it re-reads the LIVE PaymentIntent before every action and branches on
// its real status, never a (possibly stale) satellite state. Exactly one refund
// is ever issued per charge: the refund is claimed to the in-flight `refunding`
// state (a single-owner CAS) BEFORE the Stripe call and keyed on the durable
// charge id, so a deny and a cancel racing the same charge can neither both
// claim it nor both pass the idempotency key. A `capturing` row is refused
// (money mid-flight) until the capture commits and it becomes refundable.
@Injectable()
export class OutreachP2pSmsCancelService extends createPrismaBase(
  MODELS.OutreachP2pSms,
) {
  constructor(
    private readonly stripe: StripeService,
    private readonly peerlyP2pJobService: PeerlyP2pJobService,
    private readonly freeTexts: OutreachP2pSmsFreeTextsService,
  ) {
    super()
  }

  // Candidate/admin cancel for a hold-model p2p row, dispatched from
  // OutreachService.cancelOutreach. Deletes the vendor job, releases the money
  // (void or refund), hands back the free-texts offer, and flips the spine to
  // canceled — the hold-model counterpart of the shared cancel body.
  async cancel(
    outreachId: number,
    campaignId: number,
    attribution?: { canceledBy: string; byAdmin: boolean },
  ): Promise<{ outreach: Outreach; refunded: boolean }> {
    const satellite = await this.model.findFirst({
      where: { outreachId, outreach: { campaignId } },
      select: {
        settleState: true,
        authorizationIntentId: true,
        chargeIntentId: true,
      },
    })
    if (!satellite) {
      throw new NotFoundException('Outreach not found')
    }

    // Idempotent terminals: a repeat cancel (or a cancel after a deny already
    // released the money) still finishes the spine flip, then returns the
    // settled outcome without touching money again.
    if (this.isTerminal(satellite.settleState)) {
      await this.markSpineCanceled(outreachId, attribution)
      return this.result(
        outreachId,
        satellite.settleState === P2pSmsSettleState.refunded,
      )
    }

    // Money mid-flight: refuse until the capture commits, after which the row is
    // captured and refundable. Never cancel a charge in the middle of being taken.
    if (satellite.settleState === P2pSmsSettleState.capturing) {
      throw new BadRequestException(
        'The payment for this campaign is still being processed. ' +
          'Try canceling again in a moment.',
      )
    }

    const spine = await this.client.outreach.findFirstOrThrow({
      where: { id: outreachId, campaignId },
    })
    if (spine.status === OutreachStatus.canceled) {
      return { outreach: spine, refunded: false }
    }
    // Only a not-yet-sent row is cancelable, BEFORE any money moves — mirrors the
    // shared immediate-charge body (status === pending), extended with
    // pending_payment for a pre-build authorized draft whose finalize deferred.
    // A completed (sent) or in_progress (sending / sweep-ratcheted) row is refused
    // so release can never refund a delivered send or leave the spine active while
    // the money is returned.
    if (
      spine.status !== OutreachStatus.pending &&
      spine.status !== OutreachStatus.pending_payment
    ) {
      throw new BadRequestException('Only scheduled campaigns can be canceled')
    }
    // Cancel is available up to the send, not through it: a BOOKED send past its
    // date may be mid-send, so deleting the vendor job then is a mess, not a
    // cancel (mirrors the immediate-charge guard). An unbooked row past its date
    // never sends and stays cancelable.
    const bookedToSend =
      spine.approvedAt !== null || spine.canvassRequestedAt !== null
    if (bookedToSend && spine.date && !isBefore(new Date(), spine.date)) {
      throw new BadRequestException(
        'This campaign has reached its send time and can no longer be canceled',
      )
    }

    // Delete the vendor job first so a cancel can never leave a live Peerly job
    // that still sends. Idempotent (already-deleted is a no-op); a failure throws
    // before any money moves, so the candidate keeps their campaign and can retry.
    if (spine.projectId) {
      await this.peerlyP2pJobService.deleteJob(spine.projectId)
    }

    const { refunded } = await this.releaseHold(outreachId)

    await this.markSpineCanceled(outreachId, attribution)

    return this.result(outreachId, refunded)
  }

  // The money half for the admin DENY of a hold-model row (the vendor job delete
  // + denial stamp stay in the admin service). Delegates to the SAME shared
  // release as cancel, so a deny and a cancel racing the same charge refund
  // exactly once; it refuses a `capturing` row (money mid-flight), refunds a
  // captured hold, voids an authorized one, and marks a never-held draft voided.
  async releaseForDeny(
    outreachId: number,
    campaignId: number,
  ): Promise<{ refunded: boolean }> {
    const satellite = await this.model.findFirst({
      where: { outreachId, outreach: { campaignId } },
      select: { outreachId: true },
    })
    if (!satellite) {
      throw new NotFoundException('Outreach not found')
    }
    return this.releaseHold(outreachId)
  }

  // The shared money release. Re-reads the satellite AND the live PaymentIntent
  // on every attempt and branches on the intent's REAL status, so a stale
  // satellite can never void a capture or refund a hold. A bounded retry
  // re-settles when a capture races the release (the row advances
  // authorized → captured between the branch and the claim): the next attempt
  // re-reads the now-succeeded intent and refunds instead of voiding.
  private async releaseHold(
    outreachId: number,
  ): Promise<{ refunded: boolean }> {
    // A capture settles in seconds; two re-reads comfortably outlast a race
    // without looping on a genuinely stuck row.
    for (let attempt = 0; attempt < 3; attempt++) {
      const satellite = await this.model.findUnique({
        where: { outreachId },
        select: {
          settleState: true,
          authorizationIntentId: true,
          chargeIntentId: true,
        },
      })
      if (!satellite) return { refunded: false }
      if (this.isTerminal(satellite.settleState)) {
        return {
          refunded: satellite.settleState === P2pSmsSettleState.refunded,
        }
      }
      // Another release already holds the single-owner refund claim (a deny and a
      // cancel racing the same charge): it will commit under the stable
      // charge-keyed idempotency key, so report the in-flight refund rather than
      // looping to a spurious failure or racing a second one. A permanently
      // stuck `refunding` (owner crashed mid-refund) is a slice-F reconcile case.
      if (satellite.settleState === P2pSmsSettleState.refunding) {
        return { refunded: true }
      }
      if (satellite.settleState === P2pSmsSettleState.capturing) {
        // A capture claimed the row mid-release. We cannot void (money may be
        // landing) or refund (not committed yet) — refuse so the caller retries
        // once the capture settles.
        throw new BadRequestException(
          'The payment for this campaign is still being processed. ' +
            'Try again in a moment.',
        )
      }

      // No hold intent was ever recorded (a pending_payment / hold_pending
      // satellite whose authorize never committed, or a data anomaly): there is
      // no money to move. Freeze the row voided so the cancel/deny completes
      // rather than looping to a 502, hand back any offer, and return. Claims
      // from the pre-hold states (an `authorized` row always carries an intent,
      // so it never reaches here).
      if (!satellite.authorizationIntentId) {
        const claimed = await this.claim(
          outreachId,
          [
            P2pSmsSettleState.pending_payment,
            P2pSmsSettleState.hold_pending,
            P2pSmsSettleState.authorized,
          ],
          P2pSmsSettleState.voided,
        )
        if (claimed) {
          await this.restoreFreeTextsBestEffort(outreachId)
          return { refunded: false }
        }
        continue
      }

      // LIVE-INTENT BRANCH: the authoritative money state decides void vs refund,
      // never the (possibly stale) satellite state.
      let intent: Stripe.PaymentIntent
      try {
        intent = await this.stripe.retrievePaymentIntent(
          satellite.authorizationIntentId,
        )
      } catch (err) {
        // Transient read failure: we cannot branch safely, and nothing moved.
        this.logger.error(
          { err, outreachId },
          'win sms release: PI read failed; nothing released, caller may retry',
        )
        throw new BadGatewayException(
          'The payment provider could not be reached. Try again.',
        )
      }

      if (intent.status === 'succeeded') {
        const done = await this.refundCaptured(outreachId, satellite, intent)
        if (done) return { refunded: true }
        continue
      }

      if (intent.status === 'requires_capture') {
        const done = await this.voidAuthorized(
          outreachId,
          satellite.authorizationIntentId,
        )
        if (done) return { refunded: false }
        continue
      }

      // The hold already lapsed (canceled / expired): nothing to void (it is
      // gone) and nothing to refund (no charge). An authorized row just records
      // the release; a satellite that claims `captured` here is a real anomaly
      // (a captured charge whose PI is not succeeded) — do not guess, surface it.
      if (satellite.settleState === P2pSmsSettleState.captured) {
        this.logger.error(
          { outreachId, intentStatus: intent.status },
          'CRITICAL win sms release: satellite captured but PI not succeeded; ' +
            'refusing to guess. TODO(slice F): reconcile this charge',
        )
        throw new BadGatewayException(
          'This payment is in an unexpected state and was left untouched.',
        )
      }
      const claimed = await this.claim(
        outreachId,
        [P2pSmsSettleState.authorized],
        P2pSmsSettleState.voided,
      )
      if (claimed) {
        await this.restoreFreeTextsBestEffort(outreachId)
        return { refunded: false }
      }
    }

    // The row kept moving under us past the retry budget: nothing was left in a
    // half-released state (each attempt either settled or lost its claim), so a
    // later cancel/deny attempt resolves it. Surface rather than claim success.
    throw new BadGatewayException(
      'The payment could not be settled right now. Try again.',
    )
  }

  // REFUND a captured charge. Claims captured|authorized → refunding (a
  // single-owner CAS) BEFORE the Stripe call, so a racing deny/cancel cannot
  // both issue one; the refund is keyed on the durable charge id for the same
  // reason. Returns false when it lost the claim (the caller re-reads and
  // retries). A transient Stripe failure reverts to captured so a retry re-runs
  // under the same key (which replays rather than double-refunds).
  private async refundCaptured(
    outreachId: number,
    satellite: Satellite,
    intent: Stripe.PaymentIntent,
  ): Promise<boolean> {
    // Prefer the charge id stamped at capture; fall back to the live PI's charge
    // for a stale authorized→succeeded row whose capture commit was lost.
    const chargeId = satellite.chargeIntentId ?? resolveChargeId(intent)
    if (!chargeId) {
      this.logger.error(
        { outreachId },
        'CRITICAL win sms release: succeeded PI carries no charge; cannot ' +
          'refund. TODO(slice F): reconcile this charge',
      )
      throw new BadGatewayException(
        'This payment is missing its charge record and was left untouched.',
      )
    }

    // Freeze the row for a single owner, stamping the charge id so a stale
    // authorized→succeeded row records what it refunded.
    const claimed = await this.model.updateMany({
      where: {
        outreachId,
        settleState: {
          in: [P2pSmsSettleState.captured, P2pSmsSettleState.authorized],
        },
      },
      data: {
        settleState: P2pSmsSettleState.refunding,
        chargeIntentId: chargeId,
      },
    })
    if (claimed.count === 0) return false

    try {
      await this.stripe.refundCharge(chargeId, `p2p-sms-refund-${chargeId}`)
    } catch (err) {
      // No commit yet: revert so a later attempt retries. The stable key makes a
      // replay refund once even if this call actually landed.
      this.logger.error(
        { err, outreachId },
        'win sms release: refund failed; reverting refunding → captured to retry',
      )
      await this.model.updateMany({
        where: { outreachId, settleState: P2pSmsSettleState.refunding },
        data: { settleState: P2pSmsSettleState.captured },
      })
      throw new BadGatewayException(
        'The refund could not be processed. Try again.',
      )
    }

    await this.model.updateMany({
      where: { outreachId, settleState: P2pSmsSettleState.refunding },
      data: { settleState: P2pSmsSettleState.refunded },
    })
    await this.restoreFreeTextsBestEffort(outreachId)
    this.logger.info({ outreachId, chargeId }, 'win sms hold refunded')
    return true
  }

  // VOID a live hold. Claims authorized → voided (single owner) before the void,
  // then releases the hold best-effort — a lost void never fails the release (the
  // auth auto-expires within its ~7-day lifetime regardless). Returns false when
  // it lost the claim (the caller re-reads and retries — e.g. a capture advanced
  // the row to captured, which the next attempt refunds instead).
  private async voidAuthorized(
    outreachId: number,
    authorizationIntentId: string,
  ): Promise<boolean> {
    const claimed = await this.claim(
      outreachId,
      [P2pSmsSettleState.authorized],
      P2pSmsSettleState.voided,
    )
    if (!claimed) return false

    // Best-effort (StripeService.voidHold logs its own failure).
    // TODO(slice F): a void that did not land needs a reconcile sweep to re-void
    // it; the hold otherwise auto-expires within the auth lifetime with no charge.
    await this.stripe.voidHold(authorizationIntentId)
    await this.restoreFreeTextsBestEffort(outreachId)
    this.logger.info({ outreachId }, 'win sms hold voided')
    return true
  }

  private async claim(
    outreachId: number,
    from: P2pSmsSettleState[],
    to: P2pSmsSettleState,
  ): Promise<boolean> {
    const claimed = await this.model.updateMany({
      where: { outreachId, settleState: { in: from } },
      data: { settleState: to },
    })
    return claimed.count > 0
  }

  private isTerminal(state: P2pSmsSettleState): boolean {
    return (
      state === P2pSmsSettleState.voided ||
      state === P2pSmsSettleState.refunded ||
      state === P2pSmsSettleState.hold_failed
    )
  }

  // The free-texts restore the guard the capture-void and the release share.
  // Best-effort: the money terminal already committed, and the campaign-marker
  // guard makes a later retry safe — so a transient restore failure is a loud
  // CRITICAL (slice F reconcile candidate), never a reason to fail the release
  // and re-run the money.
  private async restoreFreeTextsBestEffort(outreachId: number): Promise<void> {
    try {
      await this.freeTexts.restore(outreachId)
    } catch (err) {
      this.logger.error(
        { err, outreachId },
        'CRITICAL win sms release: free-texts restore failed after unwind; ' +
          'the offer may be stuck consumed. TODO(slice F): reconcile',
      )
    }
  }

  // Flip the spine → canceled with the same audit fields the immediate-charge
  // cancel stamps. Guarded on the pre-send statuses, so a replay or an
  // already-canceled row is a no-op. Best-effort: the satellite terminal is the
  // source of truth, so a transient spine failure must not re-run the money.
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
        'win sms release: failed to cancel spine after money release',
      )
    }
  }

  private async result(
    outreachId: number,
    refunded: boolean,
  ): Promise<{ outreach: Outreach; refunded: boolean }> {
    const outreach = await this.client.outreach.findUniqueOrThrow({
      where: { id: outreachId },
    })
    return { outreach, refunded }
  }
}
