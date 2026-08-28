import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { CallhubCampaignReportService } from '@/vendors/callhub/services/callhubCampaignReport.service'
import { CallhubCreditsService } from '@/vendors/callhub/services/callhubCredits.service'
import { CALLHUB_VB_STATUS } from '@/vendors/callhub/schemas/callhubCampaign.schema'
import { RobocallSettleState } from '../../generated/prisma'

// Every 10 minutes, offset :09 so the sweep neither joins the top-of-hour herd
// nor collides with the sibling robocall crons (send :04,…, staging :07,…) or
// the tcr sweep (:23). Explicit timeZone per docs/scheduled-jobs.md; the minute
// offset is what matters here.
const ROBOCALL_COMPLETION_SWEEP_CRON = '9,19,29,39,49,59 * * * *'
const ROBOCALL_COMPLETION_SWEEP_JOB = 'robocallCompletionSweep'

// The completion-detection half of settlement (the read/record half; the actual
// capture is the NEXT slice). For a robocall run left in `dialed` by the send
// slice, poll CallHub to detect the broadcast finished, record the ACTUAL
// completed/billable call count, and move the draft to `settling` — the handoff
// state the capture slice consumes. NO money movement here: this NEVER captures,
// voids, or touches a PaymentIntent. The capture slice reads the recorded
// `completedCallCount` and captures min(actual, authorized) off the hold.
@Injectable()
export class OutreachRobocallCompletionService extends createPrismaBase(
  MODELS.OutreachRobocall,
) {
  constructor(
    private readonly campaignReport: CallhubCampaignReportService,
    private readonly credits: CallhubCreditsService,
  ) {
    super()
  }

  // No CronLockService / whole-job lock, and no separate kill-switch (unlike the
  // send sweep's ROBOCALL_SEND_ENABLED): this sweep dials nothing and moves no
  // money — its only write is an idempotent per-record CAS advancing a finished
  // run to `settling`, elected single-owner behind that CAS, so two replicas
  // racing settle each row once. It naturally no-ops when nothing is `dialed`.
  // The prod-only guard is the sole gate it needs — a rate-limited vendor read
  // must not fire on dev/preview. @Cron (not @Interval) so the schedule survives
  // deploys and every replica fires on the same instant.
  @Cron(ROBOCALL_COMPLETION_SWEEP_CRON, {
    name: ROBOCALL_COMPLETION_SWEEP_JOB,
    timeZone: EASTERN_TIMEZONE,
  })
  async sweepRobocallCompletion(): Promise<void> {
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') return

    const dialed = await this.model.findMany({
      where: {
        settleState: RobocallSettleState.dialed,
        callhubCampaignPkStr: { not: null },
      },
      select: { outreachId: true, callhubCampaignPkStr: true },
    })

    for (const { outreachId, callhubCampaignPkStr } of dialed) {
      if (!callhubCampaignPkStr) continue
      try {
        await this.pollCompletion(outreachId, callhubCampaignPkStr)
      } catch (err) {
        // Per-record isolation: one draft's CallHub/DB failure must not abort
        // polling the rest. The next sweep retries it.
        this.logger.error(
          { err, outreachId },
          'robocall completion poll failed for a draft; continuing sweep',
        )
      }
    }
  }

  async pollCompletion(outreachId: number, pkStr: string): Promise<void> {
    const status = await this.readVbStatus(pkStr)
    // Not finished: START = still dialing, PAUSE = mid-run, and a read failure
    // (null) or any unrecognized code is unresolved. Leave the row in `dialed`
    // for a later pass and do NOT read the count — spare the rate-limited vendor
    // a POST until the run is actually done.
    if (
      status !== CALLHUB_VB_STATUS.END &&
      status !== CALLHUB_VB_STATUS.ABORT
    ) {
      return
    }
    // END = the broadcast drained; ABORT = a manual/partial stop. Both finished
    // dialing, so both settle — an aborted run's partially-dialed count is
    // recorded, never discarded.
    const aborted = status === CALLHUB_VB_STATUS.ABORT

    // null = unknown (read failed, or CallHub has not reported the count yet):
    // leave the run in `dialed` and poll again — never settle on an unknown
    // count. A number (including a genuine 0) proceeds through the stability
    // gate below.
    const count = await this.readCompletedCount(pkStr)
    if (count == null) return

    // STABILITY (never settle a still-moving count in one pass): settle only
    // when this poll reads the SAME count the previous poll persisted. The first
    // terminal poll (no snapshot yet, or a count still climbing) records the
    // snapshot and waits; a later pass whose read confirms it settles.
    const draft = await this.findFirst({
      where: { outreachId },
      select: { completedCallCount: true },
    })
    if (draft?.completedCallCount !== count) {
      await this.recordSnapshot(outreachId, count)
      return
    }

    await this.settle(outreachId, count, aborted, pkStr)
  }

  // Reads the CallHub campaign's lifecycle status (a GET, no side effect).
  // Returns null when the read itself fails so the caller treats "unknown"
  // distinctly from a definitive END/ABORT and leaves the row for a later pass.
  private async readVbStatus(pkStr: string): Promise<number | null> {
    try {
      return (await this.campaignReport.getCampaignStatus(pkStr)).status
    } catch (err) {
      this.logger.error(
        { err, campaignPkStr: pkStr },
        'robocall CallHub status read failed while polling completion',
      )
      return null
    }
  }

  // Reads the actual completed/billable call count for the finished run. Uses
  // credits_usage `voice_calls` (dialed calls) scoped per-campaign by the
  // campaign pk_str — the billable-count source the send-chain notes name, and
  // what the capture slice charges. Returns null in two "unknown" cases so the
  // caller leaves the row in `dialed` to poll again: a read failure, AND a
  // null/absent voice_calls, which means CallHub has NOT reported the count yet
  // — NOT zero completed calls. Settling a really-dialed run at 0 would capture
  // nothing and never bill the candidate's real dials. A genuine numeric 0 (an
  // all-suppressed run) IS a real count and passes through to settle.
  private async readCompletedCount(pkStr: string): Promise<number | null> {
    try {
      const usage = await this.credits.getVoiceCampaignUsage(pkStr)
      return usage.voice_calls ?? null
    } catch (err) {
      this.logger.error(
        { err, campaignPkStr: pkStr },
        'robocall credits_usage read failed while polling completion',
      )
      return null
    }
  }

  // Persists the latest observed count so the NEXT poll can confirm stability.
  // CAS on `dialed` so a row that moved out from under us is a no-op.
  private async recordSnapshot(
    outreachId: number,
    count: number,
  ): Promise<void> {
    await this.model.updateMany({
      where: { outreachId, settleState: RobocallSettleState.dialed },
      data: { completedCallCount: count, completionPolledAt: new Date() },
    })
  }

  // Single-owner CAS `dialed → settling`, recording the confirmed count. NO
  // money movement — `settling` is the handoff state; the capture slice reads
  // `completedCallCount` and captures min(actual, authorized) off the hold.
  private async settle(
    outreachId: number,
    count: number,
    aborted: boolean,
    pkStr: string,
  ): Promise<void> {
    const settled = await this.model.updateMany({
      where: { outreachId, settleState: RobocallSettleState.dialed },
      data: {
        settleState: RobocallSettleState.settling,
        completedCallCount: count,
        completionPolledAt: new Date(),
      },
    })
    if (settled.count === 0) return
    this.logger.info(
      { outreachId, campaignPkStr: pkStr, completedCallCount: count, aborted },
      aborted
        ? 'robocall run aborted; recorded partial count, moved to settling'
        : 'robocall run completed; recorded count, moved to settling',
    )
  }
}
