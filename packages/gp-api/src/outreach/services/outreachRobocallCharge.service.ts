import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { addDays, isAfter, isFuture, subMinutes } from 'date-fns'
import { RobocallChargeResponse } from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { calcRobocallTotalInCents } from '@/shared/util/robocallPricing.util'
import {
  ROBOCALL_ESTIMATE_CLAIM_STALE_MINUTES,
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

    // FREEZE THE ESTIMATE AT CLAIM. Re-deriving the estimate on every call —
    // including the retry after a transient/lost-response charge that reverted the
    // row to pending_payment — is the money-safety bug: if the first charge
    // actually landed at Stripe (response lost) AND the billable count shifted
    // inside Stripe's 24h idempotency window, the retry would send the SAME
    // idempotency key with a DIFFERENT amount, which Stripe rejects as
    // keys-must-match (an ERROR, not a decline) → treated as infra → revert → an
    // endless loop with money already captured. So derive ONCE and pin the value
    // onto the row; a reverted row keeps it and every later path (the retry, the
    // committed capturedAmountInCents, the idempotent replay amount) REUSES it.
    // authorizedAmountInCents is the schema's frozen-estimate column, unused by
    // this charge path otherwise (the hold model freezes into it the same way).
    let estimate = draft.authorizedAmountInCents
    if (estimate == null) {
      const billableCount = await this.robocallService.deriveBillableCount(
        organization,
        voterFileFilterId,
      )
      this.robocallService.assertReachableCount(billableCount)
      // Total = per-call cost + the flat number-rental fee (charged in full up
      // front on this branch — there is no zero-connect release).
      estimate = calcRobocallTotalInCents(billableCount)
    }

    // INV-2: the TESTING ceiling, checked against the FROZEN value BEFORE any
    // charge. An estimate over it is a human-alert anomaly, not something to
    // silently charge.
    if (estimate > ROBOCALL_PER_RUN_CEILING_CENTS) {
      this.logger.error(
        { outreachId, estimate, ceiling: ROBOCALL_PER_RUN_CEILING_CENTS },
        'robocall estimate over per-run ceiling',
      )
      throw new ConflictException('Robocall estimate exceeds the per-run limit')
    }

    // CHARGE CLAIM (charge once) + FREEZE in one write: elect exactly one charger
    // AND pin the estimate atomically, so two concurrent first-claims cannot pin
    // divergent amounts and a retry cannot re-derive one. Only a pending_payment
    // draft with no charge intent yet can transition to `paid`; a concurrent
    // winner or an already-advanced draft makes count 0 → return the current
    // state, no charge. charge_failed is a terminal (the candidate was emailed),
    // NOT re-claimed here — a new-card retry is a later slice.
    const claim = await this.model.updateMany({
      where: {
        outreachId,
        settleState: RobocallSettleState.pending_payment,
        chargeIntentId: null,
      },
      data: {
        settleState: RobocallSettleState.paid,
        authorizedAmountInCents: estimate,
        // Persist the card AT CLAIM (not just at the success commit) so an
        // orphaned claim — a crash after this write but before the commit —
        // carries the payment method the recovery sweep needs to RESUME the
        // charge under the stable key. Safe against the detach webhook: its
        // NOT_YET_DIALED_STATES excludes `paid`, so a `paid` row with a card set
        // is never selected for a detach-cancel.
        paymentMethodId,
      },
    })
    if (claim.count === 0) {
      return this.currentStateResult(outreachId, draft.settleState)
    }

    // We own the `paid` claim but the charge is NOT placed yet (chargeIntentId is
    // still null, so no sweep can stage/dial this row). Every failure BEFORE the
    // charge lands must release the claim back to pending_payment — no money
    // moved, so no idempotency key was consumed and a retry re-charges cleanly
    // under the SAME frozen amount + key.
    let customerId: string
    try {
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

    // SUCCESS COMMIT (shared with the orphan-resume path): record the charge on
    // the `paid` row we own.
    return this.commitEstimateCharge(
      user.id,
      outreachId,
      estimate,
      paymentMethodId,
      customerId,
      charged.paymentIntentId,
    )
  }

  // RECOVERY for an ORPHANED claim: a chargeEstimate that won the
  // pending_payment -> paid claim (freezing authorizedAmountInCents + persisting
  // paymentMethodId) but crashed AFTER the claim and BEFORE its commit / decline
  // / revert — leaving the row `paid` with chargeIntentId STILL NULL. Nothing
  // else recovers it: staging/send require chargeIntentId, sweepStrandedPaid
  // requires chargeIntentId NOT null, the detach webhook excludes `paid`,
  // revertClaim never ran. If the lost charge was one Stripe ACTUALLY captured,
  // money was taken and never delivered. This RESUMES the charge under the SAME
  // stable idempotency key + SAME frozen amount, so a captured charge replays the
  // SAME PaymentIntent (never a second charge) and an un-landed one charges
  // exactly once; on success it commits chargeIntentId so staging can finally
  // dial the paid run. A genuine decline (Stripe never captured under the key)
  // routes to the same charge_failed + email terminal the live path uses; a
  // card-revalidation or transient charge failure LEAVES the row `paid`
  // (chargeIntentId null) for the next sweep — never reverting a possibly-
  // captured orphan.
  async resumeStrandedEstimateCharge(outreachId: number): Promise<void> {
    // Single-owner reclaim: a stale-guarded self-transition (writing `paid` bumps
    // @updatedAt, so a concurrent replica finds updatedAt no longer < cutoff and
    // loses) elects exactly one resumer, mirroring the hold_pending recovery.
    const staleCutoff = subMinutes(
      new Date(),
      ROBOCALL_ESTIMATE_CLAIM_STALE_MINUTES,
    )
    const reclaim = await this.model.updateMany({
      where: {
        outreachId,
        settleState: RobocallSettleState.paid,
        chargeIntentId: null,
        updatedAt: { lt: staleCutoff },
      },
      data: { settleState: RobocallSettleState.paid },
    })
    if (reclaim.count === 0) return

    const draft = await this.findFirst({
      where: { outreachId },
      include: {
        outreach: { include: { campaign: { include: { user: true } } } },
      },
    })
    // Re-check the orphan invariant under the loaded row: only a `paid` row with
    // no committed charge, a frozen amount, and a persisted card can be resumed.
    if (
      !draft ||
      draft.authorizedAmountInCents == null ||
      draft.paymentMethodId == null
    ) {
      this.logger.error(
        { outreachId },
        'CRITICAL robocall estimate resume: claimed orphan missing frozen ' +
          'amount or card; cannot resume — reconcile by hand',
      )
      return
    }
    const user = draft.outreach.campaign?.user
    const campaign = draft.outreach.campaign
    if (!user || !campaign) {
      this.logger.error(
        { outreachId },
        'CRITICAL robocall estimate resume: orphaned paid claim missing ' +
          'user/campaign; cannot resume — reconcile by hand',
      )
      return
    }

    const estimate = draft.authorizedAmountInCents
    const paymentMethodId = draft.paymentMethodId

    // Re-derive the customer + re-validate the persisted card exactly as the live
    // path does. A validation failure LEAVES the row `paid` (a charge may have
    // been captured under the key) for the next sweep — never revert or fail.
    let customerId: string
    try {
      customerId = await this.stripe.ensureCustomer(user)
      const pm = await this.stripe.retrievePaymentMethod(paymentMethodId)
      if (pm.customer !== customerId || pm.type !== 'card') {
        throw new RobocallCardError('Persisted card is no longer chargeable')
      }
    } catch (err) {
      if (err instanceof RobocallCardError) {
        // A permanently-unusable card (detached / foreign / non-card) can
        // never be revalidated, so this orphan would loop through the sweep
        // forever unseen. A capture may already have landed under the stable
        // key, so page ops to reconcile a possible manual refund and leave the
        // row `paid` — never charge_failed, which would imply no money moved.
        this.logger.error(
          { err, outreachId },
          'CRITICAL robocall estimate resume: orphaned paid claim card is ' +
            'permanently unusable; a capture may have landed under the ' +
            'idempotency key — reconcile a possible manual refund by hand',
        )
        return
      }
      // Transient infra (a lost Stripe read): leave the row `paid` quietly for
      // the next sweep — no paging, no state change.
      this.logger.error(
        { err, outreachId },
        'robocall estimate resume: card re-validation failed; leaving paid ' +
          'for the next sweep',
      )
      return
    }

    // RESUME under the SAME stable key + SAME frozen amount: a prior capture
    // replays the SAME PaymentIntent (no second charge), an un-landed one charges
    // exactly once.
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
        // Under the stable key Stripe REPLAYS a prior success, so a decline here
        // proves nothing was ever captured — route to the same terminal the live
        // decline uses (charge_failed + one ChargeFailed email).
        await this.transitionToChargeFailed(
          user.id,
          outreachId,
          err.paymentIntentId,
        )
        return
      }
      // Transient infra: unknown whether the charge landed. LEAVE the row `paid`
      // (chargeIntentId null) so this sweep re-picks it and replays the same key
      // — never revert a possibly-captured orphan to pending_payment.
      this.logger.error(
        { err, outreachId },
        'robocall estimate resume: transient charge failure; leaving paid ' +
          'for the next sweep',
      )
      return
    }

    await this.commitEstimateCharge(
      user.id,
      outreachId,
      estimate,
      paymentMethodId,
      customerId,
      charged.paymentIntentId,
    )
  }

  // The success commit for BOTH the live charge and the orphan resume: record the
  // charge on the `paid` row we own. Guarded on `paid` AND chargeIntentId null so
  // it writes exactly once; capturedAmountInCents is the charged total (the whole
  // estimate — there is no capture-actual on this branch), matching the receipt
  // convention. This is also the first moment the row satisfies the staging/send
  // eligibility (chargeIntentId set), so it can finally dial.
  private async commitEstimateCharge(
    userId: number,
    outreachId: number,
    estimate: number,
    paymentMethodId: string,
    customerId: string,
    paymentIntentId: string,
  ): Promise<RobocallChargeResponse> {
    const commit = await this.model.updateMany({
      where: {
        outreachId,
        settleState: RobocallSettleState.paid,
        chargeIntentId: null,
      },
      data: {
        chargeIntentId: paymentIntentId,
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
        { outreachId, chargeIntentId: paymentIntentId, estimate },
        'CRITICAL robocall estimate charged at Stripe but commit found no ' +
          'paid row; charge may be unrecorded — reconcile by hand',
      )
      return this.currentStateResult(outreachId, RobocallSettleState.paid)
    }

    // The charge committed, so this is a real scheduled send: make it visible in
    // the history list, then emit the receipt once.
    await this.markSpineScheduled(outreachId)
    await this.emitReceipt(userId, outreachId, estimate)
    return {
      status: 'paid',
      settleState: RobocallSettleState.paid,
      chargedAmountInCents: estimate,
    }
  }

  // The estimate-billing analogue of the hold model's failSend, for a run that
  // CHARGED its estimate up front (`paid`) but whose send passed while still
  // UN-staged (`callhubCampaignPkStr` NULL) — a strand no staging/send sweep
  // catches, so it would sit in `paid` forever with money captured, zero calls
  // placed, and nothing surfaced. There is deliberately NO auto-refund on this
  // contingency branch, so this: (1) moves the row to the `send_failed` terminal
  // no sweep re-picks, (2) logs `CRITICAL robocall` so ops is paged for a MANUAL
  // refund decision, and (3) emails the candidate the run did not go out. The CAS
  // matches ONLY `paid` + `chargeIntentId IS NOT NULL` + `callhubCampaignPkStr`
  // NULL, so it can never race an in-flight staging/send that has already claimed
  // the row (it moves to `staging`/`dialing` or sets a pk_str) — mirroring the
  // reason-conditional discipline the stranded-authorized sweep uses.
  async failStrandedEstimate(outreachId: number): Promise<void> {
    const draft = await this.findFirst({
      where: { outreachId },
      include: { outreach: { include: { campaign: true } } },
    })
    if (!draft) return

    const claim = await this.model.updateMany({
      where: {
        outreachId,
        settleState: RobocallSettleState.paid,
        chargeIntentId: { not: null },
        callhubCampaignPkStr: null,
      },
      data: { settleState: RobocallSettleState.send_failed },
    })
    // count 0: a staging/send run claimed it, or another runner already failed it
    // — do not double-terminate or double-email.
    if (claim.count === 0) return

    // The `win-robocall-critical` alert pages win-bugs on this `CRITICAL robocall`
    // line (deploy/components/alerts.ts). The estimate was captured up front and
    // the run never dialed, so a human must decide the refund — this branch never
    // auto-refunds.
    this.logger.error(
      { outreachId },
      'CRITICAL robocall send_failed: estimate charged up front but the run ' +
        'never staged before its send; NO calls placed and NO auto-refund — ' +
        'reconcile a manual refund by hand',
    )

    await this.markSpineFailed(outreachId)
    // Outreach.campaign is nullable (campaign-less Serve orgs), but a robocall is
    // always campaign-scoped; guard defensively and only email a resolvable user.
    const userId = draft.outreach.campaign?.userId
    if (userId != null) {
      await this.emitSendFailed(userId, outreachId)
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

  // Flips the spine to `failed` so the history shows "Couldn't send" for a
  // stranded charged run. Guarded on the pre-terminal visible states (never
  // overrides canceled/completed). Best-effort, like markSpineScheduled.
  private async markSpineFailed(outreachId: number): Promise<void> {
    try {
      await this.client.outreach.updateMany({
        where: {
          id: outreachId,
          status: {
            in: [OutreachStatus.pending, OutreachStatus.pending_payment],
          },
        },
        data: { status: OutreachStatus.failed },
      })
    } catch (err) {
      this.logger.error(
        { err, outreachId },
        'robocall: failed to flip spine to failed',
      )
    }
  }

  // Emits the SendFailed "we couldn't send" milestone once, deterministic
  // messageId, best-effort — mirrors the hold service's send_failed emit so the
  // candidate is told the charged run did not go out.
  private async emitSendFailed(
    userId: number,
    outreachId: number,
  ): Promise<void> {
    try {
      await this.analytics.track(
        userId,
        EVENTS.Robocall.SendFailed,
        { outreachId },
        undefined,
        `${outreachId}:send_failed`,
      )
    } catch (err) {
      this.logger.error(
        { err, outreachId, event: EVENTS.Robocall.SendFailed },
        'robocall send_failed milestone emit failed',
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
