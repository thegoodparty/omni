import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { isAfter, subMinutes } from 'date-fns'
import { PaymentHoldsService } from '@/paymentHolds/services/paymentHolds.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { QueueProducerService } from '@/queue/producer/queueProducer.service'
import { MessageGroup, QueueType } from '@/queue/queue.types'
import { VENDOR_CRONS_ENABLED } from '@/shared/util/appEnvironment.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import {
  OutreachEmailRecipientStatus,
  OutreachHoldState,
  OutreachStatus,
  OutreachType,
} from '../../generated/prisma'
import {
  PREPARE_RETRY_MINUTES,
  WARMING_ADVANCE_MAX_BOUNCE_RATE,
  WARMING_ADVANCE_MAX_COMPLAINT_RATE,
} from '../emailOutreach.const'
import { nextWarmingStep } from '../util/emailPricing.util'
import { SesService } from './ses.service'

const DUE_JOB = 'emailDueSweep'
const SETTLE_JOB = 'emailSettleSweep'

const STARTABLE_STATUSES: OutreachStatus[] = [
  OutreachStatus.pending,
  OutreachStatus.pending_payment,
]

// Hold states that end a send before it starts: a decline nobody fixed, or a
// hold released or spent elsewhere.
const UNSTARTABLE_HOLD_STATES: OutreachHoldState[] = [
  OutreachHoldState.hold_failed,
  OutreachHoldState.released,
  OutreachHoldState.captured,
  OutreachHoldState.uncollectable,
  OutreachHoldState.disputed,
]

const METRICS_SETTLE_MINUTES = 5

const SETTLED_HOLD_STATES: OutreachHoldState[] = [
  OutreachHoldState.captured,
  OutreachHoldState.released,
  OutreachHoldState.uncollectable,
]

// Starting and finishing sends. Each step is a per-row compare-and-set on
// Outreach.status or the hold module's own claim, so a second replica's pass
// changes nothing and no CronLockService is needed. Gated on
// VENDOR_CRONS_ENABLED because starting a send leads to real email and
// finishing one captures real money.
@Injectable()
export class OutreachEmailLifecycleService extends createPrismaBase(
  MODELS.OutreachEmail,
) {
  constructor(
    private readonly holds: PaymentHoldsService,
    private readonly queueProducer: QueueProducerService,
    private readonly ses: SesService,
  ) {
    super()
  }

  @Cron('30 * * * * *', { name: DUE_JOB, timeZone: EASTERN_TIMEZONE })
  async sweepDue(): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return
    await this.startDueSends()
    await this.retryStalledPrepares()
  }

  @Cron('45 * * * * *', { name: SETTLE_JOB, timeZone: EASTERN_TIMEZONE })
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
  // hold Stripe no longer shows as capturable.
  private async startIfHeld(
    outreachId: number,
    status: OutreachStatus,
    outreachEmailId: number,
  ): Promise<void> {
    const hold = await this.holds.getHold(outreachId)
    if (!hold) {
      await this.fail(outreachId, status, 'no payment hold')
      return
    }
    if (UNSTARTABLE_HOLD_STATES.includes(hold.state)) {
      if (hold.state === OutreachHoldState.hold_failed) {
        await this.holds.release({ outreachId })
      }
      await this.fail(outreachId, status, `payment hold ${hold.state}`)
      return
    }
    if (hold.state !== OutreachHoldState.held) return

    const claim = await this.client.outreach.updateMany({
      where: { id: outreachId, status },
      data: { status: OutreachStatus.in_progress },
    })
    if (claim.count === 0) return
    try {
      await this.enqueuePrepare(outreachEmailId)
    } catch (err) {
      await this.client.outreach.updateMany({
        where: { id: outreachId, status: OutreachStatus.in_progress },
        data: { status },
      })
      throw err
    }
  }

  // A prepare message lost or aged to the DLQ would leave the send started
  // but never sending.
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
      select: { id: true, outreachId: true },
    })
    for (const row of stalled) {
      this.logger.warn(
        { outreachEmailId: row.id },
        'Email send never prepared; enqueueing it again',
      )
      await this.client.outreach.update({
        where: { id: row.outreachId },
        data: { updatedAt: new Date() },
      })
      try {
        await this.enqueuePrepare(row.id)
      } catch (err) {
        this.logger.error({ err, outreachEmailId: row.id }, 'Enqueue failed')
      }
    }
  }

  private async enqueuePrepare(outreachEmailId: number): Promise<void> {
    await this.queueProducer.sendMessage(
      { type: QueueType.EMAIL_SEND_PREPARE, data: { outreachEmailId } },
      `${MessageGroup.emailSendPrepare}-${outreachEmailId}`,
      {
        throwOnError: true,
        deduplicationId: `${QueueType.EMAIL_SEND_PREPARE}-${outreachEmailId}`,
      },
    )
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
            pausedAt: null,
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

  // Recipients still queued mean the send was stopped early, so it ends
  // canceled. A clean completed send moves its sender up a warming step.
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
      queuedLeft > 0 ? OutreachStatus.canceled : OutreachStatus.completed
    const advance =
      finalStatus === OutreachStatus.completed &&
      row.sentCount > 0 &&
      (await this.wasClean(row.id))

    await this.client.$transaction(async (tx) => {
      const closed = await tx.outreach.updateMany({
        where: { id: outreachId, status: OutreachStatus.in_progress },
        data: { status: finalStatus },
      })
      if (closed.count === 0 || !advance) return
      await tx.outreachEmailSender.updateMany({
        where: { id: row.senderId, warmingStep: row.sender.warmingStep },
        data: { warmingStep: nextWarmingStep(row.sender.warmingStep) },
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
