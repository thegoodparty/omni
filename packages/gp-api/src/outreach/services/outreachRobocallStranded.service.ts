import { Injectable } from '@nestjs/common'
import { subMinutes } from 'date-fns'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import type { JobRun, ScheduleData } from '@/jobs/jobs.registry'
import { JobsService } from '@/jobs/jobs.service'
import { ROBOCALL_STAGING_GRACE_MINUTES } from '@/shared/util/robocallHold.util'
import {
  OutreachType,
  Prisma,
  RobocallSettleState,
} from '../../generated/prisma'
import { OutreachRobocallHoldService } from './outreachRobocallHold.service'
import { VENDOR_CRONS_ENABLED } from 'src/shared/util/appEnvironment.util'

// The sweep finds its drafts with this, and each draft's robocallStrandedFail
// job reads the draft back through it, so a job that waited in the queue does
// nothing for a draft that has since moved on.
const strandedDue = (now: Date): Prisma.OutreachRobocallWhereInput => ({
  settleState: RobocallSettleState.authorized,
  // Never staged: a staged past-due draft still dials via the send sweep,
  // so it is the send sweep's concern — failing it here would kill the
  // staged backlog. `staging` (in-flight), `pending_payment` and
  // `hold_failed` are owned by other sweeps.
  callhubCampaignPkStr: null,
  outreach: {
    outreachType: OutreachType.robocall,
    // Send passed by MORE than the staging grace with no campaign ever
    // staged. A run only `now - grace` late is still staging-eligible (the
    // staging sweep's lower bound reaches back to this same boundary), so
    // failing it here would kill a run staging is about to rescue. At one
    // instant that split is disjoint; but this sweep and staging fire on
    // separate cron ticks, so their date windows can briefly overlap. The
    // `callhubCampaignPkStr: null` guard in the failSend CAS below is
    // what actually stops a double-handle: once staging claims the row
    // this sweep's failSend matches nothing. Keep it — neither alone
    // suffices.
    date: { lt: subMinutes(now, ROBOCALL_STAGING_GRACE_MINUTES) },
  },
})

// Recovers a robocall stranded in `authorized` that NEVER staged
// (`callhubCampaignPkStr` still NULL) once its send passed: the staging sweep
// only stages future sends and the send sweep only dials staged drafts, so a
// never-staged past-due draft is caught by no other sweep — it strands in
// `authorized` forever with its Stripe hold reserved, the spine still showing
// "Scheduled", and nothing surfaced. This sweep fails it cleanly via failSend,
// which voids/releases the hold, marks send_failed + the spine failed, emails
// the candidate, and fires the CRITICAL alert. It only ever fails a
// definitively-undeliverable, never-staged, past-due draft (the safe
// direction) and only releases money — like the deferred-cancel and
// hold-reconcile sweeps, it is gated by nothing beyond the VENDOR_CRONS_ENABLED
// guard.
@Injectable()
export class OutreachRobocallStrandedService extends createPrismaBase(
  MODELS.OutreachRobocall,
) {
  constructor(
    private readonly holds: OutreachRobocallHoldService,
    private readonly jobs: JobsService,
  ) {
    super()
  }

  // VENDOR_CRONS_ENABLED (failSend voids a real Stripe hold and emails; test
  // mode where vendors are mocked). The robocallStrandedAuthorizedSweep
  // schedule (src/jobs/jobs.registry.ts) sends one robocallStrandedFail job
  // per draft; failSend's own single-owner CAS elects one winner per draft,
  // so a job that runs twice fails the draft once. Each job checks the gate
  // too, since any gp-api pointed at a database works its queues.
  async sweepStrandedAuthorized(sweep: JobRun<ScheduleData>): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const candidates = await this.model.findMany({
      where: strandedDue(new Date()),
      select: { outreachId: true },
    })
    await this.jobs.sendMany(
      'robocallStrandedFail',
      candidates.map(({ outreachId }) => ({
        data: { outreachId },
        key: `${outreachId}:${sweep.id}`,
      })),
    )
  }

  // A failure throws and the job retries: failSend only releases money, and
  // its CAS makes the retry a no-op once the draft is failed.
  async failStrandedDraft(job: JobRun<{ outreachId: number }>): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const { outreachId } = job.data
    const due = await this.model.findFirst({
      where: { outreachId, ...strandedDue(new Date()) },
      select: { outreachId: true },
    })
    if (!due) return
    await this.holds.failSend(outreachId, 'expired_unstaged')
  }
}
