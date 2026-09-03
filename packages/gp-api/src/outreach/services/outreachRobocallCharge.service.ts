import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { addDays, isAfter, isFuture } from 'date-fns'
import { RobocallChargeResponse } from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { calcRobocallTotalInCents } from '@/shared/util/robocallPricing.util'
import {
  ROBOCALL_MAX_SCHEDULE_DAYS,
  ROBOCALL_PER_RUN_CEILING_CENTS,
} from '@/shared/util/robocallHold.util'
import { AnalyticsService } from '@/analytics/analytics.service'
import {
  ROBOCALL_ESTIMATE_CHARGE_KIND,
  StripeChargeDeclinedError,
  StripeService,
} from '@/vendors/stripe/services/stripe.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import {
  Campaign,
  Organization,
  OutreachStatus,
  OutreachType,
  RobocallSettleState,
  User,
} from '../../generated/prisma'
import { OutreachRobocallService } from './outreachRobocall.service'
import { RobocallCardError } from './outreachRobocallHold.service'

// CONTINGENCY upfront-charge pay path (robocall-estimate-billing branch, NEVER
// main). Instead of the hold-then-capture-actual model, this charges the
// server-re-derived ESTIMATE in full, once, up front — off-session on the
// vaulted card with AUTOMATIC capture. There is no manual-capture hold, no
// capture-actual settlement, and no fresh-charge recovery on this path.
//
// The transition is single-owner and money-safe, mirroring the hold service's
// discipline: a conditional claim (pending_payment + no charge intent → paid)
// elects exactly one charger, the Stripe charge runs OUTSIDE any DB transaction,
// and a commit CAS (paid + no charge intent → the charge intent id) records it
// only if nothing moved underneath. NEVER DIAL UNPAID: the staging + send sweeps
// key on `paid` AND `chargeIntentId IS NOT NULL`, so the brief window where the
// row is `paid` but the charge is still in flight can never stage or dial.
@Injectable()
export class OutreachRobocallChargeService extends createPrismaBase(
  MODELS.OutreachRobocall,
) {
  constructor(
    private readonly robocallService: OutreachRobocallService,
    private readonly stripe: StripeService,
    private readonly analytics: AnalyticsService,
  ) {
    super()
  }

  async chargeEstimate(
    user: User,
    campaign: Campaign,
    organization: Organization,
    outreachId: number,
    paymentMethodId: string,
  ): Promise<RobocallChargeResponse> {
    const draft = await this.findFirst({
      where: {
        outreachId,
        outreach: {
          campaignId: campaign.id,
          outreachType: OutreachType.robocall,
        },
      },
      include: { outreach: true },
    })
    if (!draft) {
      throw new NotFoundException('Robocall draft not found for this campaign')
    }

    const sendAt = draft.outreach.date
    const voterFileFilterId = draft.outreach.voterFileFilterId
    if (!sendAt || voterFileFilterId == null) {
      throw new BadRequestException(
        'Robocall draft is missing a scheduled send or audience',
      )
    }

    // SCHEDULE GUARDS. A past send can never dial, and an over-horizon send would
    // drift out of sync with pricing/compliance/audience — refuse to take money
    // for either. (Unlike the hold model there is no 3-day window / deferred
    // path: the estimate is charged now regardless of how far ahead the send is.)
    if (!isFuture(sendAt)) {
      throw new BadRequestException(
        'The scheduled send time must be in the future',
      )
    }
    if (isAfter(sendAt, addDays(new Date(), ROBOCALL_MAX_SCHEDULE_DAYS))) {
      throw new BadRequestException(
        `The scheduled send time must be within ` +
          `${ROBOCALL_MAX_SCHEDULE_DAYS} days`,
      )
    }

    // CHARGE CLAIM (charge once): elect exactly one charger. Only a
    // pending_payment draft with no charge intent yet can transition to `paid`; a
    // concurrent winner or an already-advanced draft makes count 0 → return the
    // current state, no charge. charge_failed is a terminal (the candidate was
    // emailed), NOT re-claimed here — a new-card retry is a later slice.
    const claim = await this.model.updateMany({
      where: {
        outreachId,
        settleState: RobocallSettleState.pending_payment,
        chargeIntentId: null,
      },
      data: { settleState: RobocallSettleState.paid },
    })
    if (claim.count === 0) {
      return this.currentStateResult(outreachId, draft.settleState)
    }

    // We own the `paid` claim but the charge is NOT placed yet (chargeIntentId is
    // still null, so no sweep can stage/dial this row). Every failure BEFORE the
    // charge lands must release the claim back to pending_payment — no money
    // moved, so no idempotency key was consumed and a retry re-charges cleanly.
    let estimate: number
    let customerId: string
    try {
      const billableCount = await this.robocallService.deriveBillableCount(
        organization,
        voterFileFilterId,
      )
      this.robocallService.assertReachableCount(billableCount)
      // Total = per-call cost + the flat number-rental fee (charged in full up
      // front on this branch — there is no zero-connect release).
      estimate = calcRobocallTotalInCents(billableCount)

      // INV-2: the TESTING ceiling. An estimate over it is a human-alert anomaly,
      // not something to silently charge.
      if (estimate > ROBOCALL_PER_RUN_CEILING_CENTS) {
        this.logger.error(
          { outreachId, estimate, ceiling: ROBOCALL_PER_RUN_CEILING_CENTS },
          'robocall estimate over per-run ceiling',
        )
        throw new ConflictException(
          'Robocall estimate exceeds the per-run limit',
        )
      }

      customerId = await this.stripe.ensureCustomer(user)
      const pm = await this.stripe.retrievePaymentMethod(paymentMethodId)
      if (pm.customer !== customerId) {
        throw new RobocallCardError(
          'That payment method is not on file for this account',
        )
      }
      // Cards only: an off-session charge on a vaulted bank debit would settle as
      // ACH (delayed, returnable), not the immediate card capture this model
      // relies on. The vault SetupIntent already pins cards; this is defense in
      // depth.
      if (pm.type !== 'card') {
        throw new RobocallCardError('Only a card can pay for a robocall')
      }
    } catch (err) {
      await this.revertClaim(outreachId)
      throw err
    }

    // CHARGE (outside any DB transaction). Stable idempotency key per outreach so
    // a retry after a transient infra failure REPLAYS the same PaymentIntent
    // instead of charging twice.
    let charged: { paymentIntentId: string }
    try {
      charged = await this.stripe.createOffSessionCharge({
        customerId,
        paymentMethodId,
        amountInCents: estimate,
        robocallId: outreachId,
        metadata: {
          outreachId: String(outreachId),
          campaignId: String(campaign.id),
          userId: String(user.id),
        },
        idempotencyKey: `robocall-estimate-charge-${outreachId}`,
        chargeKind: ROBOCALL_ESTIMATE_CHARGE_KIND,
      })
    } catch (err) {
      if (err instanceof StripeChargeDeclinedError) {
        // A decline is a business outcome, not a 502: move to the charge_failed
        // terminal and email the candidate once. Record the declined PI id (the
        // confirm creates the PI before the decline) so a later dispute/refund
        // webhook can reconcile it — charge_failed is not re-claimed, so leaving
        // it set never blocks anything.
        return this.transitionToChargeFailed(
          user.id,
          outreachId,
          err.paymentIntentId,
        )
      }
      // Infra failure (502): we do not know whether the charge landed. Revert to
      // pending_payment WITHOUT a charge intent (no state advance) so a retry
      // re-charges under the SAME idempotency key — Stripe replays a PI that may
      // in fact have succeeded, so the retry can never double-charge.
      await this.revertClaim(outreachId)
      throw err
    }

    // SUCCESS COMMIT: record the charge on the `paid` row we own. Guarded on
    // `paid` AND chargeIntentId null so it writes exactly once; capturedAmountIn-
    // Cents is the charged total (the whole estimate — there is no capture-actual
    // on this branch), matching the receipt convention. This is also the first
    // moment the row satisfies the staging/send eligibility (chargeIntentId set).
    const commit = await this.model.updateMany({
      where: {
        outreachId,
        settleState: RobocallSettleState.paid,
        chargeIntentId: null,
      },
      data: {
        chargeIntentId: charged.paymentIntentId,
        capturedAmountInCents: estimate,
        paymentMethodId,
        stripeCustomerId: customerId,
      },
    })
    if (commit.count === 0) {
      // Money already captured at Stripe, but the commit matched no row. Nothing
      // else moves a `paid` + chargeIntentId-null row (staging/send require a
      // charge intent, the detach-cancel webhook excludes `paid`), so this should
      // be impossible; the stable idempotency key means any concurrent path
      // replayed the SAME PI, so it is never a second charge. Surface it CRITICAL
      // for a human to reconcile rather than silently swallow moved money.
      this.logger.error(
        { outreachId, chargeIntentId: charged.paymentIntentId, estimate },
        'CRITICAL robocall estimate charged at Stripe but commit found no ' +
          'paid row; charge may be unrecorded — reconcile by hand',
      )
      return this.currentStateResult(outreachId, draft.settleState)
    }

    // The charge committed, so this is a real scheduled send: make it visible in
    // the history list, then emit the receipt once.
    await this.markSpineScheduled(outreachId)
    await this.emitReceipt(user.id, outreachId, estimate)
    return {
      status: 'paid',
      settleState: RobocallSettleState.paid,
      chargedAmountInCents: estimate,
    }
  }

  // Releases the `paid` claim back to pending_payment when the charge did not
  // land (a pre-charge validation error, or a transient infra failure). CAS'd on
  // `paid` + chargeIntentId null so a committed row is never reverted.
  private async revertClaim(outreachId: number): Promise<void> {
    await this.model.updateMany({
      where: {
        outreachId,
        settleState: RobocallSettleState.paid,
        chargeIntentId: null,
      },
      data: { settleState: RobocallSettleState.pending_payment },
    })
  }

  // The declined-card terminal + the ChargeFailed "update your card" email. CAS'd
  // on the `paid` claim we own so a lost race writes nothing and emits nothing.
  private async transitionToChargeFailed(
    userId: number,
    outreachId: number,
    declinedPaymentIntentId: string | null,
  ): Promise<RobocallChargeResponse> {
    await this.model.updateMany({
      where: { outreachId, settleState: RobocallSettleState.paid },
      data: {
        settleState: RobocallSettleState.charge_failed,
        ...(declinedPaymentIntentId
          ? { chargeIntentId: declinedPaymentIntentId }
          : {}),
      },
    })
    await this.emitChargeFailed(userId, outreachId)
    return {
      status: 'charge_failed',
      settleState: RobocallSettleState.charge_failed,
      chargedAmountInCents: null,
    }
  }

  // Advances the spine pending_payment → pending so a charged robocall shows in
  // the history list (findByCampaignId filters pending_payment out). Guarded on
  // pending_payment: idempotent, never flips an unpaid/already-visible row.
  // Best-effort (mirrors the hold service): the charge already committed, so a
  // transient failure must not 500 a money-succeeded request — a 500 sends the
  // retry to the claim CAS's noop path, which never re-charges. A miss only
  // leaves the row hidden; log it.
  private async markSpineScheduled(outreachId: number): Promise<void> {
    try {
      await this.client.outreach.updateMany({
        where: { id: outreachId, status: OutreachStatus.pending_payment },
        data: { status: OutreachStatus.pending },
      })
    } catch (err) {
      this.logger.error(
        { err, outreachId },
        'robocall: failed to advance spine to pending for history',
      )
    }
  }

  // The no-charge-placed result: report the satellite's live state so a caller
  // that lost the claim (or double-clicked an already-paid draft) learns the
  // truth. A `paid` draft reports paid + its charged amount so a retry reads as
  // success, not a spurious failure.
  private async currentStateResult(
    outreachId: number,
    fallback: RobocallSettleState,
  ): Promise<RobocallChargeResponse> {
    const current = await this.findFirst({ where: { outreachId } })
    const settleState = current?.settleState ?? fallback
    // charge_failed is a distinct status the UI acts on (prompt for a new card);
    // don't flatten it into 'noop' (a concurrent-charge / already-moved race).
    const status =
      settleState === RobocallSettleState.paid
        ? 'paid'
        : settleState === RobocallSettleState.charge_failed
          ? 'charge_failed'
          : 'noop'
    return {
      status,
      settleState,
      chargedAmountInCents:
        status === 'paid' ? (current?.capturedAmountInCents ?? null) : null,
    }
  }

  // Emits the receipt with a deterministic Segment messageId so a replay dedups
  // to one email. Best-effort: the charge already committed, so a transient
  // Segment failure must log and continue, never throw and re-run the charge
  // path. Dollars, not cents (HubSpot stores the value as-is).
  private async emitReceipt(
    userId: number,
    outreachId: number,
    chargedAmountInCents: number,
  ): Promise<void> {
    const capturedAmountInDollars = Math.round(chargedAmountInCents) / 100
    try {
      await this.analytics.track(
        userId,
        EVENTS.Robocall.Receipt,
        { outreachId, capturedAmountInDollars },
        undefined,
        `${outreachId}:receipt`,
      )
    } catch (err) {
      this.logger.error(
        { err, outreachId },
        'robocall receipt milestone emit failed',
      )
    }
  }

  // Emits the ChargeFailed "update your card" milestone once. Best-effort and
  // deterministic messageId, mirroring the hold service's HoldFailed emit.
  private async emitChargeFailed(
    userId: number,
    outreachId: number,
  ): Promise<void> {
    try {
      await this.analytics.track(
        userId,
        EVENTS.Robocall.ChargeFailed,
        { outreachId },
        undefined,
        `${outreachId}:charge_failed`,
      )
    } catch (err) {
      this.logger.error(
        { err, outreachId, event: EVENTS.Robocall.ChargeFailed },
        'robocall charge_failed milestone emit failed',
      )
    }
  }
}
