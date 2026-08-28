import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { addDays, addHours, isAfter } from 'date-fns'
import { RobocallAuthorizeResponse } from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { calcRobocallAmountInCents } from '@/shared/util/robocallPricing.util'
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
  OutreachType,
  RobocallSettleState,
  User,
} from '../../generated/prisma'
import { OutreachRobocallService } from './outreachRobocall.service'

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
  ) {
    super()
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
        throw new BadRequestException(
          'That payment method is not on file for this account',
        )
      }
      if (pm.type !== 'card') {
        throw new BadRequestException(
          'Only a card can authorize a robocall hold',
        )
      }
      // CAS-guarded persist: after the two async Stripe validations a concurrent
      // request could have rescheduled this send into the window and advanced
      // the row past pending_payment. Only write while still pending_payment, so
      // we never clobber the chosen card on an already-authorized row.
      await this.model.updateMany({
        where: { outreachId, settleState: RobocallSettleState.pending_payment },
        data: { paymentMethodId, stripeCustomerId: customerId },
      })
      return {
        status: 'deferred',
        settleState: draft.settleState,
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
    try {
      const billableCount = await this.robocallService.deriveBillableCount(
        organization,
        voterFileFilterId,
      )
      this.robocallService.assertReachableCount(billableCount)
      estimate = calcRobocallAmountInCents(billableCount)

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
          throw new BadRequestException(
            'No saved card to authorize the deferred robocall hold',
          )
        }
        holdPaymentMethodId = claimed.paymentMethodId
        customerId = claimed.stripeCustomerId
      }
      const pm = await this.stripe.retrievePaymentMethod(holdPaymentMethodId)
      if (pm.customer !== customerId) {
        throw new BadRequestException(
          'That payment method is not on file for this account',
        )
      }
      // Cards only, made explicit: an off-session manual-capture hold on a
      // non-card PM (e.g. a vaulted bank debit) would not reserve capturable
      // funds. The vault SetupIntent already pins cards, so this is defense in
      // depth against a non-card PM reaching the create call.
      if (pm.type !== 'card') {
        throw new BadRequestException(
          'Only a card can authorize a robocall hold',
        )
      }
    } catch (err) {
      // Pre-hold failure: no hold placed, so no idempotency key was consumed.
      // Revert without bumping payAttempt — the next attempt reuses attempt N+1.
      await this.revertClaim(outreachId)
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
        // terminal, bump payAttempt, and emit the milestone once. A future
        // resolution slice must branch on err.code: `authentication_required`
        // is a StripeCardError that needs on-session re-auth, not the "update
        // your card" reminder loop.
        await this.model.updateMany({
          where: {
            outreachId,
            settleState: RobocallSettleState.hold_pending,
          },
          data: {
            settleState: RobocallSettleState.hold_failed,
            payAttempt: attempt,
          },
        })
        await this.emitMilestone(
          user.id,
          outreachId,
          EVENTS.Robocall.HoldFailed,
          'hold_failed',
        )
        return {
          status: 'hold_failed',
          settleState: RobocallSettleState.hold_failed,
          authorizedAmountInCents: null,
        }
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
      await this.revertClaim(outreachId, attempt)
      throw new BadRequestException(
        'The authorization would expire before the call can be charged',
      )
    }

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
      await this.revertClaim(outreachId, attempt)
      return this.currentStateResult(outreachId, draft.settleState)
    }

    await this.emitMilestone(
      user.id,
      outreachId,
      EVENTS.Robocall.HoldPlaced,
      'hold_placed',
    )
    return {
      status: 'authorized',
      settleState: RobocallSettleState.authorized,
      authorizedAmountInCents: estimate,
    }
  }

  // Escalates a draft to the hold_failed terminal + emits the HoldFailed
  // milestone. For the deferred sweep: a permanent off-session PM problem (a
  // stale/foreign or non-card persisted card, which authorizeHold surfaces as a
  // BadRequestException after reverting its own claim) must move the draft OUT
  // of the pending_payment candidate set — otherwise every daily sweep re-selects
  // and silently retries it — and must notify the absent candidate to fix their
  // card. Mirrors the decline path's terminal; the on-session /authorize does
  // NOT use this (it throws 400 to the present caller). Idempotent: the CAS
  // matches only a not-yet-terminal draft, so a repeat sweep is a no-op and the
  // milestone (deterministic messageId) fires once.
  async markHoldFailed(userId: number, outreachId: number): Promise<void> {
    const failed = await this.model.updateMany({
      where: {
        outreachId,
        settleState: {
          in: [
            RobocallSettleState.pending_payment,
            RobocallSettleState.hold_pending,
          ],
        },
      },
      data: { settleState: RobocallSettleState.hold_failed },
    })
    if (failed.count === 0) return
    await this.emitMilestone(
      userId,
      outreachId,
      EVENTS.Robocall.HoldFailed,
      'hold_failed',
    )
  }

  // Releases the hold_pending claim back to pending_payment. When a PLACED hold
  // was just voided, pass the used attempt as payAttempt so the next attempt
  // derives a fresh idempotency key; omit it for a pre-hold/infra revert where
  // the key was not consumed (or must be reused to recover a live PI).
  private async revertClaim(
    outreachId: number,
    payAttempt?: number,
  ): Promise<void> {
    await this.model.updateMany({
      where: { outreachId, settleState: RobocallSettleState.hold_pending },
      data: {
        settleState: RobocallSettleState.pending_payment,
        ...(payAttempt != null ? { payAttempt } : {}),
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
  private async emitMilestone(
    userId: number,
    outreachId: number,
    event: string,
    suffix: 'hold_placed' | 'hold_failed',
  ): Promise<void> {
    try {
      await this.analytics.track(
        userId,
        event,
        { outreachId },
        undefined,
        `${outreachId}:${suffix}`,
      )
    } catch (err) {
      this.logger.error(
        { err, outreachId, event },
        'robocall milestone emit failed',
      )
    }
  }
}
