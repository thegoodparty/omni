import { Injectable } from '@nestjs/common'
import { addDays, addHours, isAfter, subHours, subMinutes } from 'date-fns'
import { OutreachHoldState, OutreachStatus, Prisma } from '@/generated/prisma'
import type { JobRun, ScheduleData } from '@/jobs/jobs.registry'
import { JobsService } from '@/jobs/jobs.service'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { VENDOR_CRONS_ENABLED } from 'src/shared/util/appEnvironment.util'
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

// Each sweep finds its holds with one of these, and its per-hold job reads
// the hold back through the same filter, so a job that waited in the queue
// does nothing for a hold that has since moved on.
const placementDue = (now: Date): Prisma.OutreachPaymentHoldWhereInput => ({
  state: OutreachHoldState.scheduled,
  outreach: {
    date: { gt: now, lte: addDays(now, HOLD_PLACEMENT_LEAD_DAYS) },
  },
})

const staleClaim = (now: Date): Prisma.OutreachPaymentHoldWhereInput => ({
  state: { in: [OutreachHoldState.placing, OutreachHoldState.capturing] },
  claimedAt: { lt: subMinutes(now, HOLD_CLAIM_STALE_MINUTES) },
})

const nearExpiry = (now: Date): Prisma.OutreachPaymentHoldWhereInput => ({
  state: OutreachHoldState.held,
  captureBefore: { lte: addHours(now, HOLD_EXPIRY_GUARD_HOURS) },
})

const unpaidAtSend = (now: Date): Prisma.OutreachPaymentHoldWhereInput => ({
  state: { in: [OutreachHoldState.scheduled, OutreachHoldState.hold_failed] },
  outreach: { date: { lte: now }, status: { not: OutreachStatus.draft } },
})

const reminderDue = (now: Date): Prisma.OutreachPaymentHoldWhereInput => ({
  state: OutreachHoldState.hold_failed,
  updatedAt: { lt: subHours(now, HOLD_REMINDER_QUIET_HOURS) },
  outreach: { date: { gt: now }, status: { not: OutreachStatus.draft } },
})

// The paymentHold* schedules and their per-hold jobs (src/jobs/
// jobs.registry.ts). Each sweep sends one job per hold, keyed on the hold
// and the sweep's run, so a retried sweep sends nothing twice. Every unit of
// work is behind a per-row compare-and-set in PaymentHoldsService, so a job
// that runs twice does nothing the second time. A per-hold job logs a failed
// step and completes, as the cron loop did: the next sweep picks the hold up
// again, and a claim the failure left behind goes to recovery, so a retry
// would mostly find the claim taken. Gated on VENDOR_CRONS_ENABLED because
// each places, captures or voids real holds on prod.
@Injectable()
export class PaymentHoldsSweepService extends createPrismaBase(
  MODELS.OutreachPaymentHold,
) {
  constructor(
    private readonly holds: PaymentHoldsService,
    private readonly orphanedHolds: OutreachOrphanedHoldService,
    private readonly stripe: StripeService,
    private readonly events: PaymentHoldEventsService,
    private readonly jobs: JobsService,
  ) {
    super()
  }

  async sweepPlacements(sweep: JobRun<ScheduleData>): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const due = await this.model.findMany({
      where: placementDue(new Date()),
      select: { outreachId: true },
    })
    await this.jobs.sendMany(
      'paymentHoldPlace',
      due.map(({ outreachId }) => ({
        data: { outreachId },
        key: `${outreachId}:${sweep.id}`,
      })),
    )
  }

  async placeDueHold(job: JobRun<{ outreachId: number }>): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const { outreachId } = job.data
    const now = new Date()
    const hold = await this.model.findFirst({
      where: { outreachId, ...placementDue(now) },
      select: { outreach: { select: { date: true } } },
    })
    if (!hold) return
    try {
      await this.holds.placeScheduledHold(outreachId)
    } catch (err) {
      const urgent =
        hold.outreach.date &&
        !isAfter(hold.outreach.date, addHours(now, HOLD_UNPLACED_ALERT_HOURS))
      this.logger.error(
        { err, outreachId, sendAt: hold.outreach.date },
        urgent
          ? 'CRITICAL payment hold still not placed within a day of its send'
          : 'Payment hold placement failed; the next sweep retries it',
      )
    }
  }

  async sweepStaleClaims(sweep: JobRun<ScheduleData>): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const stale = await this.model.findMany({
      where: staleClaim(new Date()),
      select: { outreachId: true },
    })
    await this.jobs.sendMany(
      'paymentHoldRecover',
      stale.map(({ outreachId }) => ({
        data: { outreachId },
        key: `${outreachId}:${sweep.id}`,
      })),
    )
  }

  async recoverStaleHold(job: JobRun<{ outreachId: number }>): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const { outreachId } = job.data
    const hold = await this.model.findFirst({
      where: { outreachId, ...staleClaim(new Date()) },
      select: { state: true },
    })
    if (!hold) return
    try {
      await (hold.state === OutreachHoldState.placing
        ? this.holds.recoverStalePlacement(outreachId)
        : this.holds.recoverStaleCapture(outreachId))
    } catch (err) {
      this.logger.error(
        { err, outreachId, state: hold.state },
        'Payment hold recovery failed; the next sweep retries it',
      )
    }
  }

  async settleExpiringHolds(sweep: JobRun<ScheduleData>): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const expiring = await this.model.findMany({
      where: nearExpiry(new Date()),
      select: { outreachId: true },
    })
    await this.jobs.sendMany(
      'paymentHoldSettleExpiring',
      expiring.map(({ outreachId }) => ({
        data: { outreachId },
        key: `${outreachId}:${sweep.id}`,
      })),
    )
  }

  async settleExpiringHold(job: JobRun<{ outreachId: number }>): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const { outreachId } = job.data
    const hold = await this.model.findFirst({
      where: { outreachId, ...nearExpiry(new Date()) },
      select: { captureBefore: true },
    })
    if (!hold) return
    try {
      await this.holds.settle({ outreachId })
    } catch (err) {
      this.logger.error(
        { err, outreachId, captureBefore: hold.captureBefore },
        'Settling a payment hold near its capture deadline failed',
      )
    }
  }

  // Only intents recorded at a void site are touched.
  async reconcileOrphanedHolds(sweep: JobRun<ScheduleData>): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const orphans = await this.orphanedHolds.findUnvoided()
    await this.jobs.sendMany(
      'paymentHoldReconcileOrphan',
      orphans.map(({ id }) => ({
        data: { orphanedHoldId: id },
        key: `${id}:${sweep.id}`,
      })),
    )
  }

  async reconcileOrphanedHold(
    job: JobRun<{ orphanedHoldId: number }>,
  ): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const orphan = await this.orphanedHolds.findFirst({
      where: { id: job.data.orphanedHoldId, voidedAt: null },
    })
    if (!orphan) return
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

  // A hold still scheduled or failed at its send time never got paid for.
  // Releasing it is what makes the channel find nothing to send against. A
  // draft's hold was declined at confirm with the user present, and the send
  // was never scheduled, so it is left for the next confirm to retry.
  async releaseUnpaidHolds(sweep: JobRun<ScheduleData>): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const unpaid = await this.model.findMany({
      where: unpaidAtSend(new Date()),
      select: { outreachId: true },
    })
    await this.jobs.sendMany(
      'paymentHoldReleaseUnpaid',
      unpaid.map(({ outreachId }) => ({
        data: { outreachId },
        key: `${outreachId}:${sweep.id}`,
      })),
    )
  }

  async releaseUnpaidHold(job: JobRun<{ outreachId: number }>): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const { outreachId } = job.data
    const hold = await this.model.findFirst({
      where: { outreachId, ...unpaidAtSend(new Date()) },
      select: { state: true },
    })
    if (!hold) return
    try {
      if (!(await this.holds.releaseUnpaid(outreachId))) return
      if (hold.state === OutreachHoldState.scheduled) {
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

  // Daily while a declined hold is waiting on a new card and its send is
  // still ahead. The day rides in the job and the messageId, which keeps a
  // replay to one email a day. A draft's decline was shown at confirm, and
  // nothing is scheduled to miss.
  async remindFailedHolds(): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const now = new Date()
    const day = now.toISOString().slice(0, 10)
    const failed = await this.model.findMany({
      where: reminderDue(now),
      select: { outreachId: true },
    })
    await this.jobs.sendMany(
      'paymentHoldRemind',
      failed.map(({ outreachId }) => ({
        data: { outreachId, day },
        key: `${outreachId}:${day}`,
      })),
    )
  }

  async remindFailedHold(
    job: JobRun<{ outreachId: number; day: string }>,
  ): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const { outreachId, day } = job.data
    const hold = await this.model.findFirst({
      where: { outreachId, ...reminderDue(new Date()) },
      select: { outreachId: true },
    })
    if (!hold) return
    await this.events.emit('reminder', outreachId, { day: new Date(day) })
  }
}
