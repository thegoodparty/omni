import { ConflictException, Injectable } from '@nestjs/common'
import { isAfter, isBefore, subHours, subMinutes } from 'date-fns'
import { JobsService } from '@/jobs/jobs.service'
import { PaymentHoldsService } from '@/paymentHolds/services/paymentHolds.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { VENDOR_CRONS_ENABLED } from '@/shared/util/appEnvironment.util'
import {
  OutreachEmailRecipientStatus,
  OutreachHoldState,
  OutreachStatus,
  OutreachType,
} from '../../generated/prisma'
import {
  AUTO_PAUSE_MIN_SENDS,
  PREPARE_GIVE_UP_HOURS,
  PREPARE_RETRY_MINUTES,
  WARMING_ADVANCE_MAX_BOUNCE_RATE,
  WARMING_ADVANCE_MAX_COMPLAINT_RATE,
  WARMING_ADVANCE_MIN_HOURS,
} from '../emailOutreach.const'
import { nextWarmingStep } from '../util/emailPricing.util'
import { SesService } from './ses.service'

const STARTABLE_STATUSES: OutreachStatus[] = [
  OutreachStatus.pending,
  OutreachStatus.pending_payment,
]

const METRICS_SETTLE_MINUTES = 5

const SETTLED_HOLD_STATES: OutreachHoldState[] = [
  OutreachHoldState.captured,
  OutreachHoldState.released,
  OutreachHoldState.uncollectable,
  OutreachHoldState.disputed,
]

// Starting and finishing sends, run by the emailDueSweep and
// emailSettleSweep schedules. Each step is a per-row compare-and-set on
// Outreach.status or the hold module's own claim, so a retried pass changes
// nothing. Gated on VENDOR_CRONS_ENABLED because starting a send leads to
// real email and finishing one captures real money.
@Injectable()
export class OutreachEmailLifecycleService extends createPrismaBase(
  MODELS.OutreachEmail,
) {
  constructor(
    private readonly holds: PaymentHoldsService,
    private readonly jobs: JobsService,
    private readonly ses: SesService,
  ) {
    super()
  }

  async sweepDue(): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return
    await this.startDueSends()
    await this.retryStalledPrepares()
  }

  async sweepSettle(): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return
    await this.settleFinishedSends()
  }

  async startDueSends(): Promise<void> {
    const due = await this.client.outreach.findMany({
      where: {
        outreachType: OutreachType.email,
        status: { in: STARTABLE_STATUSES },
        date: { lte: new Date() },
      },
      select: { id: true, status: true, email: { select: { id: true } } },
    })
    for (const outreach of due) {
      if (!outreach.email || !outreach.status) continue
      try {
        await this.startIfHeld(outreach.id, outreach.status, outreach.email.id)
      } catch (err) {
        this.logger.error(
          { err, outreachId: outreach.id },
          'Starting a due email send failed; the next sweep retries it',
        )
      }
    }
  }

  // getHold re-checks a held hold against Stripe, so a send never starts on a
  // hold Stripe no longer shows as capturable (getHold throws, and the next
  // sweep tries again).
  private async startIfHeld(
    outreachId: number,
    status: OutreachStatus,
    outreachEmailId: number,
  ): Promise<void> {
    let hold: Awaited<ReturnType<PaymentHoldsService['getHold']>>
    try {
      hold = await this.holds.getHold(outreachId)
    } catch (err) {
      if (!(err instanceof ConflictException)) throw err
      // Held here but no longer capturable at Stripe. Retrying can't fix it,
      // and the send would keep its warming reservation.
      await this.fail(outreachId, status, 'payment hold no longer active')
      return
    }
    if (!hold) {
      await this.fail(outreachId, status, 'no payment hold')
      return
    }
    // A send only goes out on a hold that is held when it comes due. Anything
    // else (never placed, declined, released by the unpaid sweep) fails the
    // send, which is then never sent. A scheduled or declined hold is left for
    // the hold module's unpaid sweep, which releases it and sends the user the
    // Canceled email; releasing it here would skip that email. A placement
    // still in flight is flagged so the placer voids instead of committing.
    if (hold.state !== OutreachHoldState.held) {
      if (hold.state === OutreachHoldState.placing) {
        await this.holds.release({ outreachId })
      }
      await this.fail(outreachId, status, `payment hold ${hold.state}`)
      return
    }

    // The start and its prepare job commit together, so a started send
    // always has a prepare on the way.
    await this.client.$transaction(async (tx) => {
      const claim = await tx.outreach.updateMany({
        where: { id: outreachId, status },
        data: { status: OutreachStatus.in_progress },
      })
      if (claim.count === 0) return
      await this.jobs.send(
        'emailSendPrepare',
        { outreachEmailId },
        { group: String(outreachEmailId), tx },
      )
    })
  }

  // A prepare job that dead-lettered would leave the send started but never
  // sending, so it is sent again. One that still hasn't
  // prepared hours after its send time is broken (a template that won't
  // render, a tenant SES refuses), so it fails and its hold is released.
  async retryStalledPrepares(): Promise<void> {
    const stalled = await this.model.findMany({
      where: {
        preparedAt: null,
        stoppingAt: null,
        outreach: {
          status: OutreachStatus.in_progress,
          updatedAt: { lt: subMinutes(new Date(), PREPARE_RETRY_MINUTES) },
        },
      },
      select: {
        id: true,
        outreachId: true,
        outreach: { select: { date: true } },
      },
    })
    const giveUpBefore = subHours(new Date(), PREPARE_GIVE_UP_HOURS)
    for (const row of stalled) {
      if (row.outreach.date && isBefore(row.outreach.date, giveUpBefore)) {
        this.logger.error(
          { outreachEmailId: row.id, outreachId: row.outreachId },
          'CRITICAL email send never prepared; failing it',
        )
        await this.fail(
          row.outreachId,
          OutreachStatus.in_progress,
          'the send could not be prepared',
        )
        try {
          await this.holds.release({ outreachId: row.outreachId })
        } catch (err) {
          this.logger.error(
            { err, outreachId: row.outreachId },
            'Releasing a failed email send hold failed',
          )
        }
        continue
      }
      this.logger.warn(
        { outreachEmailId: row.id },
        'Email send never prepared; sending its prepare again',
      )
      try {
        await this.client.$transaction(async (tx) => {
          await tx.outreach.update({
            where: { id: row.outreachId },
            data: { updatedAt: new Date() },
          })
          await this.jobs.send(
            'emailSendPrepare',
            { outreachEmailId: row.id },
            { group: String(row.id), tx },
          )
        })
      } catch (err) {
        this.logger.error(
          { err, outreachEmailId: row.id },
          'Sending a stalled email prepare failed',
        )
      }
    }
  }

  private async fail(
    outreachId: number,
    status: OutreachStatus,
    reason: string,
  ): Promise<void> {
    const failed = await this.client.outreach.updateMany({
      where: { id: outreachId, status },
      data: { status: OutreachStatus.failed, error: reason },
    })
    if (failed.count === 1) {
      this.logger.warn({ outreachId, reason }, 'Email send failed to start')
    }
  }

  // A send is finished when nothing is left to send, or when it was asked
  // to stop (a cancel, or the hold module's expiry guard). settle drains and
  // captures; once the hold is settled the send is closed out.
  async settleFinishedSends(): Promise<void> {
    const rows = await this.model.findMany({
      where: {
        outreach: { status: OutreachStatus.in_progress },
        OR: [
          { stoppingAt: { not: null } },
          {
            preparedAt: { not: null },
            recipients: {
              none: {
                status: {
                  in: [
                    OutreachEmailRecipientStatus.queued,
                    OutreachEmailRecipientStatus.sending,
                  ],
                },
              },
            },
          },
        ],
      },
      select: { outreachId: true },
    })
    for (const { outreachId } of rows) {
      try {
        await this.settleOrFinish(outreachId)
      } catch (err) {
        this.logger.error(
          { err, outreachId },
          'Settling an email send failed; the next sweep retries it',
        )
      }
    }
  }

  private async settleOrFinish(outreachId: number): Promise<void> {
    const hold = await this.client.outreachPaymentHold.findUnique({
      where: { outreachId },
      select: { state: true },
    })
    if (!hold) {
      this.logger.error(
        { outreachId },
        'CRITICAL an email send is running with no payment hold',
      )
      return
    }
    let state = hold.state
    if (state === OutreachHoldState.held) {
      await this.holds.settle({ outreachId })
      const after = await this.client.outreachPaymentHold.findUniqueOrThrow({
        where: { outreachId },
        select: { state: true },
      })
      state = after.state
    }
    if (!SETTLED_HOLD_STATES.includes(state)) return
    // SES's numbers lag the last send by a minute or two, and finishing
    // reads them to decide warming.
    const last = await this.client.outreachEmailRecipient.aggregate({
      where: { outreachEmail: { outreachId }, sentAt: { not: null } },
      _max: { sentAt: true },
    })
    const lastSentAt = last._max.sentAt
    if (
      lastSentAt &&
      isAfter(lastSentAt, subMinutes(new Date(), METRICS_SETTLE_MINUTES))
    ) {
      return
    }
    await this.finish(outreachId)
  }

  // Recipients still queued mean the send was canceled. One stopped at its
  // hold's capture deadline after some went out has no queue left (the
  // settlement adapter failed it), so it ends completed with what it sent.
  // A send that sent nothing was never charged, so it ends canceled however
  // it stopped. A clean completed send moves its sender up a warming step
  // when it was big enough for its rates to mean something (the auto-pause
  // minimum) and the sender hasn't stepped up in the last day.
  async finish(outreachId: number): Promise<void> {
    const row = await this.model.findUniqueOrThrow({
      where: { outreachId },
      include: { sender: true, outreach: { select: { status: true } } },
    })
    if (row.outreach.status !== OutreachStatus.in_progress) return

    if (row.sesTemplateName && row.sender.sesTenantName) {
      try {
        await this.ses.deleteTemplate(
          row.sender.sesTenantName,
          row.sesTemplateName,
        )
      } catch (err) {
        this.logger.warn(
          { err, outreachEmailId: row.id },
          'Deleting a finished send SES template failed',
        )
      }
    }

    const queuedLeft = await this.client.outreachEmailRecipient.count({
      where: {
        outreachEmailId: row.id,
        status: OutreachEmailRecipientStatus.queued,
      },
    })
    const finalStatus =
      queuedLeft > 0 || row.sentCount === 0
        ? OutreachStatus.canceled
        : OutreachStatus.completed
    const advance =
      finalStatus === OutreachStatus.completed &&
      row.sentCount >= AUTO_PAUSE_MIN_SENDS &&
      (await this.wasClean(row.id))

    await this.client.$transaction(async (tx) => {
      const closed = await tx.outreach.updateMany({
        where: { id: outreachId, status: OutreachStatus.in_progress },
        data: { status: finalStatus },
      })
      if (closed.count === 0 || !advance) return
      const now = new Date()
      await tx.outreachEmailSender.updateMany({
        where: {
          id: row.senderId,
          warmingStep: row.sender.warmingStep,
          OR: [
            { warmingAdvancedAt: null },
            {
              warmingAdvancedAt: {
                lte: subHours(now, WARMING_ADVANCE_MIN_HOURS),
              },
            },
          ],
        },
        data: {
          warmingStep: nextWarmingStep(row.sender.warmingStep),
          warmingAdvancedAt: now,
        },
      })
    })
  }

  // Unknown counts as not clean: a sender only moves up on numbers read.
  private async wasClean(outreachEmailId: number): Promise<boolean> {
    const first = await this.client.outreachEmailRecipient.aggregate({
      where: { outreachEmailId, sentAt: { not: null } },
      _min: { sentAt: true },
    })
    if (!first._min.sentAt) return false
    try {
      const metrics = await this.ses.getSendMetrics(
        outreachEmailId,
        subMinutes(first._min.sentAt, 1),
        new Date(),
      )
      if (metrics.send === 0) return false
      return (
        metrics.bounce / metrics.send < WARMING_ADVANCE_MAX_BOUNCE_RATE &&
        metrics.complaint / metrics.send < WARMING_ADVANCE_MAX_COMPLAINT_RATE
      )
    } catch (err) {
      this.logger.warn(
        { err, outreachEmailId },
        'Reading SES metrics for warming failed; the sender stays put',
      )
      return false
    }
  }
}
