import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { subMinutes } from 'date-fns'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { ROBOCALL_ESTIMATE_CLAIM_STALE_MINUTES } from '@/shared/util/robocallHold.util'
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

// The orphaned-claim recovery shares the same cadence: its candidate set (`paid`
// with chargeIntentId STILL NULL) is disjoint from both the authorized sweep
// (`authorized`) and the paid sweep (`paid` + chargeIntentId NOT null), so all
// three on the same minute only ever process their own rows.
const ROBOCALL_STRANDED_ORPHAN_SWEEP_JOB = 'robocallStrandedOrphanSweep'

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
  // auto-refunds), and emails the candidate. NOT flag-gated, deliberately: the
  // flag is designed to be flipped back OFF after real charges have landed (the
  // supported rollback), and captured money must still be surfaced — a
  // flag-gated sweep would go inert and strand every already-`paid` run with the
  // charge taken and no alert. Removing the gate never changes hold-model
  // behavior: the sweep only ever matches `paid` rows, which exist only where
  // the flag charged an estimate, so a never-flagged system has none and it
  // no-ops. Prod-only, consistent with sweepStrandedAuthorized (failSend/email
  // are stubbed on dev/preview). @Cron (not @Interval) so the schedule survives
  // deploys; failStrandedEstimate's single-owner CAS elects one winner per draft
  // across replicas.
  @Cron(ROBOCALL_STRANDED_SWEEP_CRON, {
    name: ROBOCALL_STRANDED_PAID_SWEEP_JOB,
    timeZone: EASTERN_TIMEZONE,
  })
  async sweepStrandedPaid(): Promise<void> {
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') return

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

  // The estimate-billing ORPHANED-CLAIM recovery: a chargeEstimate that won the
  // pending_payment -> paid claim (freezing the amount + persisting the card) but
  // crashed before its commit / decline / revert leaves the row `paid` with
  // chargeIntentId STILL NULL. Nothing else recovers it — staging/send +
  // sweepStrandedPaid all require chargeIntentId, the detach webhook excludes
  // `paid`, revertClaim never ran — so a charge Stripe may have CAPTURED before
  // the crash sits forever unrecorded, money taken and the candidate never
  // dialed, unalerted. This resumes the charge under the SAME stable idempotency
  // key + SAME frozen amount (a captured charge replays the SAME PaymentIntent,
  // an un-landed one charges exactly once) and commits chargeIntentId so the
  // paid run becomes deliverable — so it selects orphans regardless of send date
  // (a future orphan must be completed BEFORE its send, not only after).
  //
  // NOT flag-gated (prod-only, consistent with sweepStrandedPaid): captured money
  // must be reconciled through the supported rollback (flag flipped back OFF), so
  // this cannot go inert. Resuming COMPLETES the charge and lets the run dial —
  // and that is correct even post-rollback: staging/send never consult the
  // billing flag (they gate dialing on chargeIntentId + ROBOCALL_SEND_ENABLED),
  // so a `paid` row is an already-PURCHASED run that dials exactly as it would
  // have before the flag flipped; the operator's real dial control is
  // ROBOCALL_SEND_ENABLED, not this flag. So resume never dead-ends: if send is
  // enabled the run dials; if it is off and the send passes un-staged,
  // sweepStrandedPaid catches it → send_failed + CRITICAL + email. No
  // captured-money path ends without an alert. Like sweepStrandedPaid, removing
  // the gate never changes hold-model behavior — orphans are `paid` rows, which
  // exist only where the flag charged an estimate, so a never-flagged system has
  // none and it no-ops. resumeStrandedEstimateCharge owns the stale-guarded
  // single-owner claim, so it is idempotent across replicas. @Cron (not
  // @Interval) so it survives deploys.
  @Cron(ROBOCALL_STRANDED_SWEEP_CRON, {
    name: ROBOCALL_STRANDED_ORPHAN_SWEEP_JOB,
    timeZone: EASTERN_TIMEZONE,
  })
  async sweepOrphanedEstimateClaims(): Promise<void> {
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') return

    const staleCutoff = subMinutes(
      new Date(),
      ROBOCALL_ESTIMATE_CLAIM_STALE_MINUTES,
    )
    const candidates = await this.model.findMany({
      where: {
        settleState: RobocallSettleState.paid,
        // The orphan: claimed `paid` but the charge was never committed. A stale
        // updatedAt (older than a healthy claim->commit round-trip) proves the
        // crash, so a merely-slow in-flight charge is never reclaimed.
        chargeIntentId: null,
        updatedAt: { lt: staleCutoff },
        outreach: { outreachType: OutreachType.robocall },
      },
      select: { outreachId: true },
    })

    for (const { outreachId } of candidates) {
      try {
        await this.charge.resumeStrandedEstimateCharge(outreachId)
      } catch (err) {
        // Per-record isolation: one draft's failure must not abort the sweep.
        this.logger.error(
          { err, outreachId },
          'robocall orphaned-claim resume failed for a draft; continuing',
        )
      }
    }
  }
}
