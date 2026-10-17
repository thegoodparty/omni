import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { isBefore } from 'date-fns'
import Stripe from 'stripe'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { StripeService } from 'src/vendors/stripe/services/stripe.service'
import { PeerlyP2pJobService } from 'src/vendors/peerly/services/peerlyP2pJob.service'
import { PeerlyJob } from 'src/vendors/peerly/peerly.types'
import {
  Outreach,
  OutreachStatus,
  P2pSmsSettleState,
} from '../../generated/prisma'
import { OutreachP2pSmsFreeTextsService } from './outreachP2pSmsFreeTexts.service'
import { OutreachNotificationService } from './outreachNotification.service'
import { hasPeerlyCanvassersBooked } from '../util/peerlyCanvassersBooked.util'

// Stripe leaves latest_charge as a string id or an expanded Charge; normalize to
// the charge id the charge-keyed refund targets (same as the capture service).
const resolveChargeId = (intent: Stripe.PaymentIntent): string | null => {
  const charge = intent.latest_charge
  if (!charge) return null
  return typeof charge === 'string' ? charge : charge.id
}

// How long a CAS loser waits out another owner's in-flight `refunding` claim
// before concluding the owner is stranded. A refund commits in well under a
// second; env-overridable so tests resolve without real waits.
const REFUND_RESOLVE_POLL_ATTEMPTS = 10
const refundResolvePollMs = (): number => {
  // `??` only guards undefined; an empty or non-numeric env would collapse to 0
  // (Number('') === 0, Number('x') === NaN → setTimeout treats both as 0) and
  // busy-loop the DB. Fall back unless it parses to a positive, finite number.
  const parsed = Number(process.env.WIN_SMS_REFUND_POLL_MS)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300
}

type Satellite = {
  settleState: P2pSmsSettleState
  authorizationIntentId: string | null
  chargeIntentId: string | null
}

// Release refused because the hold is `capturing` (money mid-flight): a
// transient, retryable condition that commits NO release transition and moves
// NO money. Deny keys its denial-stamp revert off this exact type — every other
// release failure may already have moved money, so only this one is safe to
// heal by making the row reviewable again.
export class HoldStillSettlingException extends BadRequestException {}

// Release (void + refund) for a Win p2p SMS HOLD-MODEL row — one whose
// OutreachP2pSms satellite exists. A hold-model send runs its money off the
// satellite settleState, so canceling or denying it means unwinding the hold
// (void it while authorized, refund it once captured) off the satellite intent,
// NOT the shared checkout-session refund the immediate-charge path uses.
//
// SATELLITE-GATED, NEVER FLAG-GATED: the managed flag gates whether new rows
// ENTER the hold model, but once a row IS a hold its money guards apply
// regardless of the flag — a satellite that exists must be released correctly
// even if win_sms_hold_billing is since turned off. A non-satellite row never
// reaches this service; its cancel/deny stays byte-for-byte on the shared path.
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
    private readonly notifications: OutreachNotificationService,
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
      const flipped = await this.markSpineCanceled(outreachId, attribution)
      await this.assertSpineCanceled(outreachId, campaignId, flipped)
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

    // Another release owner (a racing cancel or deny) holds the single-owner
    // refund claim — and already deleted the vendor job before claiming it (the
    // delete precedes the `refunding` CAS in every release path). SKIP the
    // redundant job delete and go straight to the shared release, which awaits
    // that owner's outcome: committed → flip the spine canceled; reverted → this
    // cancel claims the refund itself; stranded (owner crashed between claim and
    // Stripe) → releaseHold surfaces 503 WITHOUT flipping the spine or re-deleting
    // a job, for the slice-F reconcile — never a false "canceled" over unmoved
    // money, and never an orphaned live job (the owner's delete stands).
    if (satellite.settleState === P2pSmsSettleState.refunding) {
      const { refunded } = await this.releaseHold(outreachId)
      const flipped = await this.markSpineCanceled(outreachId, attribution)
      await this.assertSpineCanceled(outreachId, campaignId, flipped)
      await this.tryNotifyCanceled(outreachId, campaignId, attribution)
      return this.result(outreachId, refunded)
    }

    const spine = await this.client.outreach.findFirstOrThrow({
      where: { id: outreachId, campaignId },
    })
    if (spine.status === OutreachStatus.canceled) {
      return { outreach: spine, refunded: false }
    }
    // Only a not-yet-sent row is cancelable, BEFORE any money moves — mirrors the
    // shared immediate-charge body, extended with pending_payment for a
    // pre-build authorized draft whose finalize deferred. A candidate may cancel
    // an in_progress row only when it is unbooked: the completion sweep ratchets
    // it there on its send day whether or not it was booked, and nothing sends
    // without a booking (prod outreach 85286). Staff may cancel a booked send
    // too, since they unbook through our portal rather than Peerly. A completed
    // (sent) row is always refused so release can never refund a delivered send.
    const byAdmin = attribution?.byAdmin === true
    const bookedToSend =
      spine.approvedAt !== null || spine.canvassRequestedAt !== null
    const cancelableInProgress =
      spine.status === OutreachStatus.in_progress && (byAdmin || !bookedToSend)
    if (
      spine.status !== OutreachStatus.pending &&
      spine.status !== OutreachStatus.pending_payment &&
      !cancelableInProgress
    ) {
      throw new BadRequestException('Only scheduled campaigns can be canceled')
    }
    if (!byAdmin) {
      // A candidate's cancel is available up to the send, not through it: a
      // BOOKED send past its date may be mid-send (mirrors the immediate-charge
      // guard). An unbooked row past its date never sends and stays cancelable.
      if (bookedToSend && spine.date && !isBefore(new Date(), spine.date)) {
        throw new BadRequestException(
          'This campaign has reached its send time and can no longer be ' +
            'canceled',
        )
      }
      // Staff can book canvassers by hand in Peerly, which stamps nothing on
      // the spine, so past the send time the live job decides. A failed read
      // refuses: deleting a job we could not check may be deleting a live send.
      // A dateless row counts as past it: the sweep only moves a row to
      // `in_progress` once Peerly's start day has begun, so a dateless one is
      // on its send day with no time of ours to compare, possibly hand-booked.
      const pastSendTime =
        spine.date === null || !isBefore(new Date(), spine.date)
      if (cancelableInProgress && spine.projectId && pastSendTime) {
        let job: PeerlyJob
        try {
          job = await this.peerlyP2pJobService.getJob(spine.projectId)
        } catch (err) {
          this.logger.error(
            { err, outreachId },
            'win sms cancel: could not read the Peerly job to confirm it is ' +
              'unbooked',
          )
          throw new BadGatewayException(
            'Could not confirm with the texting vendor that this campaign ' +
              'is not booked to send. Try canceling again.',
          )
        }
        if (hasPeerlyCanvassersBooked(job)) {
          throw new BadRequestException(
            'This campaign has reached its send time and can no longer be ' +
              'canceled',
          )
        }
      }
    }

    // Claim the spine BEFORE the vendor delete and the money release, the
    // shared cancel's discipline: approve's claim requires a reviewable,
    // unapproved row, so whichever claim lands first wins and a candidate's
    // cancel can never refund a send an approve just booked. Staff may cancel
    // a booked send, so their claim only serializes on status.
    const claimedFrom = cancelableInProgress
      ? OutreachStatus.in_progress
      : spine.status === OutreachStatus.pending_payment
        ? OutreachStatus.pending_payment
        : OutreachStatus.pending
    const claimed = await this.client.outreach.updateMany({
      where: {
        id: outreachId,
        status: claimedFrom,
        ...(cancelableInProgress && !byAdmin
          ? { approvedAt: null, canvassRequestedAt: null }
          : {}),
      },
      data: {
        status: OutreachStatus.canceled,
        canceledAt: new Date(),
        canceledBy: attribution?.canceledBy ?? null,
        canceledByAdmin: attribution?.byAdmin ?? false,
      },
    })
    if (claimed.count === 0) {
      const current = await this.client.outreach.findFirstOrThrow({
        where: { id: outreachId, campaignId },
      })
      if (current.status === OutreachStatus.canceled) {
        return { outreach: current, refunded: false }
      }
      throw new BadRequestException('Only scheduled campaigns can be canceled')
    }

    // Delete the vendor job first so a cancel can never leave a live Peerly job
    // that still sends. Idempotent (already-deleted is a no-op). Every release
    // failure leaves the money where it was (see releaseHold), so either failure
    // hands the claim back and the candidate can retry.
    let release: { refunded: boolean }
    try {
      if (spine.projectId) {
        await this.peerlyP2pJobService.deleteJob(spine.projectId)
      }
      release = await this.releaseHold(outreachId)
    } catch (err) {
      await this.revertSpineClaim(outreachId, claimedFrom)
      throw err
    }

    await this.tryNotifyCanceled(outreachId, campaignId, attribution)

    return this.result(outreachId, release.refunded)
  }

  // A revert failure must never replace the error that triggered it, so it
  // logs instead of throwing.
  private async revertSpineClaim(
    outreachId: number,
    claimedFrom: OutreachStatus,
  ): Promise<void> {
    try {
      await this.client.outreach.updateMany({
        where: { id: outreachId, status: OutreachStatus.canceled },
        data: {
          status: claimedFrom,
          canceledAt: null,
          canceledBy: null,
          canceledByAdmin: false,
        },
      })
    } catch (err) {
      this.logger.error(
        { err, outreachId },
        'win sms cancel: claim revert failed; the spine reads canceled with ' +
          'the cancel unfinished, manual intervention required',
      )
    }
  }

  // The CAS "canceled" Slack notice (covering the candidate route and the admin
  // console), fired after the cancel fully committed — parity with the shared
  // immediate-charge body, which posts it for non-satellite p2p cancels. The
  // satellite delegate returns before that block, so it posts the notice here.
  // Best-effort end to end: a Slack failure never fails or retries a completed
  // cancel. Skipped on the idempotent-terminal early-returns (the first cancel
  // already posted it), so a repeat cancel never double-posts.
  private async tryNotifyCanceled(
    outreachId: number,
    campaignId: number,
    attribution?: { canceledBy: string; byAdmin: boolean },
  ): Promise<void> {
    try {
      const notifRow = await this.client.outreach.findFirst({
        where: { id: outreachId },
        include: { voterFileFilter: true },
      })
      const campaignWithUser = await this.client.campaign.findFirst({
        where: { id: campaignId },
        include: { user: true },
      })
      if (notifRow && campaignWithUser?.user) {
        await this.notifications.notifyCanceled({
          user: campaignWithUser.user,
          campaign: campaignWithUser,
          outreach: notifRow,
          textCount: notifRow.textCount ?? undefined,
          billableTextCount: notifRow.billableTextCount ?? undefined,
          canceledByAdmin: attribution?.byAdmin ?? false,
        })
      }
    } catch (err) {
      this.logger.error(
        { err, outreachId, campaignId },
        'win sms cancel: CAS cancel notice failed; the cancel is unaffected',
      )
    }
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
          capturedAmountInCents: true,
        },
      })
      if (!satellite) return { refunded: false }
      if (this.isTerminal(satellite.settleState)) {
        return {
          refunded: satellite.settleState === P2pSmsSettleState.refunded,
        }
      }
      // Another release holds the single-owner refund claim (a deny and a cancel
      // racing the same charge). DO NOT assume it committed: the owner can revert
      // `refunding → captured` on a transient Stripe error, or crash between the
      // CAS claim and the Stripe call. Reporting "refunded" here (and letting the
      // caller flip the spine) when no refund committed would tell the candidate
      // their money is back while it never left. So wait for it to resolve:
      //   refunded  → report the committed refund
      //   reverted  → re-attempt (fall through; claim the CAS ourselves)
      //   stranded  → surface UNRESOLVED without reporting a refund or flipping
      //               the spine; the refunding reconcile sweep
      //               (outreachP2pSmsReconcile.service.ts) verifies against
      //               Stripe and finishes the refund.
      if (satellite.settleState === P2pSmsSettleState.refunding) {
        const resolution = await this.awaitRefundResolution(outreachId)
        if (resolution === 'refunded') return { refunded: true }
        if (resolution === 'stranded') {
          throw new ServiceUnavailableException(
            'The refund for this campaign is still processing. ' +
              'Check back shortly.',
          )
        }
        // Reverted (or the row otherwise left `refunding`): re-attempt — the next
        // loop iteration re-reads and claims the refund CAS itself.
        continue
      }
      if (satellite.settleState === P2pSmsSettleState.capturing) {
        // A capture claimed the row mid-release. We cannot void (money may be
        // landing) or refund (not committed yet) — refuse so the caller retries
        // once the capture settles. Typed so deny can tell this money-safe,
        // retryable refusal (revert the denial) apart from a failure that may
        // have moved money (keep the denial committed).
        throw new HoldStillSettlingException(
          'The payment for this campaign is still being processed. ' +
            'Try again in a moment.',
        )
      }

      // Settled at $0 because a promotion code covered it: nothing was charged,
      // so there is nothing to refund and no hold left to void. Release it the
      // same way a never-held row is released.
      if (
        satellite.settleState === P2pSmsSettleState.captured &&
        satellite.capturedAmountInCents === 0
      ) {
        const claimed = await this.claim(
          outreachId,
          [P2pSmsSettleState.captured],
          P2pSmsSettleState.voided,
        )
        if (claimed) {
          await this.restoreFreeTextsBestEffort(outreachId)
          return { refunded: false }
        }
        continue
      }

      // No hold intent was ever recorded (a pending_payment / hold_pending
      // satellite whose authorize never committed, or a data anomaly): there is
      // no money to move. Freeze the row voided so the cancel/deny completes
      // rather than looping to a 502, hand back any offer, and return. Claims
      // from the pre-hold states, plus `authorized` for a send a promotion code
      // covered in full, which Stripe placed no hold for.
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
        const { settled, refunded } = await this.voidAuthorized(
          outreachId,
          satellite.authorizationIntentId,
        )
        if (settled) return { refunded }
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
            'refusing to guess — a human must reconcile this charge ' +
            '(win-sms-critical alert)',
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
          'refund — a human must reconcile this charge (win-sms-critical alert)',
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

    let refund: Stripe.Response<Stripe.Refund>
    try {
      refund = await this.stripe.refundCharge(
        chargeId,
        `p2p-sms-refund-${chargeId}`,
      )
    } catch (err) {
      // No commit yet: revert so a later attempt retries. The stable key makes a
      // replay refund once even if this call actually landed.
      this.logger.error(
        { err, outreachId },
        'win sms release: refund failed; reverting refunding → captured to retry',
      )
      await this.revertRefundingToCaptured(outreachId)
      throw new BadGatewayException(
        'The refund could not be processed. Try again.',
      )
    }

    // A refund Stripe ACCEPTED but did not actually process (`failed`/`canceled`,
    // or any status that is not money-on-its-way) must NOT be reported as
    // refunded — the candidate would be told their money is back when it never
    // left. Revert so a retry re-attempts under the stable key. `succeeded` is
    // done; `pending` is committed and processing (cards settle near-instantly).
    if (refund.status !== 'succeeded' && refund.status !== 'pending') {
      this.logger.error(
        { outreachId, chargeId, status: refund.status },
        'win sms release: refund not committed (status not succeeded/pending); ' +
          'reverting refunding → captured to retry',
      )
      await this.revertRefundingToCaptured(outreachId)
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
  // auth auto-expires within its ~7-day lifetime regardless). `settled: false`
  // means it did not void and the caller re-reads and retries — it lost the claim
  // (a capture advanced the row to captured, which the next attempt refunds), or
  // the post-claim PI re-read failed and it reverted voided → authorized rather
  // than void an unconfirmed (possibly captured) PI.
  private async voidAuthorized(
    outreachId: number,
    authorizationIntentId: string,
  ): Promise<{ settled: boolean; refunded: boolean }> {
    const claimed = await this.claim(
      outreachId,
      [P2pSmsSettleState.authorized],
      P2pSmsSettleState.voided,
    )
    if (!claimed) return { settled: false, refunded: false }

    // Re-read the live PI AFTER winning the void claim: a capture can have
    // landed even though we won the authorized → voided claim. A lost
    // capture-response reverts capturing → authorized while the PI is already
    // `succeeded`, so a cancel/deny whose first read saw `requires_capture` can
    // win this void claim with the charge already captured. NEVER leave a
    // captured charge stranded in `voided`: route it to the shared refund path.
    let intent: Stripe.PaymentIntent | null = null
    try {
      intent = await this.stripe.retrievePaymentIntent(authorizationIntentId)
    } catch (err) {
      // Can't confirm the live PI — and it may be `succeeded` (see above).
      // Voiding here would stamp a terminal `voided` over a captured charge and
      // strand it unrefunded while reporting refunded:false. Instead revert
      // voided → authorized and return not-settled so the outer release loop
      // re-reads and re-decides (refund when succeeded, or surface a retryable
      // 502 when reads keep failing, hold intact) — never void an unconfirmed PI.
      this.logger.warn(
        { err, outreachId },
        'win sms release: PI re-read before void failed; reverting ' +
          'voided → authorized for the release loop to re-decide',
      )
      await this.claim(
        outreachId,
        [P2pSmsSettleState.voided],
        P2pSmsSettleState.authorized,
      )
      return { settled: false, refunded: false }
    }

    if (intent?.status === 'succeeded') {
      this.logger.error(
        { outreachId },
        'CRITICAL win sms release: PI succeeded under a void claim ' +
          '(authorized/capturing serialization violated); refunding, not voiding',
      )
      // Undo the void claim so the shared charge-keyed refund path can claim it;
      // never issues a Stripe void (none was placed), so no inconsistency.
      const reverted = await this.model.updateMany({
        where: { outreachId, settleState: P2pSmsSettleState.voided },
        data: { settleState: P2pSmsSettleState.captured },
      })
      if (reverted.count === 0) return { settled: false, refunded: false }
      const satellite = await this.model.findUnique({
        where: { outreachId },
        select: {
          settleState: true,
          authorizationIntentId: true,
          chargeIntentId: true,
        },
      })
      if (!satellite) return { settled: false, refunded: false }
      const refunded = await this.refundCaptured(outreachId, satellite, intent)
      return { settled: refunded, refunded }
    }

    // Normal path: a live (or unreadable) hold → void best-effort. The row is
    // already terminally `voided` and the hold auto-expires within its ~7-day
    // auth lifetime, so a void failure never charges. The free-texts restore
    // must run REGARDLESS of the void outcome — symmetric with the refund path —
    // so a voidHold failure can never strand (burn) the offer this send redeemed.
    // voidHold swallows its own errors today; the catch guards that contract so
    // the restore below is unconditional even if it ever threw. A void that does
    // not land needs no reconcile: the row is terminal `voided` and the hold
    // auto-expires within the auth lifetime with no charge.
    try {
      await this.stripe.voidHold(authorizationIntentId)
    } catch (err) {
      this.logger.error(
        { err, outreachId },
        'win sms release: voidHold threw; hold auto-expires, offer still restored',
      )
    }
    await this.restoreFreeTextsBestEffort(outreachId)
    this.logger.info({ outreachId }, 'win sms hold voided')
    return { settled: true, refunded: false }
  }

  // Releases the in-flight refund claim back to captured so a later attempt
  // retries. The charge-keyed idempotency key makes that replay refund at most
  // once even if the reverted call had in fact landed at Stripe.
  private async revertRefundingToCaptured(outreachId: number): Promise<void> {
    await this.model.updateMany({
      where: { outreachId, settleState: P2pSmsSettleState.refunding },
      data: { settleState: P2pSmsSettleState.captured },
    })
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

  // Waits out another owner's in-flight `refunding` claim. Returns `refunded`
  // once the owner commits, `reattempt` once it reverts (to captured) or the row
  // otherwise leaves `refunding` so the caller claims the refund itself, or
  // `stranded` if it never resolves within the bound — the owner crashed between
  // the CAS claim and the Stripe call, which only the slice-F reconcile sweep can
  // safely finish.
  private async awaitRefundResolution(
    outreachId: number,
  ): Promise<'refunded' | 'reattempt' | 'stranded'> {
    for (let i = 0; i < REFUND_RESOLVE_POLL_ATTEMPTS; i++) {
      await new Promise((resolve) => setTimeout(resolve, refundResolvePollMs()))
      const row = await this.model.findUnique({
        where: { outreachId },
        select: { settleState: true },
      })
      if (!row) return 'reattempt'
      if (row.settleState === P2pSmsSettleState.refunded) return 'refunded'
      if (row.settleState !== P2pSmsSettleState.refunding) return 'reattempt'
    }
    return 'stranded'
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
          'the offer may be stuck consumed; a human must reconcile ' +
          '(win-sms-critical alert)',
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
  ): Promise<number> {
    try {
      const { count } = await this.client.outreach.updateMany({
        where: {
          id: outreachId,
          OR: [
            {
              status: {
                in: [OutreachStatus.pending, OutreachStatus.pending_payment],
              },
            },
            {
              status: OutreachStatus.in_progress,
              ...(attribution?.byAdmin
                ? {}
                : { approvedAt: null, canvassRequestedAt: null }),
            },
          ],
        },
        data: {
          status: OutreachStatus.canceled,
          canceledAt: new Date(),
          canceledBy: attribution?.canceledBy ?? null,
          canceledByAdmin: attribution?.byAdmin ?? false,
        },
      })
      return count
    } catch (err) {
      this.logger.error(
        { err, outreachId },
        'win sms release: failed to cancel spine after money release',
      )
      return 0
    }
  }

  // The money already settled elsewhere (a deny's release, another cancel), so
  // a cancel that flipped nothing must not report success over a spine that is
  // still live: a deny can release a hand-booked in_progress row the
  // candidate's guarded flip is not allowed to cancel. Already canceled is the
  // idempotent case and passes.
  private async assertSpineCanceled(
    outreachId: number,
    campaignId: number,
    flipped: number,
  ): Promise<void> {
    if (flipped > 0) return
    const spine = await this.client.outreach.findFirstOrThrow({
      where: { id: outreachId, campaignId },
    })
    if (spine.status === OutreachStatus.canceled) return
    const bookedPastSendTime =
      (spine.approvedAt !== null || spine.canvassRequestedAt !== null) &&
      spine.date !== null &&
      !isBefore(new Date(), spine.date)
    throw new BadRequestException(
      bookedPastSendTime
        ? 'This campaign has reached its send time and can no longer be ' +
            'canceled'
        : 'Only scheduled campaigns can be canceled',
    )
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
