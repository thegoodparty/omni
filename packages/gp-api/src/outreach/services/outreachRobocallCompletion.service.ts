import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { addHours, subHours } from 'date-fns'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import {
  ROBOCALL_RUN_HOURS,
  ROBOCALL_SETTLE_MARGIN_HOURS,
} from '@/shared/util/robocallHold.util'
import { CallhubCampaignService } from '@/vendors/callhub/services/callhubCampaign.service'
import { Prisma, RobocallSettleState } from '../../generated/prisma'

// Every 10 minutes, offset :09 so the sweep neither joins the top-of-hour herd
// nor collides with the sibling robocall crons (send :04,…, staging :07,…) or
// the tcr sweep (:23). Explicit timeZone per docs/scheduled-jobs.md; the minute
// offset is what matters here.
const ROBOCALL_COMPLETION_SWEEP_CRON = '9,19,29,39,49,59 * * * *'
const ROBOCALL_COMPLETION_SWEEP_JOB = 'robocallCompletionSweep'

// The completion half of settlement (the read/record half; the actual capture is
// the NEXT slice). CallHub cannot report a per-campaign connected-call count
// (credits_usage is account-wide), so a robocall run is NOT settled on a vendor
// count — it settles on TIME. Once its run window (ROBOCALL_RUN_HOURS) has
// elapsed since the dial, the calls have had their chance, so the run is billed
// for the FULL authorized estimate: the draft is moved `dialed → settling` with
// `completedCallCount` set to the billable count the estimate was based on, and
// the capture slice captures min(calc(billableCount), authorizedAmountInCents) —
// the authorized estimate (INV-1 clamps so it can never exceed authorized). NO
// money movement here: this NEVER captures, voids, or touches a PaymentIntent —
// its only side effect is a best-effort STOP of the finished CallHub campaign.
@Injectable()
export class OutreachRobocallCompletionService extends createPrismaBase(
  MODELS.OutreachRobocall,
) {
  constructor(private readonly campaign: CallhubCampaignService) {
    super()
  }

  // No CronLockService / whole-job lock, and no separate kill-switch (unlike the
  // capture sweep's ROBOCALL_CAPTURE_ENABLED): this sweep dials nothing and moves
  // no money — its only write is an idempotent per-record CAS advancing a
  // run-window-elapsed run to `settling`, elected single-owner behind that CAS,
  // so two replicas racing settle each row once. It naturally no-ops when nothing
  // is `dialed`. The prod-only guard is the sole gate it needs — the best-effort
  // CallHub stop hits a rate-limited vendor that must not be called on
  // dev/preview. @Cron (not @Interval) so the schedule survives deploys and every
  // replica fires on the same instant.
  @Cron(ROBOCALL_COMPLETION_SWEEP_CRON, {
    name: ROBOCALL_COMPLETION_SWEEP_JOB,
    timeZone: EASTERN_TIMEZONE,
  })
  async sweepRobocallCompletion(): Promise<void> {
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') return

    const now = new Date()
    const runWindowElapsed = subHours(now, ROBOCALL_RUN_HOURS)
    const captureDeadlineSoon = addHours(now, ROBOCALL_SETTLE_MARGIN_HOURS)

    const ready = await this.model.findMany({
      where: {
        settleState: RobocallSettleState.dialed,
        callhubCampaignPkStr: { not: null },
        // Only a hold-model run settles here. An estimate-billed run (charged
        // upfront, `chargeIntentId` set, NO authorization hold) also reaches
        // `dialed`, but capturing off a non-existent hold would double-charge it,
        // so its own sweeps own it and `dialed` is its terminal — exclude it.
        authorizationIntentId: { not: null },
        OR: [
          // The run window has elapsed since the dial: the calls have had their
          // chance, so settle and bill the estimate.
          { dialedAt: { lte: runWindowElapsed } },
          // Or the hold is approaching its capture deadline: settle now
          // regardless so a hold never lapses uncaptured (the capture sweep still
          // prioritizes by captureBefore asc). Guards a send whose window is
          // shorter than the run — the hold must be captured before it expires.
          { captureBefore: { lte: captureDeadlineSoon } },
        ],
      },
      orderBy: { captureBefore: Prisma.SortOrder.asc },
      select: {
        outreachId: true,
        callhubCampaignPkStr: true,
        billableCount: true,
      },
    })

    for (const { outreachId, callhubCampaignPkStr, billableCount } of ready) {
      if (!callhubCampaignPkStr) continue
      try {
        await this.settle(outreachId, callhubCampaignPkStr, billableCount)
      } catch (err) {
        // Per-record isolation: one draft's CallHub/DB failure must not abort
        // settling the rest. The next sweep retries it.
        this.logger.error(
          { err, outreachId },
          'robocall completion settle failed for a draft; continuing sweep',
        )
      }
    }
  }

  // Settles a dialed run whose run window has elapsed (or whose hold nears its
  // capture deadline): best-effort STOP the CallHub campaign, then a single-owner
  // CAS `dialed → settling` recording the FULL billable count so the capture
  // slice bills the authorized estimate. NO money movement — `settling` is the
  // handoff state the capture slice consumes.
  async settle(
    outreachId: number,
    pkStr: string,
    billableCount: number,
  ): Promise<void> {
    // CLEANUP-only STOP: the run window has elapsed, so ABORT the CallHub
    // campaign so it can never dial again. This is hygiene, not money: a stop
    // failure — including a permanent 404, which CallHub treats as
    // already-retired — must NOT block settlement or the capture that follows.
    // Log and proceed; it is never retried here (the next sweep no longer finds
    // the row in `dialed`), so a permanent failure can't loop against the
    // rate-limited API.
    try {
      await this.campaign.abortVoiceBroadcast(pkStr)
    } catch (err) {
      this.logger.error(
        { err, outreachId, campaignPkStr: pkStr },
        'robocall completion: best-effort CallHub stop failed; settling anyway',
      )
    }

    // Single-owner CAS `dialed → settling`, recording the full billable count the
    // estimate/hold was based on. The capture slice captures
    // min(calcRobocallTotalInCents(billableCount), authorizedAmountInCents) =
    // the authorized estimate (INV-1 clamps it to authorized, never more). A row
    // that moved out from under us is a no-op.
    const settled = await this.model.updateMany({
      where: { outreachId, settleState: RobocallSettleState.dialed },
      data: {
        settleState: RobocallSettleState.settling,
        completedCallCount: billableCount,
        completionPolledAt: new Date(),
      },
    })
    if (settled.count === 0) return
    this.logger.info(
      { outreachId, campaignPkStr: pkStr, billableCount },
      'robocall run window elapsed; settled for the full estimate',
    )
  }
}
