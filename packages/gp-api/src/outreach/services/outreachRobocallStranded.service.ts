import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { OutreachType, RobocallSettleState } from '../../generated/prisma'
import { OutreachRobocallHoldService } from './outreachRobocallHold.service'

// Every 15 minutes on the only minute-of-hour slots no other robocall cron
// touches (send :04.., capture :02.., staging :07.., reconcile :03.., recovery
// :08.., completion :09.., fresh-charge :05.., cleanup :00.., deferred-cancel
// 1,16,31,46, hold-failure-cancel 11,26,41,56 all occupy the rest). A strand is
// rare and its money sits ~7 days before the auth expires, so a 15-minute
// cadence is ample. Explicit timeZone per docs/scheduled-jobs.md.
const ROBOCALL_STRANDED_SWEEP_CRON = '6,21,36,51 * * * *'
const ROBOCALL_STRANDED_SWEEP_JOB = 'robocallStrandedAuthorizedSweep'

// Recovers a robocall stranded in `authorized` that NEVER staged
// (`callhubCampaignPkStr` still NULL) once its send passed: the staging sweep
// only stages future sends and the send sweep only dials staged drafts, so a
// never-staged past-due draft is caught by no other sweep — it strands in
// `authorized` forever with its Stripe hold reserved, the spine still showing
// "Scheduled", and nothing surfaced. This sweep fails it cleanly via failSend,
// which voids/releases the hold, marks send_failed + the spine failed, emails
// the candidate, and fires the CRITICAL alert. It only ever fails a
// definitively-undeliverable, never-staged, past-due draft (the safe
// direction) and only releases money, so — like the deferred-cancel and
// hold-reconcile sweeps — it is prod-only but deliberately NOT kill-switch-
// gated: a strand can occur regardless of ROBOCALL_SEND_ENABLED /
// ROBOCALL_CAPTURE_ENABLED (staging is not switch-gated), so gating it would
// leave the reserved money stranded during the supervised rollout.
@Injectable()
export class OutreachRobocallStrandedService extends createPrismaBase(
  MODELS.OutreachRobocall,
) {
  constructor(private readonly holds: OutreachRobocallHoldService) {
    super()
  }

  // Prod-only (failSend voids a real Stripe hold and emails, stubbed on
  // dev/preview). No CronLockService: failSend's own single-owner CAS elects one
  // winner per draft, so two replicas racing this sweep both SELECT the same
  // candidates but only ONE fails each — idempotent across replicas. @Cron (not
  // @Interval) so the schedule survives deploys.
  @Cron(ROBOCALL_STRANDED_SWEEP_CRON, {
    name: ROBOCALL_STRANDED_SWEEP_JOB,
    timeZone: EASTERN_TIMEZONE,
  })
  async sweepStrandedAuthorized(): Promise<void> {
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') return

    const now = new Date()
    const candidates = await this.model.findMany({
      where: {
        settleState: RobocallSettleState.authorized,
        // Never staged: a staged past-due draft still dials when the send switch
        // is on, so it is the send sweep's concern — failing it here would kill
        // the deliberately switch-gated staged backlog. `staging` (in-flight),
        // `pending_payment` and `hold_failed` are owned by other sweeps.
        callhubCampaignPkStr: null,
        outreach: {
          outreachType: OutreachType.robocall,
          // Send passed with no campaign ever staged.
          date: { lte: now },
        },
      },
      select: { outreachId: true },
    })

    for (const { outreachId } of candidates) {
      try {
        await this.holds.failSend(outreachId, 'expired_unstaged')
      } catch (err) {
        // Per-record isolation: one draft's failure must not abort the sweep.
        this.logger.error(
          { err, outreachId },
          'robocall stranded-authorized fail failed for a draft; continuing',
        )
      }
    }
  }
}
