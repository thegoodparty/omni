import { HttpException, Injectable } from '@nestjs/common'
import { addDays, isAfter } from 'date-fns'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import type { JobRun, ScheduleData } from '@/jobs/jobs.registry'
import { JobsService } from '@/jobs/jobs.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { ROBOCALL_HOLD_WINDOW_DAYS } from '@/shared/util/robocallHold.util'
import {
  OutreachStatus,
  OutreachType,
  Prisma,
  RobocallSettleState,
} from '../../generated/prisma'
import { OutreachRobocallHoldService } from './outreachRobocallHold.service'
import { VENDOR_CRONS_ENABLED } from 'src/shared/util/appEnvironment.util'

// The sweeps find their drafts with these, and each draft's job reads the
// draft back through the same filter, so a job that waited in the queue does
// nothing for a draft that has since moved on.
//
// Entered the window, still future: a card was chosen at schedule time (both
// ids persisted) and the send now falls inside ROBOCALL_HOLD_WINDOW_DAYS.
const deferredHoldDue = (now: Date): Prisma.OutreachRobocallWhereInput => ({
  settleState: RobocallSettleState.pending_payment,
  paymentMethodId: { not: null },
  stripeCustomerId: { not: null },
  outreach: {
    outreachType: OutreachType.robocall,
    date: { gt: now, lte: addDays(now, ROBOCALL_HOLD_WINDOW_DAYS) },
  },
})

const deferredExpired = (now: Date): Prisma.OutreachRobocallWhereInput => ({
  settleState: RobocallSettleState.pending_payment,
  paymentMethodId: { not: null },
  stripeCustomerId: { not: null },
  outreach: {
    outreachType: OutreachType.robocall,
    // Deadline reached: the send passed and no hold was ever placed.
    date: { lte: now },
  },
})

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
// and strand a retry storm. None of that is reimplemented here. A SECOND
// schedule here is the cancel-at-deadline cleanup: a deferred draft whose send
// passes before a hold is ever placed (repeated transient placement failures,
// or a send that fell past its date between daily passes) is transitioned
// pending_payment → cancelled + emits Canceled — vendor-cron gated, moving no
// money.
@Injectable()
export class OutreachRobocallDeferredHoldService extends createPrismaBase(
  MODELS.OutreachRobocall,
) {
  constructor(
    private readonly holds: OutreachRobocallHoldService,
    private readonly analytics: AnalyticsService,
    private readonly jobs: JobsService,
  ) {
    super()
  }

  // The robocallDeferredHoldSweep schedule (src/jobs/jobs.registry.ts) sends
  // one robocallDeferredHoldPlace job per draft. Placement is idempotent per
  // record behind authorizeHold's claim CAS, which only matches a
  // pending_payment (or hold_failed) draft, so a job that runs twice places
  // one hold — a draft already moved to `authorized` is a no-op.
  //
  // VENDOR_CRONS_ENABLED (docs/scheduled-jobs.md § Vendor-cron gate): it reserves
  // real money off-session, so it must not fire where Stripe is live and the
  // deploy is not prod. Each job checks it too, since any gp-api pointed at a
  // database works its queues.
  async sweepDeferredHolds(sweep: JobRun<ScheduleData>): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const candidates = await this.model.findMany({
      where: deferredHoldDue(new Date()),
      select: { outreachId: true },
    })
    await this.jobs.sendMany(
      'robocallDeferredHoldPlace',
      candidates.map(({ outreachId }) => ({
        data: { outreachId },
        key: `${outreachId}:${sweep.id}`,
      })),
    )
  }

  async placeDeferredHold(job: JobRun<{ outreachId: number }>): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const { outreachId } = job.data
    const draft = await this.model.findFirst({
      where: { outreachId, ...deferredHoldDue(new Date()) },
      include: {
        outreach: {
          include: {
            campaign: { include: { user: true } },
            organization: true,
          },
        },
      },
    })
    if (!draft) return
    const { campaign, organization } = draft.outreach
    // A robocall draft always carries a campaign, user, and org; a row
    // missing any of these can't place a hold, so log and skip.
    if (
      !campaign ||
      !campaign.user ||
      !organization ||
      !draft.paymentMethodId
    ) {
      this.logger.error(
        { outreachId },
        'deferred robocall hold missing user/org/card; skipping',
      )
      return
    }
    try {
      // Pass NO paymentMethodId: authorizeHold re-reads the card persisted on
      // the row AFTER it wins the placement claim (so the sweep can never bill
      // a card a concurrent re-authorize replaced after this snapshot), and on
      // the deferred path it escalates a permanent card failure to hold_failed
      // ATOMICALLY (returning hold_failed, not throwing) — so there is NO
      // separate fallible escalation here that could strand a retry storm. Only
      // a transient/non-card error reaches this catch; the draft stays
      // pending_payment.
      await this.holds.authorizeHold(
        campaign.user,
        campaign,
        organization,
        outreachId,
      )
    } catch (err) {
      // A 4xx is an outcome a retry minutes later cannot change, and one of
      // them (the hold would expire before capture) voids a hold it just
      // placed, so retrying would place and void another. It waits for the
      // next daily pass, as before. A transient failure reverted the claim
      // without spending its idempotency key, so the retry replays the same
      // hold at Stripe rather than placing a second one.
      if (err instanceof HttpException && err.getStatus() < 500) {
        this.logger.error(
          { err, outreachId },
          'deferred robocall hold placement refused; retrying next daily pass',
        )
        return
      }
      throw err
    }
  }

  // Cancel-at-deadline cleanup for deferred drafts whose send passed WITHOUT a
  // hold ever being placed. The placement sweep only selects FUTURE sends, so
  // once the send date passes — a draft whose window was missed by repeated
  // transient placement failures, or one whose send fell past its date between
  // daily passes — no other sweep can touch it, and it would strand in
  // pending_payment forever. Cancel + notify move no money. Same gate. The
  // robocallDeferredCancelSweep schedule sends one robocallDeferredCancel job
  // per draft; the claim CAS in cancelExpiredDeferred elects one canceller.
  async sweepExpiredDeferred(sweep: JobRun<ScheduleData>): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const candidates = await this.model.findMany({
      where: deferredExpired(new Date()),
      select: { outreachId: true },
    })
    await this.jobs.sendMany(
      'robocallDeferredCancel',
      candidates.map(({ outreachId }) => ({
        data: { outreachId },
        key: `${outreachId}:${sweep.id}`,
      })),
    )
  }

  // Only a database failure escapes the cancel (the email is best-effort), so
  // it throws and the job retries behind the claim CAS.
  async cancelExpiredDeferredDraft(
    job: JobRun<{ outreachId: number }>,
  ): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const { outreachId } = job.data
    const expired = await this.model.findFirst({
      where: { outreachId, ...deferredExpired(new Date()) },
      select: { outreachId: true },
    })
    if (!expired) return
    await this.cancelExpiredDeferred(outreachId)
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

    // A robocall row is always campaign-scoped (only social outreach can be
    // org-only, outreach.prisma).
    await this.emitCanceled(draft.outreach.campaign!.userId, outreachId)
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
