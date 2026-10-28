import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { addDays, addHours, isAfter, subHours, subMinutes } from 'date-fns'
import { OutreachHoldState } from '@/generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { VENDOR_CRONS_ENABLED } from 'src/shared/util/appEnvironment.util'
import { EASTERN_TIMEZONE } from 'src/shared/util/date.util'
import { StripeService } from 'src/vendors/stripe/services/stripe.service'
import {
  HOLD_CLAIM_STALE_MINUTES,
  HOLD_EXPIRY_GUARD_HOURS,
  HOLD_PLACEMENT_LEAD_DAYS,
  HOLD_REMINDER_QUIET_HOURS,
  HOLD_UNPLACED_ALERT_HOURS,
} from '../paymentHolds.constants'
import { OutreachOrphanedHoldService } from './outreachOrphanedHold.service'
import { PaymentHoldEventsService } from './paymentHoldEvents.service'
import { PaymentHoldsService } from './paymentHolds.service'

// Every minute of the ten-minute family already has a job. Recovery sits
// beside a non-Stripe job; placement shares :01/:31 with robocall's deferred
// hold sweep, a handful of Stripe calls each.
const PLACEMENT_CRON = '1,11,21,31,41,51 * * * *'
const PLACEMENT_JOB = 'paymentHoldPlacementSweep'
const RECOVERY_CRON = '6,16,26,36,46,56 * * * *'
const RECOVERY_JOB = 'paymentHoldRecoverySweep'
const EXPIRY_GUARD_CRON = '38 * * * *'
const EXPIRY_GUARD_JOB = 'paymentHoldExpiryGuard'
const RECONCILE_CRON = '24 * * * *'
const RECONCILE_JOB = 'paymentHoldReconcileSweep'
const UNPAID_CRON = '5,15,25,35,45,55 * * * *'
const UNPAID_JOB = 'paymentHoldUnpaidSweep'
const REMINDER_CRON = '18 10 * * *'
const REMINDER_JOB = 'paymentHoldReminderSweep'

// No CronLockService: every unit of work is behind a per-row compare-and-set
// in PaymentHoldsService, so a second replica's pass claims nothing. Gated on
// VENDOR_CRONS_ENABLED because each places, captures or voids real holds on
// prod.
@Injectable()
export class PaymentHoldsSweepService extends createPrismaBase(
  MODELS.OutreachPaymentHold,
) {
  constructor(
    private readonly holds: PaymentHoldsService,
    private readonly orphanedHolds: OutreachOrphanedHoldService,
    private readonly stripe: StripeService,
    private readonly events: PaymentHoldEventsService,
  ) {
    super()
  }

  @Cron(PLACEMENT_CRON, { name: PLACEMENT_JOB, timeZone: EASTERN_TIMEZONE })
  async sweepPlacements(): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const now = new Date()
    const due = await this.model.findMany({
      where: {
        state: OutreachHoldState.scheduled,
        outreach: {
          date: { gt: now, lte: addDays(now, HOLD_PLACEMENT_LEAD_DAYS) },
        },
      },
      select: { outreachId: true, outreach: { select: { date: true } } },
    })
    for (const { outreachId, outreach } of due) {
      try {
        await this.holds.placeScheduledHold(outreachId)
      } catch (err) {
        const urgent =
          outreach.date &&
          !isAfter(outreach.date, addHours(now, HOLD_UNPLACED_ALERT_HOURS))
        this.logger.error(
          { err, outreachId, sendAt: outreach.date },
          urgent
            ? 'CRITICAL payment hold still not placed within a day of its send'
            : 'Payment hold placement failed; the next sweep retries it',
        )
      }
    }
  }

  @Cron(RECOVERY_CRON, { name: RECOVERY_JOB, timeZone: EASTERN_TIMEZONE })
  async sweepStaleClaims(): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const stale = await this.model.findMany({
      where: {
        state: {
          in: [OutreachHoldState.placing, OutreachHoldState.capturing],
        },
        claimedAt: { lt: subMinutes(new Date(), HOLD_CLAIM_STALE_MINUTES) },
      },
      select: { outreachId: true, state: true },
    })
    for (const { outreachId, state } of stale) {
      try {
        await (state === OutreachHoldState.placing
          ? this.holds.recoverStalePlacement(outreachId)
          : this.holds.recoverStaleCapture(outreachId))
      } catch (err) {
        this.logger.error(
          { err, outreachId, state },
          'Payment hold recovery failed; the next sweep retries it',
        )
      }
    }
  }

  @Cron(EXPIRY_GUARD_CRON, {
    name: EXPIRY_GUARD_JOB,
    timeZone: EASTERN_TIMEZONE,
  })
  async settleExpiringHolds(): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const expiring = await this.model.findMany({
      where: {
        state: OutreachHoldState.held,
        captureBefore: {
          lte: addHours(new Date(), HOLD_EXPIRY_GUARD_HOURS),
        },
      },
      select: { outreachId: true, captureBefore: true },
    })
    for (const { outreachId, captureBefore } of expiring) {
      try {
        await this.holds.settle({ outreachId })
      } catch (err) {
        this.logger.error(
          { err, outreachId, captureBefore },
          'Settling a payment hold near its capture deadline failed',
        )
      }
    }
  }

  // Only intents recorded at a void site are touched.
  @Cron(RECONCILE_CRON, { name: RECONCILE_JOB, timeZone: EASTERN_TIMEZONE })
  async reconcileOrphanedHolds(): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    for (const orphan of await this.orphanedHolds.findUnvoided()) {
      try {
        const intent = await this.stripe.retrievePaymentIntent(
          orphan.paymentIntentId,
        )
        if (intent.status === 'requires_capture') {
          await this.stripe.cancelHold(orphan.paymentIntentId)
        }
        await this.orphanedHolds.markVoided(orphan.id)
      } catch (err) {
        this.logger.error(
          { err, paymentIntentId: orphan.paymentIntentId },
          'Re-voiding an orphaned payment hold failed; the next sweep retries',
        )
      }
    }
  }

  // A hold still scheduled or failed at its send time never got paid for.
  // Releasing it is what makes the channel find nothing to send against.
  @Cron(UNPAID_CRON, { name: UNPAID_JOB, timeZone: EASTERN_TIMEZONE })
  async releaseUnpaidHolds(): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const unpaid = await this.model.findMany({
      where: {
        state: {
          in: [OutreachHoldState.scheduled, OutreachHoldState.hold_failed],
        },
        outreach: { date: { lte: new Date() } },
      },
      select: { outreachId: true, state: true },
    })
    for (const { outreachId, state } of unpaid) {
      try {
        if (!(await this.holds.releaseUnpaid(outreachId))) continue
        if (state === OutreachHoldState.scheduled) {
          this.logger.error(
            { outreachId },
            'CRITICAL payment hold never placed and released at its send time',
          )
        }
      } catch (err) {
        this.logger.error(
          { err, outreachId },
          'Releasing an unpaid payment hold failed; the next sweep retries it',
        )
      }
    }
  }

  // Daily while a declined hold is waiting on a new card and its send is
  // still ahead. The date in the messageId keeps a replay to one email a day.
  @Cron(REMINDER_CRON, { name: REMINDER_JOB, timeZone: EASTERN_TIMEZONE })
  async remindFailedHolds(): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const now = new Date()
    const failed = await this.model.findMany({
      where: {
        state: OutreachHoldState.hold_failed,
        updatedAt: { lt: subHours(now, HOLD_REMINDER_QUIET_HOURS) },
        outreach: { date: { gt: now } },
      },
      select: { outreachId: true },
    })
    for (const { outreachId } of failed) {
      await this.events.emit('reminder', outreachId, { day: now })
    }
  }
}
