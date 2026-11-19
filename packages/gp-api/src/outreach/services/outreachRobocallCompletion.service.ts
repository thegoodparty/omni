import { Injectable } from '@nestjs/common'
import { addHours, subHours } from 'date-fns'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import type { JobRun, ScheduleData } from '@/jobs/jobs.registry'
import { JobsService } from '@/jobs/jobs.service'
import {
  ROBOCALL_RUN_HOURS,
  ROBOCALL_SETTLE_MARGIN_HOURS,
} from '@/shared/util/robocallHold.util'
import { CallhubCampaignService } from '@/vendors/callhub/services/callhubCampaign.service'
import {
  OutreachStatus,
  Prisma,
  RobocallSettleState,
} from '../../generated/prisma'
import { VENDOR_CRONS_ENABLED } from 'src/shared/util/appEnvironment.util'

// The sweep finds its runs with this, and each run's robocallSettle job reads
// the run back through it, so a job that waited in the queue does nothing for
// a run that has since moved on.
const completionDue = (now: Date): Prisma.OutreachRobocallWhereInput => ({
  settleState: RobocallSettleState.dialed,
  callhubCampaignPkStr: { not: null },
  AND: [
    {
      OR: [
        // Only a hold-model run settles here. An estimate-billed run
        // (charged upfront, `chargeIntentId` set, NO authorization hold)
        // also reaches `dialed`, but capturing off a non-existent hold
        // would double-charge it, so its own sweeps own it and `dialed`
        // is its terminal — exclude it.
        { authorizationIntentId: { not: null } },
        // A run a reward code paid for in full has no hold either, but
        // it must still settle so the spine completes; capture records
        // it at $0 without touching Stripe.
        { promoCoversTotal: true },
      ],
    },
    {
      OR: [
        // The run window has elapsed since the dial: the calls have had
        // their chance, so settle and bill the estimate.
        { dialedAt: { lte: subHours(now, ROBOCALL_RUN_HOURS) } },
        // Or the hold is approaching its capture deadline: settle now
        // regardless so a hold never lapses uncaptured (the capture sweep
        // still prioritizes by captureBefore asc). Guards a send whose
        // window is shorter than the run — the hold must be captured
        // before it expires.
        {
          captureBefore: {
            lte: addHours(now, ROBOCALL_SETTLE_MARGIN_HOURS),
          },
        },
      ],
    },
  ],
})

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
  constructor(
    private readonly campaign: CallhubCampaignService,
    private readonly jobs: JobsService,
  ) {
    super()
  }

  // The robocallCompletionSweep schedule (src/jobs/jobs.registry.ts) sends one
  // robocallSettle job per run. This dials nothing and moves no money — its
  // only write is an idempotent per-record CAS advancing a run-window-elapsed
  // run to `settling`, so a job that runs twice settles the run once. The
  // VENDOR_CRONS_ENABLED guard is the sole gate it needs — the best-effort
  // CallHub stop hits a rate-limited vendor that must not be called on
  // dev/preview. Each job checks it too, since any gp-api pointed at a
  // database works its queues.
  async sweepRobocallCompletion(sweep: JobRun<ScheduleData>): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const ready = await this.model.findMany({
      where: completionDue(new Date()),
      orderBy: { captureBefore: Prisma.SortOrder.asc },
      select: { outreachId: true },
    })
    await this.jobs.sendMany(
      'robocallSettle',
      ready.map(({ outreachId }) => ({
        data: { outreachId },
        key: `${outreachId}:${sweep.id}`,
      })),
    )
  }

  // One run's settlement. Only a database failure escapes settle (the CallHub
  // stop is best-effort), so it throws and the job retries behind the CAS.
  async settleDueRun(job: JobRun<{ outreachId: number }>): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const { outreachId } = job.data
    const run = await this.model.findFirst({
      where: { outreachId, ...completionDue(new Date()) },
      select: { callhubCampaignPkStr: true, billableCount: true },
    })
    if (!run?.callhubCampaignPkStr) return
    // Null billing belongs to the `draft` state alone, which the sweep's
    // settleState scope can never select.
    if (run.billableCount === null) {
      this.logger.error(
        { outreachId },
        'robocall completion: billing missing on a non-draft row; skipping',
      )
      return
    }
    await this.settle(outreachId, run.callhubCampaignPkStr, run.billableCount)
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
    // The run is delivered, so the spine completes HERE, not at funds capture.
    // Capture can end in `voided`, `uncollectable` or a later fresh `charged`
    // (and a fully-couponed run moves no money at all); none of those must
    // leave the history UI on "Sending" forever.
    await this.markSpineCompleted(outreachId)
  }

  // CAS-guarded on the pre-terminal visible states so it never overrides a
  // canceled/failed row and is idempotent. Best-effort: settlement already
  // committed, so a miss only leaves stale history that capture retries.
  private async markSpineCompleted(outreachId: number): Promise<void> {
    try {
      await this.client.outreach.updateMany({
        where: {
          id: outreachId,
          status: { in: [OutreachStatus.pending, OutreachStatus.in_progress] },
        },
        data: { status: OutreachStatus.completed },
      })
    } catch (err) {
      this.logger.error(
        { err, outreachId },
        'robocall completion: failed to advance spine to completed',
      )
    }
  }
}
