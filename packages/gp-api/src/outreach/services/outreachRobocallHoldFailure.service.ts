import { Injectable } from '@nestjs/common'
import { format, isAfter, subHours } from 'date-fns'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import type { JobRun, ScheduleData } from '@/jobs/jobs.registry'
import { JobsService } from '@/jobs/jobs.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import {
  OutreachType,
  Prisma,
  RobocallSettleState,
} from '../../generated/prisma'
import { VENDOR_CRONS_ENABLED } from 'src/shared/util/appEnvironment.util'

// A failed hold (a declined or dead card) leaves the draft `hold_failed`. This
// slice runs the two time-based follow-ups on that terminal: a daily "fix your
// card" reminder while the send is still ahead, and a cancel once the send
// deadline passes with the card never fixed (never send unpaid). Retry-on-card-
// update is a SEPARATE later slice — it needs a Stripe payment_method webhook
// trigger and is deliberately not built here.

// A draft is re-reminded only once its last reminder is older than this. Under
// a full day so the daily reminder schedule always re-fires (a reminder from
// 24h ago clears a 23h floor) while a same-day double sweep is denied. The DB
// stamp is the primary once/day guard; the per-day Segment messageId is the
// downstream dedup backstop.
const ROBOCALL_REMINDER_MIN_INTERVAL_HOURS = 23

// The sweeps find their drafts with these, and each draft's job reads the
// draft back through the same filter, so a job that waited in the queue does
// nothing for a draft that has since moved on.
const reminderDue = (now: Date): Prisma.OutreachRobocallWhereInput => ({
  settleState: RobocallSettleState.hold_failed,
  outreach: {
    outreachType: OutreachType.robocall,
    // Send still ahead: a failed hold whose deadline has passed is the
    // cancel sweep's job, not the reminder's.
    date: { gt: now },
  },
  OR: [
    { lastReminderSentAt: null },
    {
      lastReminderSentAt: {
        lt: subHours(now, ROBOCALL_REMINDER_MIN_INTERVAL_HOURS),
      },
    },
  ],
})

const cancelDue = (now: Date): Prisma.OutreachRobocallWhereInput => ({
  settleState: RobocallSettleState.hold_failed,
  outreach: {
    outreachType: OutreachType.robocall,
    // Deadline reached: the candidate never fixed the card in time.
    date: { lte: now },
  },
})

// Runs the daily reminder + cancel-at-deadline follow-ups on `hold_failed`
// robocall drafts. Each unit of work is idempotent per record behind an atomic
// claim — the once/day `lastReminderSentAt` stamp CAS for the reminder, the
// single-owner `hold_failed → cancelled` CAS for the cancel — so two replicas
// racing a sweep both SELECT the same candidates but only ONE wins each draft,
// and the email fires once. The per-record CAS is the dedup: these neither
// dial nor charge — cancel places/voids nothing (a declined hold reserved no
// money) — so the VENDOR_CRONS_ENABLED guard is all they need. Each runs on a pg-boss schedule (src/jobs/jobs.registry.ts) that
// sends one job per draft.
@Injectable()
export class OutreachRobocallHoldFailureService extends createPrismaBase(
  MODELS.OutreachRobocall,
) {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly jobs: JobsService,
  ) {
    super()
  }

  // VENDOR_CRONS_ENABLED (docs/scheduled-jobs.md § Vendor-cron gate): reminder/cancel emails
  // route through the real Segment → HubSpot path, and cancelling a live draft is
  // a state change we don't want firing against dev/preview data. Each job
  // checks it too, since any gp-api pointed at a database works its queues.
  async sweepHoldFailureReminders(sweep: JobRun<ScheduleData>): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const candidates = await this.model.findMany({
      where: reminderDue(new Date()),
      select: { outreachId: true },
    })
    await this.jobs.sendMany(
      'robocallHoldFailureRemind',
      candidates.map(({ outreachId }) => ({
        data: { outreachId },
        key: `${outreachId}:${sweep.id}`,
      })),
    )
  }

  // Only a database failure escapes (the email is best-effort), so it throws
  // and the job retries behind the once-a-day stamp CAS.
  async remindDueDraft(job: JobRun<{ outreachId: number }>): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const { outreachId } = job.data
    const now = new Date()
    const due = await this.model.findFirst({
      where: { outreachId, ...reminderDue(now) },
      select: { outreachId: true },
    })
    if (!due) return
    await this.remindHoldFailure(outreachId, now)
  }

  async sweepHoldFailureCancellations(
    sweep: JobRun<ScheduleData>,
  ): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const candidates = await this.model.findMany({
      where: cancelDue(new Date()),
      select: { outreachId: true },
    })
    await this.jobs.sendMany(
      'robocallHoldFailureCancel',
      candidates.map(({ outreachId }) => ({
        data: { outreachId },
        key: `${outreachId}:${sweep.id}`,
      })),
    )
  }

  async cancelDueDraft(job: JobRun<{ outreachId: number }>): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const { outreachId } = job.data
    const due = await this.model.findFirst({
      where: { outreachId, ...cancelDue(new Date()) },
      select: { outreachId: true },
    })
    if (!due) return
    await this.cancelExpiredHoldFailure(outreachId)
  }

  async remindHoldFailure(outreachId: number, now: Date): Promise<void> {
    const draft = await this.findFirst({
      where: {
        outreachId,
        outreach: { outreachType: OutreachType.robocall },
      },
      include: { outreach: { include: { campaign: true } } },
    })
    if (!draft) return

    const sendAt = draft.outreach.date
    if (!sendAt || !isAfter(sendAt, now)) return

    // CLAIM: stamp lastReminderSentAt, electing a single reminder per ~day per
    // draft. A concurrent sweep (or a re-run in the same day) finds the row no
    // longer null-or-stale and reads count 0, so the email fires once.
    const reminderCutoff = subHours(now, ROBOCALL_REMINDER_MIN_INTERVAL_HOURS)
    const claim = await this.model.updateMany({
      where: {
        outreachId,
        settleState: RobocallSettleState.hold_failed,
        OR: [
          { lastReminderSentAt: null },
          { lastReminderSentAt: { lt: reminderCutoff } },
        ],
      },
      data: { lastReminderSentAt: now },
    })
    if (claim.count === 0) return

    // messageId changes per day so a double sweep in the same day dedups to one
    // email downstream — the DB stamp above is the primary guard, this is the
    // Segment backstop.
    // A robocall row is always campaign-scoped (only social outreach can be
    // org-only, outreach.prisma).
    await this.emitMilestone(
      draft.outreach.campaign!.userId,
      outreachId,
      EVENTS.Robocall.Reminder,
      `${outreachId}:reminder:${format(now, 'yyyy-MM-dd')}`,
    )
  }

  async cancelExpiredHoldFailure(outreachId: number): Promise<void> {
    const draft = await this.findFirst({
      where: {
        outreachId,
        outreach: { outreachType: OutreachType.robocall },
      },
      include: { outreach: { include: { campaign: true } } },
    })
    if (!draft) return

    const sendAt = draft.outreach.date
    if (!sendAt || isAfter(sendAt, new Date())) return

    // CAS: elect a single canceller. count 0 means another runner already
    // transitioned it (or it advanced), so the Canceled email fires once. A
    // `hold_failed` draft carries no live Stripe hold — a decline placed none,
    // and the dial-time dead-hold path already cleared the intent — so there is
    // nothing to void; just mark cancelled + email. No Stripe is touched.
    // updatedAt pins the CAS to the row read above: a resend stays
    // hold_failed while it moves the date forward, so settle-state alone
    // would let a stale past-date read cancel a just-resumed send.
    const claim = await this.model.updateMany({
      where: {
        outreachId,
        settleState: RobocallSettleState.hold_failed,
        updatedAt: draft.updatedAt,
      },
      data: { settleState: RobocallSettleState.cancelled },
    })
    if (claim.count === 0) return

    await this.emitMilestone(
      draft.outreach.campaign!.userId,
      outreachId,
      EVENTS.Robocall.Canceled,
      `${outreachId}:canceled`,
    )
  }

  // Emits a milestone with a deterministic Segment messageId so a replay dedups
  // to one email. Called ONLY from a winning transition. Best-effort: the DB
  // stamp/transition already committed, so a transient Segment failure must not
  // throw and strand the draft — a lost reminder is recovered by the next day's
  // sweep, and a lost cancel email leaves the draft correctly cancelled.
  private async emitMilestone(
    userId: number,
    outreachId: number,
    event: string,
    messageId: string,
  ): Promise<void> {
    try {
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
        'robocall hold-failure milestone emit failed',
      )
    }
  }
}
