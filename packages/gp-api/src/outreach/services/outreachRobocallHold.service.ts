import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { addDays, addHours, isAfter } from 'date-fns'
import { RobocallAuthorizeResponse } from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { calcRobocallTotalInCents } from '@/shared/util/robocallPricing.util'
import {
  ROBOCALL_HOLD_WINDOW_DAYS,
  ROBOCALL_PER_RUN_CEILING_CENTS,
  ROBOCALL_RUN_HOURS,
  ROBOCALL_SETTLE_MARGIN_HOURS,
} from '@/shared/util/robocallHold.util'
import { AnalyticsService } from '@/analytics/analytics.service'
import {
  StripeHoldDeclinedError,
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
import { RobocallOrphanedCampaignService } from './robocallOrphanedCampaign.service'
import {
  OrphanHoldReason,
  RobocallOrphanedHoldService,
} from './robocallOrphanedHold.service'
import { OutreachRobocallSingleSendService } from './outreachRobocallSingleSend.service'

// A card-validation failure on the hold path (foreign / non-card / missing
// saved card). Extends BadRequestException so on-session /authorize still
// returns 400, but its distinct type lets the deferred sweep escalate ONLY
// genuine permanent card problems to hold_failed — a reschedule-race ("payment
// method required") or a zero-audience BadRequestException stays retryable
// rather than falsely terminating the run and emailing the candidate about a
// card that is fine.
export class RobocallCardError extends BadRequestException {}

// Places the pay-time authorization hold on a scheduled robocall draft: a
// manual-capture Stripe hold for the server-re-derived estimate, off-session on
// the vaulted card. This RESERVES REAL MONEY. The transition is single-owner:
// a conditional claim (pending_payment → hold_pending) elects one placer, the
// Stripe hold runs OUTSIDE any DB transaction, and a second conditional claim
// (hold_pending → authorized) commits the ids only if nothing moved underneath.
// No capture, no CallHub, no deferred sweep, no reminder/retry/cancel here.
@Injectable()
export class OutreachRobocallHoldService extends createPrismaBase(
  MODELS.OutreachRobocall,
) {
  constructor(
    private readonly robocallService: OutreachRobocallService,
    private readonly stripe: StripeService,
    private readonly analytics: AnalyticsService,
    private readonly orphanedCampaigns: RobocallOrphanedCampaignService,
    private readonly orphanedHolds: RobocallOrphanedHoldService,
    private readonly robocallSingleSend: OutreachRobocallSingleSendService,
  ) {
    super()
  }

  // Records a hold whose best-effort void may not have landed, so the reconcile
  // sweep confirms and re-voids it. Best-effort: a reserved hold is not a charge,
  // so a lost record only defers release to the auth expiry and must never fail
  // the placement path (whose money outcome already committed).
  private async recordOrphanHold(
    paymentIntentId: string,
    outreachId: number,
    reason: OrphanHoldReason,
  ): Promise<void> {
    try {
      await this.orphanedHolds.record(paymentIntentId, outreachId, reason)
    } catch (err) {
      this.logger.error(
        { err, outreachId, paymentIntentId },
        'robocall: failed to record orphaned hold for reconcile',
      )
    }
  }

  // `paymentMethodId` is supplied by the on-session /authorize (the candidate's
  // chosen card). The deferred sweep passes NONE: the authoritative card was
  // persisted on the row at defer time and is re-read AFTER the placement claim
  // (below) so a concurrent re-authorize can't make the sweep bill a stale card.
  async authorizeHold(
    user: User,
    campaign: Campaign,
    organization: Organization,
    outreachId: number,
    paymentMethodId?: string,
  ): Promise<RobocallAuthorizeResponse> {
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

    // WINDOW: a hold placed too far ahead would expire before the send. Beyond
    // the window, defer to the daily sweep — place nothing now, but PERSIST the
    // card the candidate chose so the sweep bills exactly it, never a guessed
    // default. Validate the PM the SAME way the immediate path does; a bad PM
    // must persist nothing. This stores WHICH card to later charge — it places
    // no hold and moves no money, and the draft stays pending_payment.
    if (isAfter(sendAt, addDays(new Date(), ROBOCALL_HOLD_WINDOW_DAYS))) {
      // Defer is only reachable on-session (the sweep only calls in-window), so
      // a PM is always supplied here; guard narrows the type and is defensive.
      if (!paymentMethodId) {
        throw new BadRequestException(
          'A payment method is required to schedule a robocall hold',
        )
      }
      const customerId = await this.stripe.ensureCustomer(user)
      const pm = await this.stripe.retrievePaymentMethod(paymentMethodId)
      if (pm.customer !== customerId) {
        throw new RobocallCardError(
          'That payment method is not on file for this account',
        )
      }
      if (pm.type !== 'card') {
        throw new RobocallCardError('Only a card can authorize a robocall hold')
      }
      // CAS-guarded persist: after the two async Stripe validations a concurrent
      // request could have rescheduled this send into the window and advanced
      // the row past pending_payment. Only write while still pending_payment, so
      // we never clobber the chosen card on an already-authorized row.
      const persisted = await this.model.updateMany({
        where: { outreachId, settleState: RobocallSettleState.pending_payment },
        data: { paymentMethodId, stripeCustomerId: customerId },
      })
      // count 0 means the row advanced under us (a concurrent in-window
      // authorize placed or failed the hold). Report its live state, not a stale
      // 'deferred' that would tell the client no hold exists when one does.
      if (persisted.count === 0) {
        return this.currentStateResult(outreachId, draft.settleState)
      }
      // Card saved and the send is committed (the hold lands later, when the
      // deferred sweep runs in-window). Make the row visible now.
      await this.markSpineScheduled(outreachId)
      return {
        status: 'deferred',
        settleState: RobocallSettleState.pending_payment,
        authorizedAmountInCents: null,
      }
    }

    // PLACEMENT CLAIM: elect exactly one placer. Only a pending_payment draft
    // with no intent yet can transition to hold_pending; a concurrent winner or
    // an already-advanced draft makes count 0.
    const claim = await this.model.updateMany({
      where: {
        outreachId,
        // A declined draft (hold_failed) re-enters placement with a new card —
        // that IS the new-card retry. Both states carry no authorizationIntentId
        // (an already-authorized draft is excluded, so no second hold).
        settleState: {
          in: [
            RobocallSettleState.pending_payment,
            RobocallSettleState.hold_failed,
          ],
        },
        authorizationIntentId: null,
      },
      data: { settleState: RobocallSettleState.hold_pending },
    })
    if (claim.count === 0) {
      return this.currentStateResult(outreachId, draft.settleState)
    }

    // We own the hold_pending claim. Every failure path from here must release
    // it (revert to pending_payment) so the draft is never stranded — except a
    // card decline, which is a terminal hold_failed the caller resolves with a
    // new card.
    let estimate: number
    let customerId: string
    let holdPaymentMethodId: string
    // The validated card, set once validation passes (with-PM paths only). A
    // failure AFTER this point folds it into the revert so the row lands back in
    // pending_payment carrying the NEW card even if the persist write itself
    // threw — never a stale declined card the deferred sweep would re-charge.
    let validatedCard:
      | { paymentMethodId: string; stripeCustomerId: string }
      | undefined
    try {
      const billableCount = await this.robocallService.deriveBillableCount(
        organization,
        voterFileFilterId,
      )
      this.robocallService.assertReachableCount(billableCount)
      // Total = per-call cost + the flat number-rental fee (the fee is part of
      // every authorized hold).
      estimate = calcRobocallTotalInCents(billableCount)

      // INV-2: a TESTING ceiling. An estimate over it is a human-alert anomaly,
      // not something to silently authorize.
      if (estimate > ROBOCALL_PER_RUN_CEILING_CENTS) {
        this.logger.error(
          { outreachId, estimate, ceiling: ROBOCALL_PER_RUN_CEILING_CENTS },
          'robocall estimate over per-run ceiling',
        )
        throw new ConflictException(
          'Robocall estimate exceeds the per-run limit',
        )
      }

      // Resolve the card to hold against. On-session: the caller's chosen PM.
      // Deferred sweep (no PM passed): the card persisted at defer time, re-read
      // HERE — the claim above made the row ours, so this reads the value as of
      // the claim, not a pre-claim snapshot a concurrent re-persist could have
      // replaced (that write can't touch a hold_pending row). A cleared/absent
      // persisted card is a permanent problem the sweep escalates to hold_failed.
      if (paymentMethodId) {
        holdPaymentMethodId = paymentMethodId
        customerId = await this.stripe.ensureCustomer(user)
      } else {
        const claimed = await this.findFirst({ where: { outreachId } })
        if (!claimed?.paymentMethodId || !claimed.stripeCustomerId) {
          throw new RobocallCardError(
            'No saved card to authorize the deferred robocall hold',
          )
        }
        holdPaymentMethodId = claimed.paymentMethodId
        customerId = claimed.stripeCustomerId
      }
      const pm = await this.stripe.retrievePaymentMethod(holdPaymentMethodId)
      if (pm.customer !== customerId) {
        throw new RobocallCardError(
          'That payment method is not on file for this account',
        )
      }
      // Cards only, made explicit: an off-session manual-capture hold on a
      // non-card PM (e.g. a vaulted bank debit) would not reserve capturable
      // funds. The vault SetupIntent already pins cards, so this is defense in
      // depth against a non-card PM reaching the create call.
      if (pm.type !== 'card') {
        throw new RobocallCardError('Only a card can authorize a robocall hold')
      }
      // Persist the VALIDATED card + customer onto the claimed row (only for a
      // supplied card; the deferred path already has them persisted). Written
      // AFTER validation so a foreign/non-card PM — which throws above — is never
      // stored, and BEFORE the Stripe hold so the card survives into hold_failed
      // on a decline (the card-update retry filters on stripeCustomerId, and a
      // first on-session decline never reaches the success commit). Captured
      // into validatedCard FIRST, so even a failure of this persist write folds
      // the correct card into the revert below — the row then lands back in
      // pending_payment carrying the NEW card, never a stale declined one.
      if (paymentMethodId) {
        validatedCard = {
          paymentMethodId: holdPaymentMethodId,
          stripeCustomerId: customerId,
        }
        await this.model.updateMany({
          where: { outreachId, settleState: RobocallSettleState.hold_pending },
          data: validatedCard,
        })
      }
    } catch (err) {
      // OFF-SESSION card problem (no present caller to fix it live) escalates
      // ATOMICALLY to hold_failed here — the row is the hold_pending we own, so
      // move it straight to hold_failed + emit HoldFailed and RETURN a
      // hold_failed result, never a separate escalation call that could itself
      // fail and strand the row in pending_payment for an endless retry storm.
      // Two off-session paths reach here: the deferred sweep (no PM passed) AND
      // the card-update retry (a PM passed, but the pre-claim state was
      // hold_failed) — both must terminate to hold_failed, not fall through to
      // revert (which would leave a hold_failed retry sitting in pending_payment
      // for the daily sweep to re-charge the same bad card forever).
      if (
        err instanceof RobocallCardError &&
        (!paymentMethodId ||
          draft.settleState === RobocallSettleState.hold_failed)
      ) {
        // Bump payAttempt (draft.payAttempt + 1) even though no hold was placed:
        // persisting it makes the HoldFailed dedup key advance across repeated
        // escalations, so a later card-failure on the same draft — past Segment's
        // 24h window — still sends the "update your card" email. The next real
        // hold attempt just skips a number, which the idempotency key tolerates.
        return this.transitionToHoldFailed(
          user.id,
          outreachId,
          draft.payAttempt + 1,
        )
      }
      // Otherwise — an on-session card error (throw 400 to the present caller to
      // fix live), or a transient/non-card error on any path — revert to
      // pending_payment and rethrow. No hold placed, so no idempotency key was
      // consumed; don't bump payAttempt (the next attempt reuses attempt N+1).
      // Fold in the validated card (set once validation passed) so the revert
      // carries the NEW card even if the persist write itself is what threw.
      await this.revertClaim(outreachId, undefined, validatedCard)
      throw err
    }

    // Freeze the estimate into the idempotency key and the metadata so a retry
    // of THIS attempt can never place a second hold.
    const attempt = draft.payAttempt + 1
    let held: { paymentIntentId: string; captureBefore: Date }
    try {
      held = await this.stripe.createManualCaptureHold({
        customerId,
        paymentMethodId: holdPaymentMethodId,
        amountInCents: estimate,
        robocallId: outreachId,
        attempt,
        metadata: {
          outreachId: String(outreachId),
          campaignId: String(campaign.id),
          userId: String(user.id),
        },
      })
    } catch (err) {
      if (err instanceof StripeHoldDeclinedError) {
        // A decline is a business outcome, not a 502. Move to the hold_failed
        // terminal, bump payAttempt (a hold attempt WAS made, so the key is
        // consumed), and emit the milestone once. The card + customer were
        // already persisted after validation above, so the hold_failed row
        // carries a stripeCustomerId the card-update retry can find — even on a
        // first on-session decline that never reaches the success commit. A
        // future resolution slice must branch on err.code:
        // `authentication_required` is a StripeCardError that needs on-session
        // re-auth, not the "update your card" reminder loop.
        return this.transitionToHoldFailed(user.id, outreachId, attempt)
      }
      // Infra failure (502): no confirmed hold to void. Release the claim
      // WITHOUT bumping payAttempt — a retry reuses the same idempotency key so
      // Stripe replays (recovering a PI that may in fact be live) instead of
      // stacking a second hold.
      await this.revertClaim(outreachId)
      throw err
    }

    // WINDOW-FIT: a hold that expires before the run finishes and can be
    // captured is unusable. If send + run + settle margin overruns the hold's
    // capture deadline, void it and release the claim.
    const captureDeadline = addHours(
      sendAt,
      ROBOCALL_RUN_HOURS + ROBOCALL_SETTLE_MARGIN_HOURS,
    )
    if (isAfter(captureDeadline, held.captureBefore)) {
      // We placed a hold that we are now abandoning. Void it (best-effort) and
      // revert, persisting attempt as the new payAttempt so a retry derives a
      // FRESH idempotency key (robocall-hold-<id>-<attempt+1>) and a new PI —
      // reusing the key would idempotent-replay this just-canceled PI.
      await this.stripe.voidHold(held.paymentIntentId)
      await this.recordOrphanHold(
        held.paymentIntentId,
        outreachId,
        'window_fit',
      )
      await this.revertClaim(outreachId, attempt)
      throw new BadRequestException(
        'The authorization would expire before the call can be charged',
      )
    }

    // Capture the campaign pk_str the commit is about to null — read FRESH from
    // the row we own in hold_pending, NOT the method-entry snapshot. A concurrent
    // re-auth→stage→dead-hold cycle completing before our claim could have left
    // the row carrying a NEWER pk_str than the entry snapshot; while we hold the
    // hold_pending claim nothing else writes this row's pk_str, so this read is
    // exactly the value the commit nulls (never a stale one that leaks the real
    // orphan unrecorded).
    const owned = await this.findFirst({
      where: { outreachId },
      select: { callhubCampaignPkStr: true },
    })
    const orphanedPkStr = owned?.callhubCampaignPkStr ?? null

    // SUCCESS CLAIM: commit the hold only if the draft is still the
    // hold_pending we own. If it moved (a lost race), the hold we placed must
    // not stand — void it and report the current state.
    const commit = await this.model.updateMany({
      where: { outreachId, settleState: RobocallSettleState.hold_pending },
      data: {
        settleState: RobocallSettleState.authorized,
        authorizationIntentId: held.paymentIntentId,
        authorizedAmountInCents: estimate,
        captureBefore: held.captureBefore,
        paymentMethodId: holdPaymentMethodId,
        stripeCustomerId: customerId,
        payAttempt: attempt,
        // A (re)authorization invalidates any previously-staged CallHub
        // campaign: this hold prices a freshly-derived billable count, but a
        // stale campaign would dial the OLD frozen phonebook. Null the campaign
        // fields so the staging sweep (which claims on `callhubCampaignPkStr IS
        // NULL`) re-stages a phonebook matching the new count. On a first
        // authorize these are already null (a no-op); on a hold_failed re-auth
        // the old PAUSED campaign is orphaned (charges nothing; a later
        // reconciliation slice cleans paused orphans).
        callhubCampaignPkStr: null,
        callhubStartingDate: null,
        callhubExpirationDate: null,
      },
    })
    if (commit.count === 0) {
      // Lost the race: the draft moved out of hold_pending during the Stripe
      // calls, so the hold we placed must not stand. Void it (best-effort). The
      // revert bumps payAttempt only if the row is somehow still hold_pending
      // (a no-op otherwise, since the row is owned by whoever advanced it), so a
      // fresh key is used should a retry ever place again.
      await this.stripe.voidHold(held.paymentIntentId)
      await this.recordOrphanHold(
        held.paymentIntentId,
        outreachId,
        'lost_commit',
      )
      await this.revertClaim(outreachId, attempt)
      return this.currentStateResult(outreachId, draft.settleState)
    }

    // The hold committed, so this is a real scheduled send: make it visible in
    // the history list.
    await this.markSpineScheduled(outreachId)

    // The commit just nulled callhubCampaignPkStr. If a previously-staged
    // campaign was there (a hold_failed re-auth re-derives the count, so the old
    // frozen phonebook must not dial), it is now orphaned — record it so the
    // cleanup sweep ABORTs it. Best-effort: a PAUSED campaign charges nothing, so
    // a lost record only leaves harmless account clutter and must never fail the
    // authorize whose hold already committed.
    if (orphanedPkStr) {
      try {
        await this.orphanedCampaigns.record(
          orphanedPkStr,
          outreachId,
          'reauth_restage',
        )
      } catch (err) {
        this.logger.error(
          { err, outreachId, campaignPkStr: orphanedPkStr },
          'robocall re-auth: failed to record orphaned CallHub campaign',
        )
      }
    }

    await this.emitMilestone(
      user.id,
      outreachId,
      EVENTS.Robocall.HoldPlaced,
      'hold_placed',
      undefined,
      { amount_dollars: String(estimate / 100) },
    )
    return {
      status: 'authorized',
      settleState: RobocallSettleState.authorized,
      authorizedAmountInCents: estimate,
    }
  }

  // Robocall drafts start at spine status pending_payment, which the history
  // list (findByCampaignId) filters out; the lifecycle otherwise only advances
  // the satellite settleState, so the spine would stay pending_payment forever
  // and the campaign never shows. Called once the pay step commits (authorize,
  // or deferred with the card saved) to advance the spine to `pending`. Guarded
  // on pending_payment: idempotent, never flips an unpaid/already-visible row.
  // Best-effort (like the sibling post-commit side effects): the hold already
  // committed, so a transient failure must not 500 a money-succeeded request —
  // a 500 sends the retry to the placement CAS's noop path, which returns
  // 'authorized' and never re-flips. A miss only leaves the row hidden; log it.
  private async markSpineScheduled(outreachId: number) {
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

  // Terminal for a robocall the send chain could NOT deliver: a permanent
  // CallHub staging/send failure. No calls were placed, so VOID the hold
  // (best-effort + recorded for the reconcile sweep — no charge), CAS the
  // satellite to send_failed, flip the spine to `failed` ("Couldn't send" in the
  // history), and email the candidate once. Reached ONLY from pre-delivery
  // states (authorized/staging/dialing-before-START); a DELIVERED run that may
  // owe money goes to uncollectable, never here — never void a hold for calls
  // that connected. The claim CAS makes it single-owner and idempotent.
  async failSend(
    outreachId: number,
    reason: 'staging' | 'send' | 'expired_unstaged',
  ): Promise<void> {
    const draft = await this.findFirst({
      where: { outreachId },
      include: { outreach: { include: { campaign: true } } },
    })
    if (!draft) return

    const claim = await this.model.updateMany({
      where: {
        outreachId,
        // expired_unstaged must not terminate a draft the staging sweep has
        // already claimed to `staging`: the two sweeps race on a draft whose
        // send time falls inside the staging lead window, so the stranded
        // sweep only ever fails a draft still sitting in `authorized`.
        settleState: {
          in:
            reason === 'expired_unstaged'
              ? [RobocallSettleState.authorized]
              : [
                  RobocallSettleState.authorized,
                  RobocallSettleState.staging,
                  RobocallSettleState.dialing,
                ],
        },
        // expired_unstaged (stranded sweep) must match the exact SELECT
        // invariant: authorized AND callhubCampaignPkStr IS NULL. If the
        // staging sweep COMPLETED between that SELECT and here, the draft is
        // back in `authorized` but now has a pk_str set and is about to dial —
        // failing it would void a live hold and orphan a staged campaign. This
        // CAS — NOT the staging-grace date boundary — is what makes the staging
        // and stranded sweeps disjoint across their separate cron ticks (the
        // `now - grace` bound only separates them at a single instant, and the
        // two windows can briefly overlap tick-to-tick). Do NOT drop this guard
        // believing the grace made it redundant: that reintroduces a
        // double-void / dial-after-void race.
        ...(reason === 'expired_unstaged'
          ? { callhubCampaignPkStr: null }
          : {}),
      },
      data: { settleState: RobocallSettleState.send_failed },
    })
    // count 0: another runner already terminated it, or it advanced past the
    // pre-delivery states — do not re-void or re-email.
    if (claim.count === 0) return

    // The `win-robocall-critical` alert pages win-bugs on this `CRITICAL
    // robocall` line (deploy/components/alerts.ts).
    this.logger.error(
      { outreachId, reason },
      'CRITICAL robocall send_failed: permanent CallHub failure; hold voided',
    )

    // No calls were placed, so release the hold. Best-effort + recorded so the
    // reconcile sweep confirms and re-voids it if this void did not land.
    if (draft.authorizationIntentId) {
      await this.stripe.voidHold(draft.authorizationIntentId)
      await this.recordOrphanHold(
        draft.authorizationIntentId,
        outreachId,
        'send_failed',
      )
    }

    // A send-path failure has a staged PAUSED campaign (callhubCampaignPkStr set
    // once staging committed). No calls were placed, but the paused campaign
    // lingers in CallHub, and the cleanup sweep only ABORTs pk_strs recorded at a
    // known abandonment point — record it here so it is retired. Best-effort: a
    // PAUSED campaign charges nothing, so a lost record is harmless clutter and
    // must never fail the send_failed path.
    if (draft.callhubCampaignPkStr) {
      try {
        await this.orphanedCampaigns.record(
          draft.callhubCampaignPkStr,
          outreachId,
          'send_failed',
        )
      } catch (err) {
        this.logger.error(
          { err, outreachId, campaignPkStr: draft.callhubCampaignPkStr },
          'robocall send_failed: failed to record orphaned CallHub campaign',
        )
      }
    }

    await this.markSpineFailed(outreachId)
    // Outreach.campaign is nullable (campaign-less Serve orgs), but a robocall is
    // always campaign-scoped; guard defensively so a data anomaly can't crash the
    // terminal, and only email a candidate we can actually resolve.
    const userId = draft.outreach.campaign?.userId
    if (userId != null) {
      await this.emitMilestone(
        userId,
        outreachId,
        EVENTS.Robocall.SendFailed,
        'send_failed',
        undefined,
        { failure_reason: reason },
      )
    }
  }

  // Flip the spine to `failed` so the history shows "Couldn't send". Guarded on
  // the pre-terminal visible states (never overrides canceled/completed).
  // Best-effort, like markSpineScheduled.
  private async markSpineFailed(outreachId: number) {
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

  // The shared hold_pending → hold_failed terminal transition + HoldFailed
  // emit, used by BOTH the decline path and the card-failure escalation (a
  // permanent card problem — deferred sweep or a hold_failed retry). Every caller
  // passes a MONOTONIC `payAttempt` (decline: the consumed attempt; escalation:
  // draft.payAttempt + 1, even though no hold was placed), and it is persisted
  // AND used as the HoldFailed messageId suffix. Persisting it is what makes the
  // dedup key advance across repeated escalations, so each genuine "update your
  // card" email is sent even past Segment's 24h window; the hold idempotency key
  // tolerates the skipped number a no-hold escalation leaves. The CAS matches
  // only the hold_pending we own, so a lost race writes nothing and emits nothing.
  private async transitionToHoldFailed(
    userId: number,
    outreachId: number,
    payAttempt: number,
  ): Promise<RobocallAuthorizeResponse> {
    await this.model.updateMany({
      where: { outreachId, settleState: RobocallSettleState.hold_pending },
      data: {
        settleState: RobocallSettleState.hold_failed,
        payAttempt,
      },
    })
    await this.emitMilestone(
      userId,
      outreachId,
      EVENTS.Robocall.HoldFailed,
      'hold_failed',
      payAttempt,
    )
    return {
      status: 'hold_failed',
      settleState: RobocallSettleState.hold_failed,
      authorizedAmountInCents: null,
    }
  }

  // Releases the hold_pending claim back to pending_payment. When a PLACED hold
  // was just voided, pass the used attempt as payAttempt so the next attempt
  // derives a fresh idempotency key; omit it for a pre-hold/infra revert where
  // the key was not consumed (or must be reused to recover a live PI). `card`
  // folds the validated card into the revert so the row carries the NEW card
  // even if the post-validation persist write is what failed.
  private async revertClaim(
    outreachId: number,
    payAttempt?: number,
    card?: { paymentMethodId: string; stripeCustomerId: string },
  ): Promise<void> {
    await this.model.updateMany({
      where: { outreachId, settleState: RobocallSettleState.hold_pending },
      data: {
        settleState: RobocallSettleState.pending_payment,
        ...(payAttempt != null ? { payAttempt } : {}),
        ...(card ?? {}),
      },
    })
  }

  // The no-hold-placed result: report the satellite's live state so a caller
  // that lost the claim (or double-clicked an already-authorized draft) learns
  // the truth. An already-authorized draft reports authorized + its frozen
  // amount so a retry reads as success, not a spurious failure.
  private async currentStateResult(
    outreachId: number,
    fallback: RobocallSettleState,
  ): Promise<RobocallAuthorizeResponse> {
    const current = await this.findFirst({ where: { outreachId } })
    const settleState = current?.settleState ?? fallback
    // hold_failed is a distinct status the UI acts on (prompt for a new card);
    // don't flatten it into 'noop' (a concurrent-placement / already-moved race).
    const status =
      settleState === RobocallSettleState.authorized
        ? 'authorized'
        : settleState === RobocallSettleState.hold_failed
          ? 'hold_failed'
          : 'noop'
    return {
      status,
      settleState,
      authorizedAmountInCents:
        status === 'authorized'
          ? (current?.authorizedAmountInCents ?? null)
          : null,
    }
  }

  // Emits a milestone with a deterministic Segment messageId so a replay dedups
  // to one email. Called ONLY from a winning transition. Best-effort: the money
  // op already committed, so a transient Segment failure must not 500 a request
  // whose hold succeeded — that would push a retry onto the noop path and lose
  // the email entirely. A lost email is recoverable by the later reminder sweep.
  // `attempt` is folded into the HoldFailed messageId so each failure has a
  // UNIQUE dedup key. EVERY HoldFailed path passes one (a decline the consumed
  // attempt; a card-validation escalation draft.payAttempt + 1, which it also
  // persists), because payAttempt advances monotonically per failure: a
  // card-update retry can fail again days after the first, past Segment's 24h
  // dedup window, and a fixed key would suppress the "update your card" email the
  // candidate genuinely needs. HoldPlaced passes no attempt (its own suffix
  // already differs) and keeps the base key.
  private async emitMilestone(
    userId: number,
    outreachId: number,
    event: string,
    suffix: 'hold_placed' | 'hold_failed' | 'send_failed',
    attempt?: number,
    // Amount for HoldPlaced, failure reason for SendFailed — whatever content
    // the winning transition already has in scope. HoldFailed carries none.
    customProperties: Record<string, string> = {},
  ): Promise<void> {
    try {
      const messageId =
        attempt != null
          ? `${outreachId}:${suffix}:${attempt}`
          : `${outreachId}:${suffix}`
      await this.analytics.track(
        userId,
        event,
        { outreachId },
        undefined,
        messageId,
      )
    } catch (err) {
      this.logger.error(
        { err, outreachId, event },
        'robocall milestone emit failed',
      )
    }

    // Single-send email leg (ENG-11035) — best-effort, never throws; see
    // OutreachRobocallSingleSendService.
    await this.robocallSingleSend.send(event, userId, outreachId, {
      outreach_id: String(outreachId),
      ...customProperties,
    })
  }
}
