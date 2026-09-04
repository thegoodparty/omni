import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { subMinutes } from 'date-fns'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import {
  calcRobocallAmountInCents,
  calcRobocallTotalInCents,
} from '@/shared/util/robocallPricing.util'
import { AnalyticsService } from '@/analytics/analytics.service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import {
  OutreachStatus,
  Prisma,
  RobocallSettleState,
} from '../../generated/prisma'
import { RobocallOrphanedHoldService } from './robocallOrphanedHold.service'

// Capture runs after completion (:09,:19,…) records the count, so it sits three
// minutes later on a slot free of the other robocall crons (send :04, staging
// :07, completion :09, deferred cancel :01/:16, hold-failure cancel :11).
const ROBOCALL_CAPTURE_SWEEP_CRON = '2,12,22,32,42,52 * * * *'
const ROBOCALL_CAPTURE_SWEEP_JOB = 'robocallCaptureSweep'

// A `capturing` row whose updatedAt is older than this is assumed stranded — a
// process that died between winning the capture claim and committing the result
// (e.g. an ECS deploy SIGTERM mid-cron, or a crash after the Stripe capture
// succeeded but before the DB commit). It is invisible to the `settling` claim
// (which never matches `capturing`), yet its hold may already be captured, so it
// MUST be reconciled — never left stranded with money taken and no receipt. It
// must comfortably exceed a healthy captureDraft's capturing window (a single
// re-read + capture PUT + commit, seconds) AND the sweep interval, so a merely-
// in-flight healthy run is never reclaimed underneath itself. The recovery
// re-reads the PI: a `succeeded` PI (the capture DID land) commits `captured`
// idempotently off amount_received; a still-`requires_capture` PI re-captures
// under the SAME stable idempotency key, so a lost first capture never
// double-charges.
const ROBOCALL_CAPTURING_STALE_MINUTES = 15

// Kill-switch, default OFF. Capture MOVES REAL MONEY off the hold; it must not
// auto-run until deliberately enabled. Separate from ROBOCALL_SEND_ENABLED so
// the actual charge is a distinct, second deliberate act from enabling dialing —
// two switches guard the two money-moving steps of the supervised live test.
const isCaptureEnabled = () => process.env.ROBOCALL_CAPTURE_ENABLED === 'true'

// The capture half of settlement: for a robocall run the completion sweep left
// in `settling` with a confirmed `completedCallCount`, capture the authorized
// hold for the ACTUAL billable amount — always <= the authorized amount (INV-1;
// Stripe releases the remainder). The single-owner claim (`settling →
// capturing`) elects one capturer, a FRESH PaymentIntent re-read decides the
// branch (never trust the persisted state before moving money), and the terminal
// is `captured` (charged), `voided` (zero billable), or `uncollectable` (the
// hold lapsed before capture — surfaced CRITICAL, never silently dropped and
// never blind-charged; the fresh-charge recovery is the reconciliation slice).
@Injectable()
export class OutreachRobocallCaptureService extends createPrismaBase(
  MODELS.OutreachRobocall,
) {
  constructor(
    private readonly stripe: StripeService,
    private readonly analytics: AnalyticsService,
    private readonly orphanedHolds: RobocallOrphanedHoldService,
  ) {
    super()
  }

  // No CronLockService / whole-job lock: capture is idempotent per record behind
  // the `settling → capturing` claim, so two replicas racing both SELECT the
  // same candidates but only ONE wins each row's claim. @Cron (not @Interval) so
  // the schedule survives deploys and every replica fires on the same instant.
  // Prod-only (a real charge; Stripe is stubbed on dev/preview) AND kill-switch-
  // gated (default OFF — the deliberate enable for the actual capture).
  @Cron(ROBOCALL_CAPTURE_SWEEP_CRON, {
    name: ROBOCALL_CAPTURE_SWEEP_JOB,
    timeZone: EASTERN_TIMEZONE,
  })
  async sweepCaptures(): Promise<void> {
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') return
    if (!isCaptureEnabled()) return

    // Expiry-priority (captureBefore asc), NOT FIFO: under a backlog the holds
    // nearest their Stripe auto-expiry must capture first so none lapse
    // uncaptured. A settling row always carries the authorization + count, but
    // guard on both so a data anomaly is filtered here rather than charged blind.
    const candidates = await this.model.findMany({
      where: {
        settleState: RobocallSettleState.settling,
        authorizationIntentId: { not: null },
        completedCallCount: { not: null },
      },
      orderBy: { captureBefore: Prisma.SortOrder.asc },
      select: { outreachId: true },
    })

    for (const { outreachId } of candidates) {
      try {
        await this.captureDraft(outreachId)
      } catch (err) {
        // Per-record isolation: one draft's Stripe/DB failure must not abort
        // capturing the rest. The next sweep re-claims and retries it.
        this.logger.error(
          { err, outreachId },
          'robocall capture failed for a draft; continuing sweep',
        )
      }
    }

    // STALE-CAPTURING RECOVERY: a row stranded in `capturing` past the stale
    // window is a crashed run (a process that died between the Stripe capture and
    // the DB commit). It is invisible to the `settling` claim above yet its hold
    // may already be captured, so it MUST be reconciled — never left with money
    // taken and no receipt. The recovery re-reads the PI and settles idempotently
    // (a `succeeded` PI records amount_received; a `requires_capture` PI
    // re-captures under the stable key, so no double charge).
    const staleCutoff = subMinutes(new Date(), ROBOCALL_CAPTURING_STALE_MINUTES)
    const stale = await this.model.findMany({
      where: {
        settleState: RobocallSettleState.capturing,
        updatedAt: { lt: staleCutoff },
      },
      orderBy: { captureBefore: Prisma.SortOrder.asc },
      select: { outreachId: true },
    })

    for (const { outreachId } of stale) {
      try {
        await this.recoverStaleCapturing(outreachId)
      } catch (err) {
        this.logger.error(
          { err, outreachId },
          'robocall stale-capturing recovery failed; continuing sweep',
        )
      }
    }
  }

  async captureDraft(outreachId: number): Promise<void> {
    // CLAIM: elect exactly one capturer. Only a settling draft transitions to
    // capturing; a concurrent winner or an already-advanced draft makes count 0.
    const claim = await this.model.updateMany({
      where: { outreachId, settleState: RobocallSettleState.settling },
      data: { settleState: RobocallSettleState.capturing },
    })
    if (claim.count === 0) return
    await this.settleClaimed(outreachId)
  }

  // Recovers a `capturing` row stranded past the stale window. First re-claims it
  // with a stale-guarded CAS (writing `capturing` bumps @updatedAt, so a
  // concurrent recoverer finds updatedAt no longer < cutoff and loses — electing
  // exactly one settler), then settles it via the SAME path captureDraft uses.
  // The fresh PI re-read there resolves whether the pre-crash capture landed
  // (succeeded → record it) or not (requires_capture → re-capture under the
  // stable key), so recovery never double-charges.
  private async recoverStaleCapturing(outreachId: number): Promise<void> {
    const staleCutoff = subMinutes(new Date(), ROBOCALL_CAPTURING_STALE_MINUTES)
    const reclaim = await this.model.updateMany({
      where: {
        outreachId,
        settleState: RobocallSettleState.capturing,
        updatedAt: { lt: staleCutoff },
      },
      data: { settleState: RobocallSettleState.capturing },
    })
    if (reclaim.count === 0) return
    await this.settleClaimed(outreachId)
  }

  // Settles a row THIS caller already owns in `capturing` (via captureDraft's
  // claim or recoverStaleCapturing's stale reclaim): re-read the PI and capture /
  // reconcile / void / park uncollectable. Every branch moves the row out of
  // capturing (to a terminal, or back to settling to retry) so it never strands.
  private async settleClaimed(outreachId: number): Promise<void> {
    // Re-read the authoritative row (we own the capturing claim, so no concurrent
    // writer can move it out of capturing).
    const draft = await this.findFirst({
      where: { outreachId },
      include: {
        outreach: { include: { campaign: { include: { user: true } } } },
      },
    })
    if (!draft) {
      this.logger.error(
        { outreachId },
        'CRITICAL robocall capture: claimed row vanished; cannot capture',
      )
      return
    }

    const {
      authorizationIntentId,
      authorizedAmountInCents,
      completedCallCount,
    } = draft
    // A settling row MUST carry these. A null here is a data anomaly, never a
    // reason to charge blind: surface it CRITICAL and park in uncollectable.
    if (
      authorizationIntentId == null ||
      authorizedAmountInCents == null ||
      completedCallCount == null
    ) {
      this.logger.error(
        { outreachId },
        'CRITICAL robocall capture: settling row missing intent/amount/count; ' +
          'parked uncollectable, not charged',
      )
      await this.transitionFromCapturing(
        outreachId,
        RobocallSettleState.uncollectable,
      )
      return
    }

    const userId = draft.outreach.campaign?.user?.id

    // FRESH re-read: never trust the persisted state before moving money. The PI
    // status decides the branch.
    let intent: Awaited<ReturnType<StripeService['retrievePaymentIntent']>>
    try {
      intent = await this.stripe.retrievePaymentIntent(authorizationIntentId)
    } catch (err) {
      // Transient read failure: no money moved. Release the claim back to
      // settling so a later sweep retries.
      this.logger.error(
        { err, outreachId },
        'robocall capture PI read failed; reverting to settling to retry',
      )
      await this.transitionFromCapturing(
        outreachId,
        RobocallSettleState.settling,
      )
      return
    }

    // ALREADY CAPTURED (idempotent reconcile): a prior capture committed at
    // Stripe but lost its DB commit. Record the real captured amount and settle;
    // do NOT capture again. If amount_received is somehow absent, fall back to the
    // amount we WOULD have captured (min(actual, authorized)) — never the
    // authorized ceiling, which would overstate an undercharge run's receipt.
    if (intent.status === 'succeeded') {
      const captured =
        intent.amount_received ??
        Math.min(
          calcRobocallTotalInCents(completedCallCount),
          authorizedAmountInCents,
        )
      await this.commitCaptured(
        outreachId,
        captured,
        userId,
        completedCallCount,
      )
      return
    }

    // HOLD LAPSED: expired / canceled / never capturable. A zero-connected run
    // owes nothing — the $2 number fee is released on ANY run that connected zero
    // calls — so a gone hold is the expected, correct outcome → `voided`, not a
    // false CRITICAL. A run with at least one connected call and a gone hold IS
    // money owed we could not capture (calls + fee) → CRITICAL + park
    // uncollectable so the fresh-charge recovery collects it; never blind-charge
    // here. The guard is the CALLS-only amount, which is 0 only for a
    // zero-connected run.
    if (intent.status !== 'requires_capture') {
      if (calcRobocallAmountInCents(completedCallCount) <= 0) {
        this.logger.info(
          { outreachId, intentStatus: intent.status },
          'robocall capture: zero-billable run with a gone hold; voided',
        )
        await this.transitionFromCapturing(
          outreachId,
          RobocallSettleState.voided,
        )
        return
      }
      this.logger.error(
        { outreachId, intentStatus: intent.status },
        'CRITICAL robocall capture: hold not capturable at capture time; ' +
          'parked uncollectable, delivered run uncharged',
      )
      await this.transitionFromCapturing(
        outreachId,
        RobocallSettleState.uncollectable,
      )
      return
    }

    // ZERO-CONNECTED: no call actually connected, so the run owes nothing —
    // release the hold entirely, INCLUDING the $2 number fee. The fee is
    // collected only when at least one call connects; we do not bill a candidate
    // whose robocall reached no one. Guard on the CALLS-only amount, since the
    // total is never <= 0 (the fee floor). Void the hold and release.
    if (calcRobocallAmountInCents(completedCallCount) <= 0) {
      await this.stripe.voidHold(authorizationIntentId)
      // Record the hold so the reconcile sweep re-voids it if this best-effort
      // void did not land (best-effort — never fail the settle over it).
      try {
        await this.orphanedHolds.record(
          authorizationIntentId,
          outreachId,
          'zero_billable',
        )
      } catch (err) {
        this.logger.error(
          { err, outreachId, paymentIntentId: authorizationIntentId },
          'robocall: failed to record orphaned hold for reconcile',
        )
      }
      await this.transitionFromCapturing(outreachId, RobocallSettleState.voided)
      this.logger.info(
        { outreachId, completedCallCount },
        'robocall capture: zero-connected run; voided the hold and released ' +
          'the number fee',
      )
      return
    }

    // INV-1: capture the ACTUAL amount (calls + number fee), clamped to never
    // exceed the authorized hold. Stripe releases any remainder.
    const actual = calcRobocallTotalInCents(completedCallCount)
    const captureAmount = Math.min(actual, authorizedAmountInCents)

    try {
      // Stable idempotency key (amount is deterministic per outreach — the count
      // is frozen), so a retried capture replays instead of double-charging.
      await this.stripe.capturePaymentIntent(
        authorizationIntentId,
        captureAmount,
        `robocall-capture-${outreachId}`,
      )
    } catch (err) {
      // Capture failed. No commit yet, so revert to settling and retry next
      // sweep — the re-read there sees `succeeded` (if it in fact captured) and
      // reconciles, or `canceled` (if the auth died) and parks uncollectable.
      this.logger.error(
        { err, outreachId },
        'robocall capture call failed; reverting to settling to retry',
      )
      await this.transitionFromCapturing(
        outreachId,
        RobocallSettleState.settling,
      )
      return
    }

    await this.commitCaptured(
      outreachId,
      captureAmount,
      userId,
      completedCallCount,
    )
  }

  // Commits capturing → captured, records the captured amount, and emits the
  // Receipt milestone once. The CAS guards on capturing so a lost race (the row
  // moved out from under the claim) writes nothing and is surfaced below.
  private async commitCaptured(
    outreachId: number,
    capturedAmountInCents: number,
    userId: number | undefined,
    completedCallCount: number,
  ): Promise<void> {
    const commit = await this.model.updateMany({
      where: { outreachId, settleState: RobocallSettleState.capturing },
      data: {
        settleState: RobocallSettleState.captured,
        capturedAmountInCents,
      },
    })
    // Money already captured at Stripe: a lost commit (the row moved underneath)
    // must be surfaced, never silently swallowed — capture-XOR-anything is only
    // as safe as the claim, and this should be impossible while we hold it.
    if (commit.count === 0) {
      this.logger.error(
        { outreachId, capturedAmountInCents },
        'CRITICAL robocall capture: captured at Stripe but commit found no ' +
          'capturing row; charged amount may be unrecorded',
      )
      return
    }
    this.logger.info(
      { outreachId, capturedAmountInCents, completedCallCount },
      'robocall run captured',
    )
    // The run dialed and settled, so the history UI must show "Completed"
    // instead of staying "Sending"/"Scheduled". Best-effort + CAS-guarded on the
    // pre-terminal visible states so it is idempotent and never flips a
    // canceled/failed/already-completed row — mirrors markSpineScheduled/
    // markSpineInProgress/markSpineFailed. A miss only leaves stale history; the
    // money already committed, so it must never throw out of the capture path.
    await this.markSpineCompleted(outreachId)
    if (userId == null) {
      this.logger.error(
        { outreachId },
        'robocall capture: no user on the run; skipping receipt milestone',
      )
      return
    }
    await this.emitReceipt(userId, outreachId, capturedAmountInCents)
  }

  // Moves the row out of the capturing claim to a terminal (or back to settling
  // to retry). CAS-guarded on capturing so a row that somehow moved is a no-op.
  private async transitionFromCapturing(
    outreachId: number,
    to: RobocallSettleState,
  ): Promise<void> {
    await this.model.updateMany({
      where: { outreachId, settleState: RobocallSettleState.capturing },
      data: { settleState: to },
    })
  }

  // Advance the spine to `completed` so the history UI shows "Completed" once a
  // dialed run settles + captures. CAS-guarded on the pre-terminal visible states
  // (pending/in_progress) so it never overrides canceled/failed and is idempotent
  // on an already-completed row. Best-effort, like the sibling markSpine* helpers.
  private async markSpineCompleted(outreachId: number): Promise<void> {
    try {
      await this.client.outreach.updateMany({
        where: {
          id: outreachId,
          status: {
            in: [OutreachStatus.pending, OutreachStatus.in_progress],
          },
        },
        data: { status: OutreachStatus.completed },
      })
    } catch (err) {
      this.logger.error(
        { err, outreachId },
        'robocall: failed to advance spine to completed',
      )
    }
  }

  // Best-effort receipt: the capture already committed, so a Segment failure must
  // not throw — a lost receipt is recoverable, a re-thrown one would re-run the
  // whole capture path on a captured run. Deterministic messageId dedups a
  // replay to one email.
  private async emitReceipt(
    userId: number,
    outreachId: number,
    capturedAmountInCents: number,
  ): Promise<void> {
    // HubSpot stores the value as-is with no currency conversion, so the receipt
    // email must receive dollars, not cents.
    const capturedAmountInDollars = Math.round(capturedAmountInCents) / 100
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
}
