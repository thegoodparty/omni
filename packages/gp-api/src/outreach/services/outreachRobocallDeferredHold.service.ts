import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { addDays } from 'date-fns'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { ROBOCALL_HOLD_WINDOW_DAYS } from '@/shared/util/robocallHold.util'
import { OutreachType, RobocallSettleState } from '../../generated/prisma'
import { OutreachRobocallHoldService } from './outreachRobocallHold.service'

// Daily, a non-:00 minute distinct from the other robocall crons (staging runs
// on the 7,17,27,37,47,57 * * * * slot). A daily cadence is plenty: the 3-day
// window means a draft that enters it is still days from its send, so placing
// the hold on the next daily pass leaves ample room.
const ROBOCALL_DEFERRED_HOLD_SWEEP_CRON = '13 8 * * *'
const ROBOCALL_DEFERRED_HOLD_SWEEP_JOB = 'robocallDeferredHoldSweep'

// Kill-switch, default OFF. This sweep RESERVES REAL MONEY off-session without
// the candidate present, so it must not auto-run until deliberately enabled —
// same shape as MEETINGS_AUTOMATION_ENABLED.
const isDeferredHoldEnabled = () =>
  process.env.ROBOCALL_DEFERRED_HOLD_ENABLED === 'true'

// Places the deferred authorization hold once a scheduled robocall enters the
// hold window. At schedule time a send more than ROBOCALL_HOLD_WINDOW_DAYS out
// returns `deferred` and places nothing, persisting only the chosen card
// (paymentMethodId + stripeCustomerId) on the still-pending_payment draft. This
// daily sweep finds those drafts once their send enters the window and calls
// OutreachRobocallHoldService.authorizeHold with the SAME card, off-session.
// It is only the trigger + context loader: authorizeHold owns the placement CAS,
// the estimate re-derivation, the Stripe hold, the capture-window fit, and the
// HoldPlaced/HoldFailed milestones — none of that is reimplemented here.
@Injectable()
export class OutreachRobocallDeferredHoldService extends createPrismaBase(
  MODELS.OutreachRobocall,
) {
  constructor(private readonly holds: OutreachRobocallHoldService) {
    super()
  }

  // No CronLockService / whole-job lock: placement is idempotent per record
  // behind authorizeHold's claim CAS, which only matches a pending_payment (or
  // hold_failed) draft, so two replicas racing this sweep both SELECT the same
  // candidates but only ONE wins each draft's claim — a draft already moved to
  // `authorized` is a no-op on the next pass. @Cron (not @Interval) so the
  // schedule survives deploys and every replica fires on the same instant.
  //
  // Prod-only (docs/scheduled-jobs.md § Prod-only guard) AND kill-switch-gated:
  // it reserves real money off-session, so it must not fire on dev/preview where
  // Stripe is stubbed, and must stay OFF until explicitly enabled.
  @Cron(ROBOCALL_DEFERRED_HOLD_SWEEP_CRON, {
    name: ROBOCALL_DEFERRED_HOLD_SWEEP_JOB,
    timeZone: EASTERN_TIMEZONE,
  })
  async sweepDeferredHolds(): Promise<void> {
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') return
    if (!isDeferredHoldEnabled()) return

    const now = new Date()
    // Entered the window, still future: a card was chosen at schedule time (both
    // ids persisted) and the send now falls inside ROBOCALL_HOLD_WINDOW_DAYS.
    const candidates = await this.model.findMany({
      where: {
        settleState: RobocallSettleState.pending_payment,
        paymentMethodId: { not: null },
        stripeCustomerId: { not: null },
        outreach: {
          outreachType: OutreachType.robocall,
          date: { gt: now, lte: addDays(now, ROBOCALL_HOLD_WINDOW_DAYS) },
        },
      },
      include: {
        outreach: {
          include: {
            campaign: { include: { user: true } },
            organization: true,
          },
        },
      },
    })

    for (const draft of candidates) {
      const { campaign, organization } = draft.outreach
      const user = campaign.user
      // A robocall draft always carries a user and org; a row missing either
      // can't place a hold, so log and skip rather than throw the whole sweep.
      if (!user || !organization || !draft.paymentMethodId) {
        this.logger.error(
          { outreachId: draft.outreachId },
          'deferred robocall hold missing user/org/card; skipping',
        )
        continue
      }
      try {
        await this.holds.authorizeHold(
          user,
          campaign,
          organization,
          draft.outreachId,
          draft.paymentMethodId,
        )
      } catch (err) {
        // Per-record isolation: one draft's failure must not abort the rest.
        // The next daily sweep retries it while it is still in-window.
        this.logger.error(
          { err, outreachId: draft.outreachId },
          'deferred robocall hold placement failed; continuing sweep',
        )
      }
    }
  }
}
