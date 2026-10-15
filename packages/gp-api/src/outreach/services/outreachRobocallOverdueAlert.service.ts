import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { formatDistanceStrict, subMinutes } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import {
  OutreachStatus,
  OutreachType,
  RobocallSettleState,
} from '../../generated/prisma'
import { OutreachNotificationService } from './outreachNotification.service'

// Every 15 minutes, offset :12 — a slot no OTHER robocall cron uses as its own
// base. It may coincide with the every-10 capture (:12,:42) or staging (:27,:57)
// ticks, which is harmless: this sweep makes NO CallHub call (so it cannot add
// to the rate-limited-vendor pressure the other offsets are spaced to avoid) and
// only reads rows + posts Slack. A stuck run sits for a long while and is paged
// ONCE (the dedupe CAS), so a 15-minute cadence is ample.
const ROBOCALL_OVERDUE_SWEEP_CRON = '12,27,42,57 * * * *'
const ROBOCALL_OVERDUE_SWEEP_JOB = 'robocallOverdueAlertSweep'

// A run only becomes alert-worthy once it is overdue by MORE than this: a run
// that just passed its send time is about to dial on the next send-sweep pass
// (every 10 min), and a batch draining under the per-pass cap is overdue-but-
// healthy, not stuck. Paging only past the grace keeps a normally-queued run
// from waking CAS while still catching a genuine silent tail — a run still
// undialed well after several send passes have had their chance.
const ROBOCALL_OVERDUE_GRACE_MINUTES = 30

// The settle states a paid, scheduled run sits in while it has NOT recorded a
// dial (all have `dialedAt` null). `authorized` covers both a never-staged run
// (the stranded sweep's domain once it also passes that sweep's own window) AND
// a staged run (callhubCampaignPkStr set) that the send sweep keeps failing to
// dial — the exact silent tail the stranded sweep SKIPS (it matches only
// callhubCampaignPkStr IS NULL). `staging` covers a run stuck mid-stage.
// `dialing` covers a run whose stale-dialing recovery keeps failing: each pass
// re-claims it (bumping updatedAt) then throws before committing/reverting, so
// it oscillates in `dialing` forever, 30+ min past its send with `dialedAt`
// still null — precisely the silent tail this alert exists to page. A healthy
// dial commits `dialedAt` within seconds, so the grace + `dialedAt IS NULL`
// guard never pages an in-flight dial.
const UNDIALED_STATES = [
  RobocallSettleState.authorized,
  RobocallSettleState.staging,
  RobocallSettleState.dialing,
]

// Alerts CAS when a robocall is past its scheduled date and still has not
// dialed, whatever the failure mode — closing the Oct 8 silent-tail gap where a
// staged-but-stuck run (or one stuck in `staging`) dialed nothing and nothing
// surfaced it. It MOVES NO MONEY and touches no dial/hold/capture state: it only
// reads the row, stamps `overdueAlertedAt` to dedupe, and posts a best-effort
// Slack line. The dedupe CAS is deliberately SEPARATE from the send slice's dial
// claim, so an alert can never race or disturb a dial.
@Injectable()
export class OutreachRobocallOverdueAlertService extends createPrismaBase(
  MODELS.OutreachRobocall,
) {
  constructor(private readonly notification: OutreachNotificationService) {
    super()
  }

  // Prod-only: the alert is for the real send pipeline (and the per-record CAS
  // stamps a prod column), so it must not fire on dev/preview. No
  // CronLockService: the single-owner `overdueAlertedAt IS NULL` CAS elects one
  // alerter per run, so two replicas racing both SELECT the same candidates but
  // only ONE stamps and posts — idempotent across replicas. @Cron (not
  // @Interval) so the schedule survives deploys.
  @Cron(ROBOCALL_OVERDUE_SWEEP_CRON, {
    name: ROBOCALL_OVERDUE_SWEEP_JOB,
    timeZone: EASTERN_TIMEZONE,
  })
  async sweepOverdueAlerts(): Promise<void> {
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') return

    const now = new Date()
    const overdueCutoff = subMinutes(now, ROBOCALL_OVERDUE_GRACE_MINUTES)
    const overdue = await this.model.findMany({
      where: {
        settleState: { in: UNDIALED_STATES },
        dialedAt: null,
        // Not yet paged. The CAS below re-asserts this, so this filter is only a
        // cheap pre-screen, not the dedupe guarantee.
        overdueAlertedAt: null,
        outreach: {
          outreachType: OutreachType.robocall,
          date: { lt: overdueCutoff },
          // A run the candidate or a sweep already ended is not a silent tail —
          // it is correctly terminal, so never page on it.
          status: {
            notIn: [OutreachStatus.canceled, OutreachStatus.failed],
          },
        },
      },
      select: {
        outreachId: true,
        settleState: true,
        outreach: {
          select: {
            date: true,
            campaign: { select: { slug: true } },
          },
        },
      },
    })

    for (const row of overdue) {
      try {
        await this.alertOverdue(
          row.outreachId,
          row.settleState,
          row.outreach.date,
          row.outreach.campaign?.slug ?? 'unknown',
          now,
        )
      } catch (err) {
        // Per-record isolation: one row's failure must not abort the sweep.
        this.logger.error(
          { err, outreachId: row.outreachId },
          'robocall overdue-alert failed for a row; continuing sweep',
        )
      }
    }
  }

  // Claims the alert with a single-owner CAS (guarded on overdueAlertedAt IS
  // NULL, AND re-asserting the pre-dial + undialed invariant so a row that
  // dialed between the SELECT and here is never paged) THEN posts the Slack line.
  // Claim-first means at-most-once: a lost post does not re-page next sweep. The
  // CAS writes ONLY overdueAlertedAt — never settleState — so it is wholly
  // separate from the dial claim and cannot abandon, dial, or settle anything.
  private async alertOverdue(
    outreachId: number,
    settleState: RobocallSettleState,
    scheduledDate: Date | null,
    campaignSlug: string,
    now: Date,
  ): Promise<void> {
    const claim = await this.model.updateMany({
      where: {
        outreachId,
        overdueAlertedAt: null,
        settleState: { in: UNDIALED_STATES },
        dialedAt: null,
      },
      data: { overdueAlertedAt: now },
    })
    if (claim.count === 0) return

    // A robocall always carries a send date, but the column is nullable; fall
    // back rather than crash the alert on a data anomaly.
    const scheduledLabel = scheduledDate
      ? formatInTimeZone(
          scheduledDate,
          EASTERN_TIMEZONE,
          'EEE, MMM d, yyyy, h:mm a zzz',
        )
      : 'unknown'
    const overdueLabel = scheduledDate
      ? formatDistanceStrict(scheduledDate, now)
      : 'unknown'

    await this.notification.notifyRobocallOverdue(
      campaignSlug,
      outreachId,
      scheduledLabel,
      overdueLabel,
      settleState,
    )
  }
}
