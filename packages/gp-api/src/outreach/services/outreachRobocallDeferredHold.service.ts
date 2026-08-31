import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { addDays, isAfter } from 'date-fns'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { AnalyticsService } from '@/analytics/analytics.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { ROBOCALL_HOLD_WINDOW_DAYS } from '@/shared/util/robocallHold.util'
import {
  OutreachStatus,
  OutreachType,
  RobocallSettleState,
} from '../../generated/prisma'
import { OutreachRobocallHoldService } from './outreachRobocallHold.service'

// Daily, a non-:00 minute distinct from the other robocall crons (staging runs
// on the 7,17,27,37,47,57 * * * * slot). A daily cadence is plenty: the 3-day
// window means a draft that enters it is still days from its send, so placing
// the hold on the next daily pass leaves ample room.
const ROBOCALL_DEFERRED_HOLD_SWEEP_CRON = '13 8 * * *'
const ROBOCALL_DEFERRED_HOLD_SWEEP_JOB = 'robocallDeferredHoldSweep'

// Cancel-at-deadline for deferred drafts, every 15 minutes on free minute slots
// (send :04.., staging :07.., hold-failure cancel :11.., inbound :30,
// completion :00 are all taken). Runs often so a just-passed send deadline is
// cancelled + the candidate notified promptly.
const ROBOCALL_DEFERRED_CANCEL_SWEEP_CRON = '1,16,31,46 * * * *'
const ROBOCALL_DEFERRED_CANCEL_SWEEP_JOB = 'robocallDeferredCancelSweep'

// Kill-switch, default OFF. This sweep RESERVES REAL MONEY off-session without
// the candidate present, so it must not auto-run until deliberately enabled —
// same shape as MEETINGS_AUTOMATION_ENABLED.
const isDeferredHoldEnabled = () =>
  process.env.ROBOCALL_DEFERRED_HOLD_ENABLED === 'true'

// Places the deferred authorization hold once a scheduled robocall enters the
// hold window. At schedule time a send more than ROBOCALL_HOLD_WINDOW_DAYS out
// returns `deferred` and places nothing, persisting only the chosen card
// (paymentMethodId + stripeCustomerId) on the still-pending_payment draft. This
// daily sweep finds those drafts once their send enters the window and calls
// OutreachRobocallHoldService.authorizeHold (passing NO card — it re-reads the
// persisted one after the claim), off-session. It is only the trigger + context
// loader: authorizeHold owns the placement CAS, the estimate re-derivation, the
// Stripe hold, the capture-window fit, the HoldPlaced/HoldFailed milestones, AND
// the atomic hold_failed escalation of a permanent card failure (returned, not
// thrown) — so this sweep has no separate escalation call that could itself fail
// and strand a retry storm. None of that is reimplemented here. A SECOND @Cron
// here is the cancel-at-deadline cleanup: a deferred draft whose send passes
// before a hold is ever placed (the leak when placement stays disabled past the
// window) is transitioned pending_payment → cancelled + emits Canceled — prod-
// only but NOT kill-switched, so the drafts stranded by a disabled placement
// flag are still rescued.
@Injectable()
export class OutreachRobocallDeferredHoldService extends createPrismaBase(
  MODELS.OutreachRobocall,
) {
  constructor(
    private readonly holds: OutreachRobocallHoldService,
    private readonly analytics: AnalyticsService,
  ) {
    super()
  }

  // No CronLockService / whole-job lock: placement is idempotent per record
  // behind authorizeHold's claim CAS, which only matches a pending_payment (or
  // hold_failed) draft, so two replicas racing this sweep both SELECT the same
  // candidates but only ONE wins each draft's claim — a draft already moved to
  // `authorized` is a no-op on the next pass. @Cron (not @Interval) so the
  // schedule survives deploys and every replica fires on the same instant.
  //
  // Prod-only (docs/scheduled-jobs.md § Prod-only guard) AND kill-switch-gated:
  // it reserves real money off-session, so it must not fire on dev/preview where
  // Stripe is stubbed, and must stay OFF until explicitly enabled.
  @Cron(ROBOCALL_DEFERRED_HOLD_SWEEP_CRON, {
    name: ROBOCALL_DEFERRED_HOLD_SWEEP_JOB,
    timeZone: EASTERN_TIMEZONE,
  })
  async sweepDeferredHolds(): Promise<void> {
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') return
    if (!isDeferredHoldEnabled()) return

    const now = new Date()
    // Entered the window, still future: a card was chosen at schedule time (both
    // ids persisted) and the send now falls inside ROBOCALL_HOLD_WINDOW_DAYS.
    const candidates = await this.model.findMany({
      where: {
        settleState: RobocallSettleState.pending_payment,
        paymentMethodId: { not: null },
        stripeCustomerId: { not: null },
        outreach: {
          outreachType: OutreachType.robocall,
          date: { gt: now, lte: addDays(now, ROBOCALL_HOLD_WINDOW_DAYS) },
        },
      },
      include: {
        outreach: {
          include: {
            campaign: { include: { user: true } },
            organization: true,
          },
        },
      },
    })

    for (const draft of candidates) {
      const { campaign, organization } = draft.outreach
      const user = campaign.user
      // A robocall draft always carries a user and org; a row missing either
      // can't place a hold, so log and skip rather than throw the whole sweep.
      if (!user || !organization || !draft.paymentMethodId) {
        this.logger.error(
          { outreachId: draft.outreachId },
          'deferred robocall hold missing user/org/card; skipping',
        )
        continue
      }
      try {
        // Pass NO paymentMethodId: authorizeHold re-reads the card persisted on
        // the row AFTER it wins the placement claim (so the sweep can never bill
        // a card a concurrent re-authorize replaced after this snapshot), and on
        // the deferred path it escalates a permanent card failure to hold_failed
        // ATOMICALLY (returning hold_failed, not throwing) — so there is NO
        // separate fallible escalation here that could strand a retry storm. Only
        // a transient/non-card error reaches this catch; the draft stays
        // pending_payment and the next daily pass retries it.
        await this.holds.authorizeHold(
          user,
          campaign,
          organization,
          draft.outreachId,
        )
      } catch (err) {
        // Per-record isolation: one draft's transient failure must not abort the
        // rest. It stays pending_payment; the next sweep retries it in-window.
        this.logger.error(
          { err, outreachId: draft.outreachId },
          'deferred robocall hold placement failed; continuing sweep',
        )
      }
    }
  }

  // Cancel-at-deadline cleanup for deferred drafts whose send passed WITHOUT a
  // hold ever being placed. Prod-only, but deliberately NOT behind the
  // ROBOCALL_DEFERRED_HOLD_ENABLED kill-switch: the leak this rescues happens
  // PRECISELY when placement is disabled (the flag defaults OFF; if it stays off
  // for >= ROBOCALL_HOLD_WINDOW_DAYS while a deferred draft exists, the send
  // passes and the placement sweep — which only selects future sends — can never
  // touch it again). Gating this on the same flag would let those exact stranded
  // drafts leak forever. Cancel + notify move no money, so nothing to gate.
  @Cron(ROBOCALL_DEFERRED_CANCEL_SWEEP_CRON, {
    name: ROBOCALL_DEFERRED_CANCEL_SWEEP_JOB,
    timeZone: EASTERN_TIMEZONE,
  })
  async sweepExpiredDeferred(): Promise<void> {
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') return

    const now = new Date()
    const candidates = await this.model.findMany({
      where: {
        settleState: RobocallSettleState.pending_payment,
        paymentMethodId: { not: null },
        stripeCustomerId: { not: null },
        outreach: {
          outreachType: OutreachType.robocall,
          // Deadline reached: the send passed and no hold was ever placed.
          date: { lte: now },
        },
      },
      select: { outreachId: true },
    })

    for (const { outreachId } of candidates) {
      try {
        await this.cancelExpiredDeferred(outreachId)
      } catch (err) {
        // Per-record isolation: one draft's failure must not abort the sweep.
        this.logger.error(
          { err, outreachId },
          'deferred robocall cancel failed for a draft; continuing sweep',
        )
      }
    }
  }

  async cancelExpiredDeferred(outreachId: number): Promise<void> {
    const draft = await this.findFirst({
      where: {
        outreachId,
        outreach: { outreachType: OutreachType.robocall },
      },
      include: { outreach: { include: { campaign: true } } },
    })
    if (!draft) return

    const sendAt = draft.outreach.date
    // Reschedule-race guard: if the candidate pushed the send back into the
    // future between the sweep's query and now, it is the placement sweep's job
    // again — do not cancel a still-schedulable draft.
    if (!sendAt || isAfter(sendAt, new Date())) return

    // CAS: elect a single canceller of this deferred, card-persisted draft. count
    // 0 means a concurrent runner cancelled it, or a concurrent authorize
    // advanced it past pending_payment (placed/failed the hold) — either way the
    // Canceled email fires once. A deferred draft never got a hold, so there is
    // NO Stripe hold to void; just mark cancelled + email. No Stripe is touched.
    const claim = await this.model.updateMany({
      where: {
        outreachId,
        settleState: RobocallSettleState.pending_payment,
        paymentMethodId: { not: null },
        stripeCustomerId: { not: null },
      },
      data: { settleState: RobocallSettleState.cancelled },
    })
    if (claim.count === 0) return

    // The pay step's card-save advanced the spine to `pending` (visible in
    // history); reflect the cancel there too, else the row lingers as "In
    // review" forever.
    await this.markSpineCanceled(outreachId)

    await this.emitCanceled(draft.outreach.campaign.userId, outreachId)
  }

  // Flip the spine `pending → canceled` after the satellite cancel. Guarded on
  // `pending` (idempotent, and never touches a row that never became visible).
  // Best-effort: the satellite cancel already committed, so a transient failure
  // must not strand the sweep — log and move on (mirrors emitCanceled).
  private async markSpineCanceled(outreachId: number): Promise<void> {
    try {
      await this.client.outreach.updateMany({
        where: { id: outreachId, status: OutreachStatus.pending },
        data: { status: OutreachStatus.canceled },
      })
    } catch (err) {
      this.logger.error(
        { err, outreachId },
        'robocall: failed to cancel spine after deferred cancel',
      )
    }
  }

  // Best-effort Canceled milestone (deterministic messageId so a replay dedups
  // to one email). The cancel transition already committed, so a transient
  // Segment failure must not throw and strand the draft — the row is correctly
  // cancelled regardless, only the email is lost.
  private async emitCanceled(
    userId: number,
    outreachId: number,
  ): Promise<void> {
    try {
      await this.analytics.track(
        userId,
        EVENTS.Robocall.Canceled,
        { outreachId },
        undefined,
        `${outreachId}:canceled`,
      )
    } catch (err) {
      this.logger.error(
        { err, outreachId },
        'deferred robocall cancel milestone emit failed',
      )
    }
  }
}
