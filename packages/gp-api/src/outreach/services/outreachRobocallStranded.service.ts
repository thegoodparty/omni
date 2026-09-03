import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { isRobocallEstimateBillingEnabled } from '@/shared/util/robocallHold.util'
import { OutreachType, RobocallSettleState } from '../../generated/prisma'
import { OutreachRobocallChargeService } from './outreachRobocallCharge.service'
import { OutreachRobocallHoldService } from './outreachRobocallHold.service'

// Every 15 minutes on the only minute-of-hour slots no other robocall cron
// touches (send :04.., capture :02.., staging :07.., reconcile :03.., recovery
// :08.., completion :09.., fresh-charge :05.., cleanup :00.., deferred-cancel
// 1,16,31,46, hold-failure-cancel 11,26,41,56 all occupy the rest). A strand is
// rare and its money sits ~7 days before the auth expires, so a 15-minute
// cadence is ample. Explicit timeZone per docs/scheduled-jobs.md.
const ROBOCALL_STRANDED_SWEEP_CRON = '6,21,36,51 * * * *'
const ROBOCALL_STRANDED_SWEEP_JOB = 'robocallStrandedAuthorizedSweep'

// The estimate-billing (CONTINGENCY) analogue shares the authorized sweep's
// 15-minute cadence: the two are mutually exclusive in practice — a draft is
// `authorized` (hold model) OR `paid` (charge model) depending on how it was
// paid, never both — so running them on the same minute never doubles work, and
// every non-herd minute slot is already claimed by another robocall cron.
const ROBOCALL_STRANDED_PAID_SWEEP_JOB = 'robocallStrandedPaidSweep'

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
  constructor(
    private readonly holds: OutreachRobocallHoldService,
    private readonly charge: OutreachRobocallChargeService,
  ) {
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

  // The estimate-billing (CONTINGENCY) analogue: a draft that CHARGED its
  // estimate up front (`paid`) but whose send passed while still UN-staged
  // (`callhubCampaignPkStr` NULL, `chargeIntentId` committed) is caught by no
  // other sweep — staging only stages future sends, send only dials staged
  // drafts — so it would sit in `paid` forever with the estimate captured, zero
  // calls placed, and nothing surfaced. failStrandedEstimate moves it to
  // send_failed, logs CRITICAL for a MANUAL refund (this branch never
  // auto-refunds), and emails the candidate. Gated ENTIRELY on the flag so it is
  // inert when the contingency model is off; unlike the authorized sweep it voids
  // no Stripe hold, so it is NOT prod-only — a strand can occur wherever the flag
  // charged the estimate. @Cron (not @Interval) so the schedule survives deploys;
  // failStrandedEstimate's single-owner CAS elects one winner per draft across
  // replicas.
  @Cron(ROBOCALL_STRANDED_SWEEP_CRON, {
    name: ROBOCALL_STRANDED_PAID_SWEEP_JOB,
    timeZone: EASTERN_TIMEZONE,
  })
  async sweepStrandedPaid(): Promise<void> {
    if (!isRobocallEstimateBillingEnabled()) return

    const now = new Date()
    const candidates = await this.model.findMany({
      where: {
        settleState: RobocallSettleState.paid,
        // The estimate was committed (never-surface-unpaid): the sub-second
        // paid-but-not-committed charge window is excluded, as is any row whose
        // charge did not land.
        chargeIntentId: { not: null },
        // Never staged: a staged (or in-flight staging/send) draft is owned by
        // the staging/send sweeps.
        callhubCampaignPkStr: null,
        outreach: {
          outreachType: OutreachType.robocall,
          date: { lte: now },
        },
      },
      select: { outreachId: true },
    })

    for (const { outreachId } of candidates) {
      try {
        await this.charge.failStrandedEstimate(outreachId)
      } catch (err) {
        // Per-record isolation: one draft's failure must not abort the sweep.
        this.logger.error(
          { err, outreachId },
          'robocall stranded-paid fail failed for a draft; continuing',
        )
      }
    }
  }
}
