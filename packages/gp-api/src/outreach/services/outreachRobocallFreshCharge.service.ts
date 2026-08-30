import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { subMinutes } from 'date-fns'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { calcRobocallAmountInCents } from '@/shared/util/robocallPricing.util'
import { AnalyticsService } from '@/analytics/analytics.service'
import {
  StripeChargeDeclinedError,
  StripeService,
} from '@/vendors/stripe/services/stripe.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { Prisma, RobocallSettleState } from '../../generated/prisma'

// One slot after capture (:02), on a minute free of the other robocall crons.
const ROBOCALL_FRESH_CHARGE_SWEEP_CRON = '5,15,25,35,45,55 * * * *'
const ROBOCALL_FRESH_CHARGE_SWEEP_JOB = 'robocallFreshChargeSweep'

// A `charging` row stranded past this window is a crashed fresh charge (a
// process that died between winning the claim and committing). Its charge may
// already have landed at Stripe, so it MUST be reconciled — settleClaimed first
// searches for an already-succeeded charge and commits it WITHOUT re-charging,
// so recovery is safe even past Stripe's 24h idempotency-key window. Matches the
// capturing stale window.
const ROBOCALL_CHARGING_STALE_MINUTES = 15

// Stripe's minimum USD charge is $0.50. A fresh PaymentIntent below it is
// rejected (a partial CAPTURE off an already-authorized hold is not, which is
// why only this path guards it). A run billing under the minimum is written off.
const STRIPE_MIN_CHARGE_CENTS = 50

// Kill-switch, default OFF: this MOVES REAL MONEY (a fresh off-session charge).
// Shares ROBOCALL_CAPTURE_ENABLED with the hold-capture path — both are the
// settlement charge, enabled together for the supervised live test.
const isCaptureEnabled = () => process.env.ROBOCALL_CAPTURE_ENABLED === 'true'

// The fresh-charge half of settlement recovery: for a DELIVERED run the capture
// slice parked in `uncollectable` because its authorization hold lapsed before
// capture (expired / canceled), charge the saved card OFF-SESSION for the actual
// billable amount — clamped to the originally authorized amount (INV-1) so a
// fresh charge can never exceed what the candidate authorized. The single-owner
// claim (`uncollectable → charging`) elects one charger, a stable idempotency
// key makes a retry replay instead of double-charging, and the terminal is
// `charged` (collected) or back to `uncollectable` with `chargeIntentId` set on
// a decline (so the run is never charge-attempted again and a later dispute
// reconciles). This charges a card WITHOUT a live pre-authorization, so it is
// the riskiest money step — gated behind the capture kill-switch and reached
// only for the rare lapsed-hold run the capture sweep already alerted CRITICAL.
@Injectable()
export class OutreachRobocallFreshChargeService extends createPrismaBase(
  MODELS.OutreachRobocall,
) {
  constructor(
    private readonly stripe: StripeService,
    private readonly analytics: AnalyticsService,
  ) {
    super()
  }

  // No CronLockService: idempotent per record behind the `uncollectable →
  // charging` claim, so two replicas both SELECT the same candidates but only
  // ONE wins each row's claim. Prod-only (a real charge; Stripe is stubbed on
  // dev/preview) AND kill-switch-gated (default OFF).
  @Cron(ROBOCALL_FRESH_CHARGE_SWEEP_CRON, {
    name: ROBOCALL_FRESH_CHARGE_SWEEP_JOB,
    timeZone: EASTERN_TIMEZONE,
  })
  async sweepFreshCharges(): Promise<void> {
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') return
    if (!isCaptureEnabled()) return

    // Chargeable = a delivered, lapsed-hold run with the data to bill exactly
    // and a saved card, that has NOT yet been charge-attempted (chargeIntentId
    // null — a prior decline sets it, excluding the row from re-attempt). A
    // missing count/amount is a data anomaly the capture slice already parked
    // uncollectable; without the authorized amount INV-1 cannot clamp, so it is
    // filtered here and left for manual review rather than charged blind.
    const candidates = await this.model.findMany({
      where: {
        settleState: RobocallSettleState.uncollectable,
        chargeIntentId: null,
        completedCallCount: { not: null },
        authorizedAmountInCents: { not: null },
        paymentMethodId: { not: null },
        stripeCustomerId: { not: null },
      },
      orderBy: { updatedAt: Prisma.SortOrder.asc },
      select: { outreachId: true },
    })

    for (const { outreachId } of candidates) {
      try {
        await this.chargeUncollectable(outreachId)
      } catch (err) {
        this.logger.error(
          { err, outreachId },
          'robocall fresh charge failed for a draft; continuing sweep',
        )
      }
    }

    // STALE-CHARGING RECOVERY: a row stranded in `charging` past the stale window
    // is a crashed charge (died between the Stripe charge and the DB commit). Its
    // charge may already have landed, so re-run the settle path — the stable
    // idempotency key replays the same PI (never double-charges).
    const staleCutoff = subMinutes(new Date(), ROBOCALL_CHARGING_STALE_MINUTES)
    const stale = await this.model.findMany({
      where: {
        settleState: RobocallSettleState.charging,
        updatedAt: { lt: staleCutoff },
      },
      select: { outreachId: true },
    })

    for (const { outreachId } of stale) {
      try {
        await this.recoverStaleCharging(outreachId)
      } catch (err) {
        this.logger.error(
          { err, outreachId },
          'robocall stale-charging recovery failed; continuing sweep',
        )
      }
    }
  }

  async chargeUncollectable(outreachId: number): Promise<void> {
    // CLAIM: elect one charger. Guarded on chargeIntentId null so a row already
    // charge-attempted (a prior decline recorded the PI) is never re-charged.
    const claim = await this.model.updateMany({
      where: {
        outreachId,
        settleState: RobocallSettleState.uncollectable,
        chargeIntentId: null,
      },
      data: { settleState: RobocallSettleState.charging },
    })
    if (claim.count === 0) return
    await this.settleClaimed(outreachId)
  }

  // Recovers a `charging` row stranded past the stale window. Re-claims with a
  // stale-guarded self-transition CAS (writing `charging` bumps @updatedAt, so a
  // concurrent recoverer loses — electing one), then settles via the SAME path.
  // settleClaimed's search-first reconcile finds an already-landed charge and
  // commits it without re-charging, so recovery never double-charges even past
  // the 24h idempotency-key window.
  private async recoverStaleCharging(outreachId: number): Promise<void> {
    const staleCutoff = subMinutes(new Date(), ROBOCALL_CHARGING_STALE_MINUTES)
    const reclaim = await this.model.updateMany({
      where: {
        outreachId,
        settleState: RobocallSettleState.charging,
        updatedAt: { lt: staleCutoff },
      },
      data: { settleState: RobocallSettleState.charging },
    })
    if (reclaim.count === 0) return
    await this.settleClaimed(outreachId)
  }

  // Settles a row THIS caller owns in `charging`: compute the clamped amount,
  // charge off-session, and commit. Every branch moves the row out of charging
  // (to `charged`, or back to `uncollectable`) so it never strands.
  private async settleClaimed(outreachId: number): Promise<void> {
    const draft = await this.findFirst({
      where: { outreachId },
      include: {
        outreach: { include: { campaign: { include: { user: true } } } },
      },
    })
    if (!draft) {
      this.logger.error(
        { outreachId },
        'CRITICAL robocall fresh charge: claimed row vanished; cannot charge',
      )
      return
    }

    const {
      completedCallCount,
      authorizedAmountInCents,
      paymentMethodId,
      stripeCustomerId,
    } = draft
    // The candidate filter guarantees these, but a stale-charging reclaim can
    // reach a row the filter never vetted — re-check and park uncollectable
    // rather than charge blind on missing data.
    if (
      completedCallCount == null ||
      authorizedAmountInCents == null ||
      paymentMethodId == null ||
      stripeCustomerId == null
    ) {
      this.logger.error(
        { outreachId },
        'CRITICAL robocall fresh charge: row missing count/amount/card; ' +
          'parked uncollectable, not charged',
      )
      await this.transitionFromCharging(
        outreachId,
        RobocallSettleState.uncollectable,
      )
      return
    }

    // INV-1: never charge more than the originally authorized amount. The actual
    // billable is <= the frozen estimate; clamp defensively either way.
    const captureAmount = Math.min(
      calcRobocallAmountInCents(completedCallCount),
      authorizedAmountInCents,
    )
    // A zero-billable run owes nothing, and a sub-minimum amount CANNOT be
    // charged: unlike a capture (partial-capture off an already-authorized hold
    // that met the minimum), a fresh PaymentIntent below Stripe's minimum charge
    // is rejected. Rounding up to the minimum would overcharge a delivered run
    // for calls it never made, so write it off to `voided` (the capture slice's
    // zero terminal) — NOT back to uncollectable, which would re-match the
    // candidate filter and fail-and-retry forever. No money moves either way.
    if (captureAmount < STRIPE_MIN_CHARGE_CENTS) {
      this.logger.info(
        { outreachId, completedCallCount, captureAmount },
        'robocall fresh charge: amount below Stripe minimum; voided (written off)',
      )
      await this.transitionFromCharging(outreachId, RobocallSettleState.voided)
      return
    }

    const userId = draft.outreach.campaign?.user?.id

    // IDEMPOTENT-FOREVER GUARD: before charging, check whether a prior attempt's
    // charge already SUCCEEDED at Stripe (a stale-charging recovery whose commit
    // was lost, or a lost response). Reconcile it WITHOUT charging again. This
    // does not rely on Stripe's 24h idempotency-key window — which the capture
    // kill-switch's toggling can outlast — so a recovery days later never
    // double-charges. On the first (non-recovery) settle this returns null.
    const existing = await this.stripe.findSucceededChargeByOutreach(outreachId)
    if (existing) {
      this.logger.info(
        { outreachId, chargeIntentId: existing.paymentIntentId },
        'robocall fresh charge already succeeded at Stripe; reconciling',
      )
      await this.commitCharged(
        outreachId,
        existing.paymentIntentId,
        existing.amountReceived ?? captureAmount,
        userId,
        completedCallCount,
      )
      return
    }

    let charged: { paymentIntentId: string }
    try {
      charged = await this.stripe.createOffSessionCharge({
        customerId: stripeCustomerId,
        paymentMethodId,
        amountInCents: captureAmount,
        robocallId: outreachId,
        metadata: {
          outreachId: String(outreachId),
          userId: userId != null ? String(userId) : '',
        },
      })
    } catch (err) {
      if (err instanceof StripeChargeDeclinedError) {
        // The delivered run's card declined. Park it uncollectable WITH the
        // declined PI id (from the confirm) so it is not re-attempted and a
        // later dispute/refund on that intent reconciles. Surfaced CRITICAL —
        // a delivered run we could not collect needs manual follow-up.
        // Mark the run charge-attempted so the candidate filter (chargeIntentId
        // IS NULL) never re-attempts it. A confirm-time card decline always
        // carries the PI id; the `declined-no-pi` sentinel only guards the
        // near-impossible null case, and — being no real Stripe intent id — is
        // never matched by a dispute (markDisputedByIntent) either.
        const marker = err.paymentIntentId ?? `declined-no-pi-${outreachId}`
        this.logger.error(
          { outreachId, chargeIntentId: marker },
          'CRITICAL robocall fresh charge declined; parked uncollectable, ' +
            'delivered run uncollected',
        )
        await this.model.updateMany({
          where: { outreachId, settleState: RobocallSettleState.charging },
          data: {
            settleState: RobocallSettleState.uncollectable,
            chargeIntentId: marker,
          },
        })
        return
      }
      // Transient infra failure (502): no confirmed charge. Revert to
      // uncollectable WITHOUT a chargeIntentId so the next sweep retries under
      // the stable key (replaying a possibly-live charge, never a second one).
      this.logger.error(
        { err, outreachId },
        'robocall fresh charge infra failure; reverting to uncollectable',
      )
      await this.transitionFromCharging(
        outreachId,
        RobocallSettleState.uncollectable,
      )
      return
    }

    await this.commitCharged(
      outreachId,
      charged.paymentIntentId,
      captureAmount,
      userId,
      completedCallCount,
    )
  }

  // Commits charging → charged, records the charge intent + amount, and emits the
  // Receipt once. CAS-guarded on charging so a lost race writes nothing and is
  // surfaced — money already moved at Stripe.
  private async commitCharged(
    outreachId: number,
    chargeIntentId: string,
    capturedAmountInCents: number,
    userId: number | undefined,
    completedCallCount: number,
  ): Promise<void> {
    const commit = await this.model.updateMany({
      where: { outreachId, settleState: RobocallSettleState.charging },
      data: {
        settleState: RobocallSettleState.charged,
        chargeIntentId,
        capturedAmountInCents,
      },
    })
    if (commit.count === 0) {
      this.logger.error(
        { outreachId, chargeIntentId, capturedAmountInCents },
        'CRITICAL robocall fresh charge: charged at Stripe but commit found no ' +
          'charging row; charged amount may be unrecorded',
      )
      return
    }
    this.logger.info(
      { outreachId, capturedAmountInCents, completedCallCount },
      'robocall run fresh-charged',
    )
    if (userId == null) {
      this.logger.error(
        { outreachId },
        'robocall fresh charge: no user on the run; skipping receipt milestone',
      )
      return
    }
    await this.emitReceipt(userId, outreachId, capturedAmountInCents)
  }

  // Moves the row out of the charging claim. CAS-guarded on charging so a row
  // that somehow moved is a no-op.
  private async transitionFromCharging(
    outreachId: number,
    to: RobocallSettleState,
  ): Promise<void> {
    await this.model.updateMany({
      where: { outreachId, settleState: RobocallSettleState.charging },
      data: { settleState: to },
    })
  }

  private async emitReceipt(
    userId: number,
    outreachId: number,
    capturedAmountInCents: number,
  ): Promise<void> {
    try {
      await this.analytics.track(
        userId,
        EVENTS.Robocall.Receipt,
        { outreachId, capturedAmountInCents },
        undefined,
        `${outreachId}:receipt`,
      )
    } catch (err) {
      this.logger.error(
        { err, outreachId },
        'robocall fresh-charge receipt milestone emit failed',
      )
    }
  }
}
