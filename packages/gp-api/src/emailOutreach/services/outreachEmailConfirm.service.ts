import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common'
import { addMinutes, isBefore } from 'date-fns'
import {
  EmailConfirmDeclined,
  EmailConfirmResponse,
  EmailSend,
} from '@goodparty_org/contracts'
import { AnalyticsService } from '@/analytics/analytics.service'
import { SaveCardAndPlanResult } from '@/paymentHolds/paymentHolds.types'
import { PaymentHoldsService } from '@/paymentHolds/services/paymentHolds.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { EVENTS } from '@/vendors/segment/segment.types'
import { OutreachHoldState, OutreachStatus, User } from '../../generated/prisma'
import { EmailSendScope } from '../emailOutreach.types'
import { emailPriceCents, recipientCapFor } from '../util/emailPricing.util'
import { OutreachEmailService } from './outreachEmail.service'

// A send with no time, or one that came due while the user was paying, goes
// out shortly after confirm. The hold module refuses a send time already
// past.
const SEND_NOW_LEAD_MINUTES = 2

type ConfirmInput = {
  scope: EmailSendScope
  outreachId: number
  user: User
  mode: 'win' | 'serve'
  isPro: boolean
  paymentMethodId: string
}

@Injectable()
export class OutreachEmailConfirmService extends createPrismaBase(
  MODELS.OutreachEmail,
) {
  constructor(
    private readonly emails: OutreachEmailService,
    private readonly holds: PaymentHoldsService,
    private readonly analytics: AnalyticsService,
  ) {
    super()
  }

  // A draft is frozen into pending_payment, then handed to the hold module.
  // A decline puts it back to draft and answers 402, so nothing is scheduled
  // on a card that failed. Confirming that draft again tries the new card on
  // its existing hold row, at the price this confirm froze. A pending_payment
  // send (a placement still resolving) can be confirmed again: the hold module
  // returns its stored outcome, and once that is held or scheduled the send
  // moves to pending.
  async confirm({
    scope,
    outreachId,
    user,
    mode,
    isPro,
    paymentMethodId,
  }: ConfirmInput): Promise<EmailConfirmResponse> {
    const row = await this.emails.findDraftOrThrow(scope, outreachId)
    const status = row.outreach.status
    if (status === OutreachStatus.draft) {
      if (mode === 'win' && !isPro) {
        throw new ForbiddenException('Email sends require Pro.')
      }
      if (!row.consentConfirmedAt) {
        throw new BadRequestException(
          'Confirm these contacts agreed to get email from you',
        )
      }
      if (row._count.recipients === 0) {
        throw new BadRequestException('Add at least one recipient')
      }
      await this.freeze(row.id, outreachId, row.senderId, row.outreach.date)
    } else if (status !== OutreachStatus.pending_payment) {
      throw new ConflictException('This email is already confirmed')
    }

    const frozen = await this.model.findUniqueOrThrow({
      where: { id: row.id },
      select: { recipientCap: true },
    })
    if (frozen.recipientCap === null) {
      throw new ConflictException('This email has no recipient limit')
    }
    const priceCents = emailPriceCents(frozen.recipientCap)

    const declinedBefore =
      status === OutreachStatus.draft &&
      (await this.client.outreachPaymentHold.count({ where: { outreachId } })) >
        0
    const card = {
      outreachId,
      userId: user.id,
      paymentMethodId,
      estimateCents: priceCents,
    }
    let plan: SaveCardAndPlanResult
    try {
      plan = declinedBefore
        ? await this.holds.updateCard(card)
        : await this.holds.saveCardAndPlan(card)
    } catch (err) {
      await this.returnToDraft(row.id, outreachId, row.outreach.date)
      throw err
    }

    if (plan.outcome === 'declined') {
      await this.returnToDraft(row.id, outreachId, row.outreach.date)
      const body: EmailConfirmDeclined = {
        message: 'Your card was declined.',
        declineCode: plan.declineCode,
      }
      throw new HttpException(body, HttpStatus.PAYMENT_REQUIRED)
    }

    const promoted = await this.client.outreach.updateMany({
      where: { id: outreachId, status: OutreachStatus.pending_payment },
      data: { status: OutreachStatus.pending },
    })
    if (promoted.count === 1) {
      await this.trackSendCompleted(user.id, {
        mode,
        layout: row.layout,
        theme: row.theme,
        recipientCount: row._count.recipients,
        recipientCap: frozen.recipientCap,
        priceCents,
      })
    }
    return {
      outcome: plan.outcome,
      email: await this.emails.get(scope, outreachId),
    }
  }

  // Not started: the send is canceled and its hold released. Started: the
  // send is marked stopping, and the settle sweep drains it, captures what
  // sent, and finishes it as canceled.
  async cancel(scope: EmailSendScope, outreachId: number): Promise<EmailSend> {
    const row = await this.emails.findDraftOrThrow(scope, outreachId)
    const status = row.outreach.status
    if (
      status === OutreachStatus.pending ||
      status === OutreachStatus.pending_payment
    ) {
      const canceled = await this.client.outreach.updateMany({
        where: {
          id: outreachId,
          status: {
            in: [OutreachStatus.pending, OutreachStatus.pending_payment],
          },
        },
        data: { status: OutreachStatus.canceled },
      })
      if (canceled.count === 0) {
        throw new ConflictException('This email just started; try again')
      }
      try {
        await this.holds.release({ outreachId })
      } catch (err) {
        // The send can no longer start, so a hold left behind is settled for
        // nothing by the hold module's expiry guard.
        this.logger.error(
          { err, outreachId },
          'Releasing a canceled email send hold failed',
        )
      }
      return this.emails.get(scope, outreachId)
    }
    if (status === OutreachStatus.in_progress) {
      await this.model.updateMany({
        where: { id: row.id, stoppingAt: null },
        data: { stoppingAt: new Date() },
      })
      return this.emails.get(scope, outreachId)
    }
    throw new ConflictException('This email can no longer be canceled')
  }

  private async freeze(
    outreachEmailId: number,
    outreachId: number,
    senderId: number,
    date: Date | null,
  ): Promise<void> {
    const earliest = addMinutes(new Date(), SEND_NOW_LEAD_MINUTES)
    const sendAt = date && !isBefore(date, earliest) ? date : earliest
    await this.client.$transaction(async (tx) => {
      // Serializes confirms for one sender, so two can't both reserve the
      // same warming room.
      await tx.$queryRaw`
        SELECT id FROM outreach_email_sender WHERE id = ${senderId} FOR UPDATE
      `
      const sender = await tx.outreachEmailSender.findUniqueOrThrow({
        where: { id: senderId },
        select: { warmingStep: true },
      })
      const recipientCount = await tx.outreachEmailRecipient.count({
        where: { outreachEmailId },
      })
      const recipientCap = recipientCapFor({
        warmingStep: sender.warmingStep,
        reservedByOtherSends: await this.emails.reservedBySender(
          senderId,
          outreachEmailId,
          tx,
        ),
        recipientCount,
      })
      if (recipientCap === 0) {
        throw new ConflictException(
          'Your other scheduled emails use your current sending limit',
        )
      }
      // Claiming the row also serializes with a recipient upload.
      const claim = await tx.outreach.updateMany({
        where: { id: outreachId, status: OutreachStatus.draft },
        data: { status: OutreachStatus.pending_payment, date: sendAt },
      })
      if (claim.count === 0) {
        throw new ConflictException('This email changed; try again')
      }
      await tx.outreachEmail.update({
        where: { id: outreachEmailId },
        data: { recipientCap },
      })
    })
  }

  // The hold module placed nothing: it refused before writing a hold (a bad
  // card, a past send time), or the card was declined. The send goes back to
  // the draft it was, with its own date and no cap reserved, so the user can
  // edit it or confirm again. A hold row that is being placed or was placed
  // keeps the send where it is; checking the row's state in the same update
  // means a confirm racing this one can't be undone under its hold.
  private async returnToDraft(
    outreachEmailId: number,
    outreachId: number,
    date: Date | null,
  ): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const reverted = await tx.outreach.updateMany({
        where: {
          id: outreachId,
          status: OutreachStatus.pending_payment,
          OR: [
            { paymentHold: null },
            { paymentHold: { state: OutreachHoldState.hold_failed } },
          ],
        },
        data: { status: OutreachStatus.draft, date },
      })
      if (reverted.count === 1) {
        await tx.outreachEmail.update({
          where: { id: outreachEmailId },
          data: { recipientCap: null },
        })
      }
    })
  }

  private async trackSendCompleted(
    userId: number,
    properties: {
      mode: 'win' | 'serve'
      layout: string
      theme: string
      recipientCount: number
      recipientCap: number
      priceCents: number
    },
  ): Promise<void> {
    try {
      await this.analytics.track(userId, EVENTS.Email.SendCompleted, {
        ...properties,
        capped: properties.recipientCap < properties.recipientCount,
      })
    } catch (err) {
      this.logger.error({ err }, 'email send analytics failed')
    }
  }
}
