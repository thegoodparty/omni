import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { isBefore } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import {
  projectRobocallDialQueue,
  robocallDialCeilingAt,
} from '@/shared/util/robocallDialCompletion.util'
import { CallhubCampaignService } from '@/vendors/callhub/services/callhubCampaign.service'
import {
  OutreachStatus,
  OutreachType,
  RobocallSettleState,
} from '../../generated/prisma'
import { OutreachNotificationService } from './outreachNotification.service'
import { VENDOR_CRONS_ENABLED } from '@/shared/util/appEnvironment.util'

// Every 15 minutes, offset :11 — distinct from the overdue sweep (:12,:27,…) and
// the send sweep (:04,:14,…). This sweep makes NO CallHub or Stripe call (it
// reads rows, reads the configured dial rate from env, and posts Slack), so the
// offset is only about not joining the top-of-hour herd; a stuck backlog is
// paged ONCE per run (the dedupe CAS), so 15 minutes is ample.
const ROBOCALL_BACKLOG_SWEEP_CRON = '11,26,41,56 * * * *'
const ROBOCALL_BACKLOG_SWEEP_JOB = 'robocallBacklogAlertSweep'

// The projection must advance the pool at the SAME money-safe ceiling the send
// sweep frees a run at, or it would predict the wrong dial times. These read the
// SAME env vars the send sweep reads (so a tuning change keeps both in step) at
// call time, mirroring that service's env helpers.
const envInt = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : fallback
}
const robocallDialEstimateBufferMinutes = () =>
  envInt(process.env.ROBOCALL_DIAL_ESTIMATE_BUFFER_MINUTES, 30)
const robocallDialSafetyRateDivisor = () =>
  Math.max(1, envInt(process.env.ROBOCALL_DIAL_SAFETY_RATE_DIVISOR, 2))

// Proactively pages CAS when the strictly-serial send queue's backlog is
// projected to push a robocall past its scheduled DAY — BEFORE it is late.
// Distinct from OutreachRobocallOverdueAlertService, which fires only once a
// send has already missed its date: this one projects each waiting run's real
// dial time through the queue (every run waits on the one ahead) and warns while
// there is still time to act (split a big list, reschedule, raise the dial
// rate). It MOVES NO MONEY and touches no dial/hold/capture state: it reads rows,
// stamps `backlogAlertedAt` to dedupe, and posts a best-effort Slack line.
@Injectable()
export class OutreachRobocallBacklogAlertService extends createPrismaBase(
  MODELS.OutreachRobocall,
) {
  constructor(
    private readonly campaigns: CallhubCampaignService,
    private readonly notification: OutreachNotificationService,
  ) {
    super()
  }

  // Prod-only: it reads the real send pipeline's queue and stamps a prod dedupe
  // column, so it must not fire on dev/preview. No CronLockService: the
  // single-owner `backlogAlertedAt IS NULL` CAS elects one alerter per run, so
  // two replicas racing both project the same queue but only ONE stamps and
  // posts. @Cron (not @Interval) so the schedule survives deploys.
  @Cron(ROBOCALL_BACKLOG_SWEEP_CRON, {
    name: ROBOCALL_BACKLOG_SWEEP_JOB,
    timeZone: EASTERN_TIMEZONE,
  })
  async sweepBacklogAlerts(): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const now = new Date()
    const bufferMinutes = robocallDialEstimateBufferMinutes()
    const divisor = robocallDialSafetyRateDivisor()
    // The rate-haircut (safe) rate for a run, from the rate it was STAGED at —
    // never a later-raised live value for a run already staged slow. Falls back
    // to the live config for a pre-R1 run with no frozen rate.
    const safeRateFor = (staged: number | null): number =>
      Math.max(
        1,
        Math.floor(
          (staged ?? this.campaigns.getConfiguredCallsPerMinute()) / divisor,
        ),
      )

    const poolAvailableAt = await this.projectPoolAvailableAt(
      now,
      safeRateFor,
      bufferMinutes,
    )

    // The waiting queue, EXACTLY the set the send sweep launches from: authorized
    // AND staged (`callhubCampaignPkStr` set), in the SAME total dial order
    // (`date` then `outreachId`). An authorized-but-UNSTAGED run is deliberately
    // excluded — the send sweep cannot launch it until staging stamps its
    // campaign pk, so counting it here would occupy a phantom pool slot, inflate
    // the projected wait for runs behind it, and risk burning the one-shot
    // `backlogAlertedAt` stamp on a false alert; a run is staged close to its
    // send, so a near-due run (the one that can actually slip) is already in the
    // set. Already-due runs (date <= now) STAY in the walk because they hold the
    // pool ahead of future runs, but only future runs are ALERTED below — a
    // past-due run is the overdue sweep's domain.
    const queueRows = await this.model.findMany({
      where: {
        settleState: RobocallSettleState.authorized,
        billableCount: { not: null },
        callhubCampaignPkStr: { not: null },
        outreach: {
          outreachType: OutreachType.robocall,
          status: {
            notIn: [OutreachStatus.canceled, OutreachStatus.failed],
          },
        },
      },
      select: {
        outreachId: true,
        billableCount: true,
        backlogAlertedAt: true,
        stagedCallsPerMinute: true,
        outreach: {
          select: {
            date: true,
            campaign: { select: { slug: true } },
          },
        },
      },
      orderBy: [{ outreach: { date: 'asc' } }, { outreachId: 'asc' }],
    })

    const queue = queueRows.flatMap((row) =>
      row.billableCount !== null && row.outreach.date !== null
        ? [
            {
              outreachId: row.outreachId,
              audienceSize: row.billableCount,
              scheduledAt: row.outreach.date,
              callsPerMinute: safeRateFor(row.stagedCallsPerMinute),
            },
          ]
        : [],
    )
    if (queue.length === 0) return

    const projected = projectRobocallDialQueue({
      now,
      poolAvailableAt,
      queue,
      bufferMinutes,
    })
    const rowByOutreachId = new Map(
      queueRows.map((row) => [row.outreachId, row]),
    )

    for (const run of projected) {
      if (!run.delayedPastScheduledDay) continue
      // Proactive ONLY: an already-due run that still has not dialed is the
      // overdue sweep's page, not this one.
      if (!isBefore(now, run.scheduledAt)) continue
      const row = rowByOutreachId.get(run.outreachId)
      if (!row || row.backlogAlertedAt !== null) continue
      try {
        await this.alertBacklog(
          run.outreachId,
          run.scheduledAt,
          run.projectedStartAt,
          row.outreach.campaign?.slug ?? 'unknown',
          now,
        )
      } catch (err) {
        // Per-record isolation: one row's failure must not abort the sweep.
        this.logger.error(
          { err, outreachId: run.outreachId },
          'robocall backlog-alert failed for a row; continuing sweep',
        )
      }
    }
  }

  // The instant the shared CallHub pool first frees: the latest projected dial
  // completion of any in-flight run (a `dialing` claim or a `dialed` run whose
  // pool is not yet freed), floored at `now`. An idle queue frees immediately.
  private async projectPoolAvailableAt(
    now: Date,
    safeRateFor: (staged: number | null) => number,
    bufferMinutes: number,
  ): Promise<Date> {
    const inFlight = await this.model.findMany({
      where: {
        OR: [
          { settleState: RobocallSettleState.dialing },
          {
            settleState: RobocallSettleState.dialed,
            poolFreedAt: null,
          },
        ],
      },
      select: {
        billableCount: true,
        dialedAt: true,
        dialingStartedAt: true,
        stagedCallsPerMinute: true,
      },
    })

    let poolAvailableAt = now
    for (const run of inFlight) {
      if (run.billableCount === null || run.billableCount <= 0) continue
      // A `dialed` run started at dialedAt; a transient `dialing` claim started
      // at dialingStartedAt (fall back to now if neither is stamped).
      const startAt = run.dialedAt ?? run.dialingStartedAt ?? now
      const freeAt = robocallDialCeilingAt({
        audienceSize: run.billableCount,
        callsPerMinute: safeRateFor(run.stagedCallsPerMinute),
        startAt,
        bufferMinutes,
      })
      if (isBefore(poolAvailableAt, freeAt)) poolAvailableAt = freeAt
    }
    return poolAvailableAt
  }

  // Claims the alert with a single-owner CAS (guarded on backlogAlertedAt IS
  // NULL, re-asserting the still-authorized invariant so a row that dialed or
  // was canceled between the SELECT and here is never paged) THEN posts the
  // Slack line. Claim-first means at-most-once across replicas and passes. The
  // CAS writes ONLY backlogAlertedAt — never settleState — so it is wholly
  // separate from the dial claim and cannot abandon, dial, or settle anything.
  private async alertBacklog(
    outreachId: number,
    scheduledAt: Date,
    projectedStartAt: Date,
    campaignSlug: string,
    now: Date,
  ): Promise<void> {
    const claim = await this.model.updateMany({
      where: {
        outreachId,
        backlogAlertedAt: null,
        settleState: RobocallSettleState.authorized,
      },
      data: { backlogAlertedAt: now },
    })
    if (claim.count === 0) return

    const scheduledLabel = formatInTimeZone(
      scheduledAt,
      EASTERN_TIMEZONE,
      'EEE, MMM d, yyyy',
    )
    const projectedLabel = formatInTimeZone(
      projectedStartAt,
      EASTERN_TIMEZONE,
      'EEE, MMM d, yyyy',
    )

    await this.notification.notifyRobocallBacklogDelayed(
      campaignSlug,
      outreachId,
      scheduledLabel,
      projectedLabel,
    )
  }
}
