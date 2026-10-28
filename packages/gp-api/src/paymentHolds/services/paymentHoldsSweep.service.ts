import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { addDays, addHours, isAfter, subMinutes } from 'date-fns'
import { OutreachHoldState } from '@/generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { VENDOR_CRONS_ENABLED } from 'src/shared/util/appEnvironment.util'
import { EASTERN_TIMEZONE } from 'src/shared/util/date.util'
import { StripeService } from 'src/vendors/stripe/services/stripe.service'
import {
  HOLD_CLAIM_STALE_MINUTES,
  HOLD_EXPIRY_GUARD_HOURS,
  HOLD_PLACEMENT_LEAD_DAYS,
  HOLD_UNPLACED_ALERT_HOURS,
} from '../paymentHolds.constants'
import { OutreachOrphanedHoldService } from './outreachOrphanedHold.service'
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
    const overdue = await this.model.findMany({
      where: {
        state: OutreachHoldState.scheduled,
        outreach: { date: { lte: now } },
      },
      select: { outreachId: true },
    })
    if (overdue.length > 0) {
      this.logger.error(
        { outreachIds: overdue.map(({ outreachId }) => outreachId) },
        'CRITICAL payment holds never placed and now past their send time',
      )
    }

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
}
