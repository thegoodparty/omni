import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { format, isAfter, subHours } from 'date-fns'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { AnalyticsService } from '@/analytics/analytics.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { OutreachType, RobocallSettleState } from '../../generated/prisma'

// A failed hold (a declined or dead card) leaves the draft `hold_failed`. This
// slice runs the two time-based follow-ups on that terminal: a daily "fix your
// card" reminder while the send is still ahead, and a cancel once the send
// deadline passes with the card never fixed (never send unpaid). Retry-on-card-
// update is a SEPARATE later slice — it needs a Stripe payment_method webhook
// trigger and is deliberately not built here.

// Once-daily reminder. 14:00 Eastern, a non-:00 minute-of-hour and a free slot
// distinct from the other robocall crons (send :04.., staging :07.., cancel
// below at :11..) so it never joins a herd. Explicit timeZone per
// docs/scheduled-jobs.md.
const ROBOCALL_REMINDER_SWEEP_CRON = '0 14 * * *'
const ROBOCALL_REMINDER_SWEEP_JOB = 'robocallHoldFailureReminderSweep'

// Cancel-at-deadline runs every 15 minutes so a just-passed send deadline is
// caught promptly. Offsets (:11,:26,:41,:56) sit in free slots between the send
// (:04..), staging (:07..), inbound (:30) and completion (:00) crons.
const ROBOCALL_CANCEL_SWEEP_CRON = '11,26,41,56 * * * *'
const ROBOCALL_CANCEL_SWEEP_JOB = 'robocallHoldFailureCancelSweep'

// A draft is re-reminded only once its last reminder is older than this. Under
// a full day so the 14:00-Eastern daily cron always re-fires (a reminder from
// 24h ago clears a 23h floor) while a same-day double sweep is denied. The DB
// stamp is the primary once/day guard; the per-day Segment messageId is the
// downstream dedup backstop.
const ROBOCALL_REMINDER_MIN_INTERVAL_HOURS = 23

// Runs the daily reminder + cancel-at-deadline follow-ups on `hold_failed`
// robocall drafts. Each unit of work is idempotent per record behind an atomic
// claim — the once/day `lastReminderSentAt` stamp CAS for the reminder, the
// single-owner `hold_failed → cancelled` CAS for the cancel — so two replicas
// racing a sweep both SELECT the same candidates but only ONE wins each draft,
// and the email fires once. No CronLockService (the per-record CAS is the
// dedup) and no kill-switch: unlike the send sweep these neither dial nor
// charge — cancel places/voids nothing (a declined hold reserved no money) —
// so they mirror the staging/completion sweeps, which carry no kill-switch
// either. @Cron (not @Interval) so the schedule survives deploys.
@Injectable()
export class OutreachRobocallHoldFailureService extends createPrismaBase(
  MODELS.OutreachRobocall,
) {
  constructor(private readonly analytics: AnalyticsService) {
    super()
  }

  // Prod-only (docs/scheduled-jobs.md § Prod-only guard): reminder/cancel emails
  // route through the real Segment → HubSpot path, and cancelling a live draft is
  // a state change we don't want firing against dev/preview data.
  @Cron(ROBOCALL_REMINDER_SWEEP_CRON, {
    name: ROBOCALL_REMINDER_SWEEP_JOB,
    timeZone: EASTERN_TIMEZONE,
  })
  async sweepHoldFailureReminders(): Promise<void> {
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') return

    const now = new Date()
    const reminderCutoff = subHours(now, ROBOCALL_REMINDER_MIN_INTERVAL_HOURS)
    const candidates = await this.model.findMany({
      where: {
        settleState: RobocallSettleState.hold_failed,
        outreach: {
          outreachType: OutreachType.robocall,
          // Send still ahead: a failed hold whose deadline has passed is the
          // cancel sweep's job, not the reminder's.
          date: { gt: now },
        },
        OR: [
          { lastReminderSentAt: null },
          { lastReminderSentAt: { lt: reminderCutoff } },
        ],
      },
      select: { outreachId: true },
    })

    for (const { outreachId } of candidates) {
      try {
        await this.remindHoldFailure(outreachId, now)
      } catch (err) {
        // Per-record isolation: one draft's failure must not abort the sweep.
        this.logger.error(
          { err, outreachId },
          'robocall hold-failure reminder failed for a draft; continuing sweep',
        )
      }
    }
  }

  @Cron(ROBOCALL_CANCEL_SWEEP_CRON, {
    name: ROBOCALL_CANCEL_SWEEP_JOB,
    timeZone: EASTERN_TIMEZONE,
  })
  async sweepHoldFailureCancellations(): Promise<void> {
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') return

    const now = new Date()
    const candidates = await this.model.findMany({
      where: {
        settleState: RobocallSettleState.hold_failed,
        outreach: {
          outreachType: OutreachType.robocall,
          // Deadline reached: the candidate never fixed the card in time.
          date: { lte: now },
        },
      },
      select: { outreachId: true },
    })

    for (const { outreachId } of candidates) {
      try {
        await this.cancelExpiredHoldFailure(outreachId)
      } catch (err) {
        this.logger.error(
          { err, outreachId },
          'robocall hold-failure cancel failed for a draft; continuing sweep',
        )
      }
    }
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
    await this.emitMilestone(
      draft.outreach.campaign.userId,
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
    const claim = await this.model.updateMany({
      where: { outreachId, settleState: RobocallSettleState.hold_failed },
      data: { settleState: RobocallSettleState.cancelled },
    })
    if (claim.count === 0) return

    await this.emitMilestone(
      draft.outreach.campaign.userId,
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
