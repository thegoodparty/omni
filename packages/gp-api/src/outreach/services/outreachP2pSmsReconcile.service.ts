import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { subMinutes } from 'date-fns'
import Stripe from 'stripe'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { StripeService } from 'src/vendors/stripe/services/stripe.service'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import {
  isWinSmsHoldBillingEnabled,
  P2P_SMS_REFUNDING_STALE_MINUTES,
} from '@/shared/util/winSmsHold.util'
import { OutreachStatus, P2pSmsSettleState } from '../../generated/prisma'
import { OutreachP2pSmsCancelService } from './outreachP2pSmsCancel.service'
import { OutreachP2pSmsFreeTextsService } from './outreachP2pSmsFreeTexts.service'

// Three Stripe-only slots that co-run with at most one light robocall job each
// (robocall holds :03/:13.., stranded 6,21,36,51, capture :02.., send :04..,
// etc.). All three are a sweep + per-record CAS, so a brief overlap is fine.
const P2P_SMS_REFUNDING_RECONCILE_CRON = '2,17,32,47 * * * *'
const P2P_SMS_DENIED_RECONCILE_CRON = '7,22,37,52 * * * *'
const P2P_SMS_STRANDED_RECONCILE_CRON = '12,27,42,57 * * * *'

// Stripe leaves latest_charge as a string id or an expanded Charge; normalize to
// the charge id the charge-keyed refund targets (same as the cancel service).
const resolveChargeId = (intent: Stripe.PaymentIntent): string | null => {
  const charge = intent.latest_charge
  if (!charge) return null
  return typeof charge === 'string' ? charge : charge.id
}

// A refund Stripe reports as money-on-its-way: `succeeded` is done, `pending` is
// committed and settling (cards settle near-instantly). Any other status did NOT
// move money and must never be stamped refunded — identical to the release path.
const isRefundCommitted = (status: Stripe.Refund['status'] | null): boolean =>
  status === 'succeeded' || status === 'pending'

// The slice-F reconcile sweeps for Win p2p SMS hold billing: the money safety
// net behind the live cancel/deny/capture release paths. Each heals a row the
// live paths deliberately left in a non-terminal state when their best-effort
// unwind crashed or lost a response — the three strands the release machinery
// marks as "for the reconcile sweep":
//
//   1. stranded `refunding` — the refund owner (a cancel or deny) crashed
//      between its single-owner CAS claim and the Stripe refund, so the money is
//      owed back but no refund is recorded. MONEY-OWED-BACK CRITICAL.
//   2. denied-but-unreleased — an admin deny committed the denial but its money
//      release (refund captured / void authorized) then failed after the point
//      no safe revert was possible, leaving the hold un-released.
//   3. stranded `authorized` — a past-due draft that never submitted to Peerly
//      (projectId null) and so can never send or capture, yet still reserves the
//      candidate's card on a live hold.
//
// Every sweep is prod-gated (real Stripe calls, stubbed off prod) AND flag-gated
// (ships inert until WIN_SMS_HOLD_BILLING is on), runs per-record under its own
// try/catch, and uses NO CronLockService — a per-record CAS elects one owner
// across replicas, so two replicas racing a sweep each SELECT the same rows but
// only one acts on each. @Cron (not @Interval) so the schedule survives deploys.
//
// MONEY SAFETY. No sweep ever stamps `refunded` without a committed refund
// (verified against Stripe first), issues a second refund for a charge already
// refunded (the stable charge-keyed key replays the pre-crash call at most once,
// and the pre-check avoids even that), or voids a hold on a send that could
// still go out (the `authorized → voided` claim plus a post-claim projectId
// re-read fence a finalize that submitted mid-sweep). A stale-claim guard means
// a sweep never races a release still in flight: it only touches a claim older
// than P2P_SMS_REFUNDING_STALE_MINUTES.
@Injectable()
export class OutreachP2pSmsReconcileService extends createPrismaBase(
  MODELS.OutreachP2pSms,
) {
  constructor(
    private readonly stripe: StripeService,
    private readonly cancelService: OutreachP2pSmsCancelService,
    private readonly freeTexts: OutreachP2pSmsFreeTextsService,
  ) {
    super()
  }

  // Sweep 1: resolve rows stranded in `refunding`. Money is owed back but the
  // owner never recorded a refund. Prod-only + flag-gated; per-record CAS elects
  // one owner, so no CronLockService.
  @Cron(P2P_SMS_REFUNDING_RECONCILE_CRON, {
    name: 'p2pSmsRefundingReconcileSweep',
    timeZone: EASTERN_TIMEZONE,
  })
  async sweepStrandedRefunding(): Promise<void> {
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') return
    if (!isWinSmsHoldBillingEnabled()) return

    const cutoff = subMinutes(new Date(), P2P_SMS_REFUNDING_STALE_MINUTES)
    const candidates = await this.model.findMany({
      where: {
        settleState: P2pSmsSettleState.refunding,
        updatedAt: { lt: cutoff },
      },
      select: { outreachId: true },
    })

    for (const { outreachId } of candidates) {
      try {
        await this.reconcileRefundingOne(outreachId, cutoff)
      } catch (err) {
        this.logger.error(
          { err, outreachId },
          'win sms reconcile: refunding reconcile failed for a row; continuing',
        )
      }
    }
  }

  private async reconcileRefundingOne(
    outreachId: number,
    cutoff: Date,
  ): Promise<void> {
    // Elect a single owner via a stale-guarded self-transition: @updatedAt
    // advances on every write, so a second replica's identical guard (updatedAt
    // still < cutoff) matches nothing. The stale bound also means we never claim
    // a refund a live owner is mid-flight on — only one crashed long ago.
    const claimed = await this.model.updateMany({
      where: {
        outreachId,
        settleState: P2pSmsSettleState.refunding,
        updatedAt: { lt: cutoff },
      },
      data: { settleState: P2pSmsSettleState.refunding },
    })
    if (claimed.count === 0) return

    const sat = await this.model.findUnique({
      where: { outreachId },
      select: { chargeIntentId: true, authorizationIntentId: true },
    })
    if (!sat) return

    // Resolve the durable charge id: the stamped one, else the live PI's charge
    // for a row whose capture commit was lost before it recorded the charge.
    let chargeId = sat.chargeIntentId
    if (!chargeId && sat.authorizationIntentId) {
      const intent = await this.stripe.retrievePaymentIntent(
        sat.authorizationIntentId,
      )
      chargeId = resolveChargeId(intent)
    }
    if (!chargeId) {
      this.logger.error(
        { outreachId },
        'CRITICAL win sms reconcile: refunding row carries no charge id; ' +
          'cannot reconcile the refund, needs a human',
      )
      return
    }

    // VERIFY against Stripe BEFORE acting: an owner that crashed AFTER the refund
    // landed leaves the money already back. Stamp refunded (idempotent) and
    // restore — never a second refund.
    const refunds = await this.stripe.listChargeRefunds(chargeId)
    if (refunds.some((refund) => isRefundCommitted(refund.status))) {
      await this.stampRefunded(outreachId)
      await this.restoreBestEffort(outreachId)
      this.logger.info(
        { outreachId, chargeId },
        'win sms reconcile: refunding row already refunded at Stripe; stamped',
      )
      return
    }

    // No refund on record → issue it under the SAME stable key, so if the
    // pre-crash call had in fact landed this replays it once rather than
    // double-refunding.
    let refund: Stripe.Response<Stripe.Refund>
    try {
      refund = await this.stripe.refundCharge(
        chargeId,
        `p2p-sms-refund-${chargeId}`,
      )
    } catch (err) {
      // Transient: leave the row `refunding` (the owner-claim bumped updatedAt,
      // so it waits out the stale window) for the next sweep. NEVER stamp
      // refunded without a committed refund.
      this.logger.error(
        { err, outreachId },
        'win sms reconcile: refund failed; leaving refunding to retry',
      )
      return
    }

    if (!isRefundCommitted(refund.status)) {
      this.logger.error(
        { outreachId, chargeId, status: refund.status },
        'win sms reconcile: refund not committed (status not succeeded/' +
          'pending); leaving refunding to retry',
      )
      return
    }

    await this.stampRefunded(outreachId)
    await this.restoreBestEffort(outreachId)
    this.logger.info(
      { outreachId, chargeId },
      'win sms reconcile: stranded refunding resolved to refunded',
    )
  }

  // Sweep 2: resolve admin-denied rows whose money release never ran. The denial
  // is committed (deniedAt set) but the hold is still `authorized`/`captured`.
  // Re-drive the SAME idempotent release the deny path calls — its own
  // single-owner CAS elects one owner across replicas and its guards refuse a
  // `capturing` row and revert a transient failure, so no separate CAS is needed
  // here; the stale bound keeps it off a deny release still in flight.
  @Cron(P2P_SMS_DENIED_RECONCILE_CRON, {
    name: 'p2pSmsDeniedReconcileSweep',
    timeZone: EASTERN_TIMEZONE,
  })
  async sweepDeniedUnreleased(): Promise<void> {
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') return
    if (!isWinSmsHoldBillingEnabled()) return

    const cutoff = subMinutes(new Date(), P2P_SMS_REFUNDING_STALE_MINUTES)
    const candidates = await this.model.findMany({
      where: {
        settleState: {
          in: [P2pSmsSettleState.authorized, P2pSmsSettleState.captured],
        },
        updatedAt: { lt: cutoff },
        outreach: { deniedAt: { not: null } },
      },
      select: { outreachId: true, outreach: { select: { campaignId: true } } },
    })

    for (const candidate of candidates) {
      const campaignId = candidate.outreach?.campaignId
      if (campaignId == null) continue
      try {
        await this.cancelService.releaseForDeny(
          candidate.outreachId,
          campaignId,
        )
      } catch (err) {
        // Per-record isolation. A `capturing` refusal or a transient Stripe
        // failure leaves the row for the next sweep; the release committed no
        // half-move either way.
        this.logger.error(
          { err, outreachId: candidate.outreachId },
          'win sms reconcile: denied-unreleased release failed; continuing',
        )
      }
    }
  }

  // Sweep 3: cancel + void a hold stranded in `authorized` on a past-due draft
  // that never finalized — still `pending_payment` with no `projectId`, so it
  // was never submitted to Peerly and can never send or capture. Its reserved
  // money would otherwise sit until the ~7-day auth expiry while the spine shows
  // "Scheduled" forever. CONSERVATIVE on purpose: ONLY a `pending_payment`,
  // past-due, projectId-null, authorized row (NOT `pending` — see the claim).
  @Cron(P2P_SMS_STRANDED_RECONCILE_CRON, {
    name: 'p2pSmsStrandedAuthorizedReconcileSweep',
    timeZone: EASTERN_TIMEZONE,
  })
  async sweepStrandedAuthorized(): Promise<void> {
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') return
    if (!isWinSmsHoldBillingEnabled()) return

    const now = new Date()
    const candidates = await this.model.findMany({
      where: {
        settleState: P2pSmsSettleState.authorized,
        outreach: {
          projectId: null,
          // pending_payment ONLY, never pending: a build-ready finalize claims
          // the draft pending_payment -> pending BEFORE it submits to Peerly
          // (claimDraftForFinalize, outreach.service.ts), so a `pending` row is
          // a finalize already in flight (or its backstop's to retry) — never
          // this sweep's to void.
          status: OutreachStatus.pending_payment,
          date: { lt: now },
        },
      },
      select: { outreachId: true, authorizationIntentId: true },
    })

    for (const { outreachId, authorizationIntentId } of candidates) {
      try {
        await this.voidStrandedAuthorized(outreachId, authorizationIntentId)
      } catch (err) {
        this.logger.error(
          { err, outreachId },
          'win sms reconcile: stranded-authorized void failed; continuing',
        )
      }
    }
  }

  private async voidStrandedAuthorized(
    outreachId: number,
    authorizationIntentId: string | null,
  ): Promise<void> {
    // RACE-CLOSING claim. A build-ready finalize of this same draft submits to
    // Peerly only AFTER claimDraftForFinalize moves the spine
    // `pending_payment -> pending`, and finalize never touches settleState — so
    // the spine `status` field is the one lock the void and the finalize share.
    // Claim it `pending_payment -> canceled` here: whichever of the two commits
    // first wins the row (same row, same guarded field), and the loser's claim
    // matches nothing. Winning therefore GUARANTEES the send was not and can no
    // longer be submitted, so voiding the hold can never destroy a hold for a
    // delivered send. The cancel and the satellite `authorized -> voided` stamp
    // commit in ONE transaction, so a crash can never leave the spine canceled
    // with the hold still recorded authorized. projectId:null is belt — finalize
    // stamps it only after it has already left pending_payment.
    const claimed = await this.client.$transaction(async (tx) => {
      const spine = await tx.outreach.updateMany({
        where: {
          id: outreachId,
          status: OutreachStatus.pending_payment,
          projectId: null,
        },
        data: { status: OutreachStatus.canceled, canceledAt: new Date() },
      })
      if (spine.count === 0) return false
      await tx.outreachP2pSms.updateMany({
        where: { outreachId, settleState: P2pSmsSettleState.authorized },
        data: { settleState: P2pSmsSettleState.voided },
      })
      return true
    })
    if (!claimed) return

    // Void best-effort: the satellite is already terminal `voided` and the hold
    // auto-expires within its ~7-day auth lifetime, so a void failure never
    // charges. Hand back any free-texts offer regardless — symmetric with the
    // cancel/deny void path.
    if (authorizationIntentId) {
      await this.stripe.voidHold(authorizationIntentId)
    }
    await this.restoreBestEffort(outreachId)
    this.logger.info(
      { outreachId },
      'win sms reconcile: canceled + voided a stranded pending_payment hold',
    )
  }

  private async stampRefunded(outreachId: number): Promise<void> {
    await this.model.updateMany({
      where: { outreachId, settleState: P2pSmsSettleState.refunding },
      data: { settleState: P2pSmsSettleState.refunded },
    })
  }

  // Idempotent free-texts restore. The money terminal already committed and the
  // restore is guarded per-send + per-campaign, so a transient failure is a loud
  // CRITICAL (surfaced by the win-sms-critical alert for a human) rather than a
  // reason to unwind a settled refund/void.
  private async restoreBestEffort(outreachId: number): Promise<void> {
    try {
      await this.freeTexts.restore(outreachId)
    } catch (err) {
      this.logger.error(
        { err, outreachId },
        'CRITICAL win sms reconcile: free-texts restore failed after unwind; ' +
          'the offer may be stuck consumed, needs a human',
      )
    }
  }
}
