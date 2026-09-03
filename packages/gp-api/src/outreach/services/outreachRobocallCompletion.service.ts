import { BadGatewayException, Inject, Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { RobocallSettleState } from '../../generated/prisma'
import { ROBOCALL_VENDOR, RobocallVendor } from '../vendor/robocallVendor'
import {
  ROBOCALL_BROADCAST_STATUS,
  RobocallBroadcastStatus,
} from '../vendor/robocallVendor.types'
import { VendorPermanentError } from '../vendor/vendorPermanentError'

// Every 10 minutes, offset :09 so the sweep neither joins the top-of-hour herd
// nor collides with the sibling robocall crons (send :04,…, staging :07,…) or
// the tcr sweep (:23). Explicit timeZone per docs/scheduled-jobs.md; the minute
// offset is what matters here.
const ROBOCALL_COMPLETION_SWEEP_CRON = '9,19,29,39,49,59 * * * *'
const ROBOCALL_COMPLETION_SWEEP_JOB = 'robocallCompletionSweep'

// The completion-detection half of settlement (the read/record half; the actual
// capture is the NEXT slice). For a robocall run left in `dialed` by the send
// slice, poll the vendor to detect the broadcast finished, record the ACTUAL
// completed/billable call count, and move the draft to `settling` — the handoff
// state the capture slice consumes. NO money movement here: this NEVER captures,
// voids, or touches a PaymentIntent. The capture slice reads the recorded
// `completedCallCount` and captures min(actual, authorized) off the hold.
@Injectable()
export class OutreachRobocallCompletionService extends createPrismaBase(
  MODELS.OutreachRobocall,
) {
  constructor(
    @Inject(ROBOCALL_VENDOR) private readonly vendor: RobocallVendor,
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
    const status = await this.readBroadcastStatus(outreachId, pkStr)
    // Not finished: DIALING = still placing calls, PAUSED/PENDING = mid-run or
    // not yet dialing, and a read failure (null) or UNKNOWN code is unresolved.
    // Leave the row in `dialed` for a later pass and do NOT read the count —
    // spare the rate-limited vendor a call until the run is actually done.
    if (
      status !== ROBOCALL_BROADCAST_STATUS.COMPLETED &&
      status !== ROBOCALL_BROADCAST_STATUS.ABORTED
    ) {
      return
    }
    // COMPLETED = the broadcast drained; ABORTED = a manual/partial stop. Both
    // finished dialing, so both settle — an aborted run's partially-dialed count
    // is recorded, never discarded.
    const aborted = status === ROBOCALL_BROADCAST_STATUS.ABORTED

    // null = a TRANSIENT read failure: leave the run in `dialed` and poll again.
    // A permanent read failure (a wrong shape, or a missing count) is NOT null —
    // it parks the delivered run `uncollectable` inside readCompletedCount, and
    // this returns to a row no longer `dialed`. A number (including a genuine 0)
    // proceeds through the stability gate below.
    const count = await this.readCompletedCount(outreachId, pkStr)
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

  // Reads the vendor campaign's lifecycle status (a GET, no side effect) as the
  // neutral enum. Returns null when the read itself fails so the caller treats
  // "unknown" distinctly from a definitive COMPLETED/ABORTED and leaves the row
  // for a later pass.
  private async readBroadcastStatus(
    outreachId: number,
    pkStr: string,
  ): Promise<RobocallBroadcastStatus | null> {
    try {
      return await this.vendor.getBroadcastStatus(pkStr)
    } catch (err) {
      await this.handleReadFailure(err, outreachId, pkStr, 'status')
      return null
    }
  }

  // Reads the actual connected/billable call count for the finished run — the
  // billable-count source the capture slice charges. The vendor port returns a
  // genuine number (including a real 0), never a "not reported yet" null: a
  // terminal broadcast has its count, so an ABSENT count is a permanent anomaly,
  // not a transient wait. Returns null ONLY on a TRANSIENT read failure so the
  // caller leaves the row in `dialed` to poll again; a permanent failure (a
  // wrong shape, or a missing count — FINDING B) is parked `uncollectable` in
  // handleReadFailure below, never retried forever. A genuine numeric 0 (an
  // all-suppressed run) IS a real count and passes through to settle.
  private async readCompletedCount(
    outreachId: number,
    pkStr: string,
  ): Promise<number | null> {
    try {
      const { connectedCount } = await this.vendor.getCompletedCount(pkStr)
      return connectedCount
    } catch (err) {
      await this.handleReadFailure(err, outreachId, pkStr, 'completed_count')
      return null
    }
  }

  // Classifies a vendor read failure and, when PERMANENT, parks the delivered
  // run `uncollectable`. TRANSIENT (a plain BadGatewayException — a 429/5xx/
  // network blip) leaves the run `dialed` to poll again. PERMANENT is anything
  // else: a ZodError (the response shape is wrong for real vendor data), a
  // VendorPermanentError (a 4xx), or the adapter's missing-count Error (FINDING
  // B — a terminal broadcast with no connected count). A silent null-and-retry
  // on a permanent failure would re-hit the vendor every sweep forever, never
  // settling. The run has DIALED, so it may owe money for connected calls we can
  // no longer count — park it `uncollectable` (the fresh-charge recovery /
  // manual review settles it), NOT `send_failed` (which voids the hold — we must
  // never void a delivered run). The CRITICAL alert surfaces the bug to ops.
  private isPermanentReadFailure(err: unknown): boolean {
    // VendorPermanentError extends BadGatewayException, so it must be checked
    // first — only a PLAIN BadGatewayException is the transient case.
    if (err instanceof VendorPermanentError) return true
    return !(err instanceof BadGatewayException)
  }

  private async handleReadFailure(
    err: unknown,
    outreachId: number,
    pkStr: string,
    source: string,
  ): Promise<void> {
    if (this.isPermanentReadFailure(err)) {
      // Emit the CRITICAL alert UNCONDITIONALLY, before the state transition: a
      // DB error on the updateMany must not swallow the only signal that a
      // delivered run was stranded by a permanent read failure. The transition
      // then has its own guard so its failure is logged and retried next sweep
      // rather than escaping to the generic per-record catch.
      this.logger.error(
        { err, outreachId, campaignPkStr: pkStr },
        `CRITICAL robocall vendor ${source} read is permanently unreadable; ` +
          'delivered run parked uncollectable for manual settlement',
      )
      try {
        await this.model.updateMany({
          where: { outreachId, settleState: RobocallSettleState.dialed },
          data: { settleState: RobocallSettleState.uncollectable },
        })
      } catch (dbErr) {
        this.logger.error(
          { err: dbErr, outreachId, campaignPkStr: pkStr },
          'robocall: failed to park delivered run uncollectable after a ' +
            'permanent vendor read failure; retry next sweep',
        )
      }
      return
    }
    this.logger.error(
      { err, outreachId, campaignPkStr: pkStr },
      `robocall vendor ${source} read failed while polling; retry next sweep`,
    )
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
