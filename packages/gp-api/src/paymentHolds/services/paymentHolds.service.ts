import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  NotImplementedException,
  Type,
} from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { addDays, addHours, isAfter } from 'date-fns'
import Stripe from 'stripe'
import {
  OutreachHoldState,
  OutreachPaymentHold,
  OutreachType,
} from '@/generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { isUniqueConstraintError } from 'src/prisma/util/prismaErrors.util'
import { UsersService } from 'src/users/services/users.service'
import {
  StripeOutreachHoldDeclinedError,
  StripeService,
} from 'src/vendors/stripe/services/stripe.service'
import {
  HOLD_PLACEMENT_LEAD_DAYS,
  HOLD_SETTLE_MARGIN_HOURS,
  OrphanedHoldReason,
} from '../paymentHolds.constants'
import {
  CardSetupIntent,
  HoldView,
  PaymentHoldsApi,
  SaveCardAndPlanInput,
  SaveCardAndPlanResult,
  SettlementAdapter,
} from '../paymentHolds.types'
import { OutreachOrphanedHoldService } from './outreachOrphanedHold.service'

// Bounds release's re-read loop: each pass loses a compare-and-set only to a
// transition that moves the row forward, so a few passes always settle it.
const RELEASE_ATTEMPTS = 3

const requireSendDate = (date: Date | null): Date => {
  if (!date) {
    throw new BadRequestException('This send has no scheduled time')
  }
  return date
}

const isWithinPlacementWindow = (sendAt: Date): boolean =>
  !isAfter(sendAt, addDays(new Date(), HOLD_PLACEMENT_LEAD_DAYS))

const fitsCaptureWindow = (sendAt: Date, captureBefore: Date): boolean =>
  !isAfter(addHours(sendAt, HOLD_SETTLE_MARGIN_HOURS), captureBefore)

// Invariant the idempotency key rests on: a scheduled or hold_failed row's
// holdAttempt has never been sent to Stripe. Creation starts at 0, and every
// decline or void bumps it on the way back out. A Stripe failure that might
// have placed the hold never leaves placing, so its key is replayed, not
// abandoned with a live hold behind it.
@Injectable()
export class PaymentHoldsService
  extends createPrismaBase(MODELS.OutreachPaymentHold)
  implements PaymentHoldsApi
{
  private readonly settlementAdapters = new Map<
    OutreachType,
    Type<SettlementAdapter>
  >()

  constructor(
    private readonly stripe: StripeService,
    private readonly users: UsersService,
    private readonly orphanedHolds: OutreachOrphanedHoldService,
    private readonly moduleRef: ModuleRef,
  ) {
    super()
  }

  // A channel registers its adapter class from its module's constructor. It
  // is resolved through ModuleRef at settle time because the channel module
  // imports this one, and injecting the adapter here would close that cycle.
  registerSettlementAdapter(
    channel: OutreachType,
    adapter: Type<SettlementAdapter>,
  ): void {
    this.settlementAdapters.set(channel, adapter)
  }

  async createCardSetupIntent(): Promise<CardSetupIntent> {
    throw new NotImplementedException('Card setup is not built yet')
  }

  async saveCardAndPlan({
    outreachId,
    userId,
    paymentMethodId,
    estimateCents,
  }: SaveCardAndPlanInput): Promise<SaveCardAndPlanResult> {
    if (!Number.isInteger(estimateCents) || estimateCents <= 0) {
      throw new BadRequestException('The estimate must be a positive amount')
    }
    const existing = await this.findUnique({ where: { outreachId } })
    if (existing) {
      return this.planOutcome(existing)
    }

    const outreach = await this.client.outreach.findUnique({
      where: { id: outreachId },
      select: { date: true, outreachType: true },
    })
    if (!outreach) {
      throw new NotFoundException('Send not found')
    }
    const sendAt = requireSendDate(outreach.date)
    if (!isAfter(sendAt, new Date())) {
      throw new BadRequestException('The send time has already passed')
    }
    const customerId = await this.resolveCustomerForCard(
      userId,
      paymentMethodId,
    )

    const placeNow = isWithinPlacementWindow(sendAt)
    try {
      await this.model.create({
        data: {
          outreachId,
          channel: outreach.outreachType,
          state: placeNow
            ? OutreachHoldState.placing
            : OutreachHoldState.scheduled,
          stripeCustomerId: customerId,
          paymentMethodId,
          estimateCents,
          claimedAt: placeNow ? new Date() : null,
        },
      })
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err
      return this.planOutcome(
        await this.model.findUniqueOrThrow({ where: { outreachId } }),
      )
    }

    return placeNow
      ? this.placeHold(outreachId, { offSession: false })
      : { outcome: 'scheduled' }
  }

  // Places the hold for a row the caller has already claimed into placing.
  // Only the claim winner may call it. A Stripe failure leaves the claim and
  // holdAttempt in place, so calling it again replays the same idempotency
  // key. Stripe returns the first result only if the replay sends the same
  // offSession and comes within its 24-hour key window; past that, recovery
  // has to find the intent by its metadata instead.
  async placeHold(
    outreachId: number,
    { offSession }: { offSession: boolean },
  ): Promise<SaveCardAndPlanResult> {
    const row = await this.model.findUnique({
      where: { outreachId },
      include: { outreach: { select: { date: true } } },
    })
    if (!row || row.state !== OutreachHoldState.placing) {
      throw new ConflictException('This payment hold is not being placed')
    }
    if (!row.outreach.date) {
      const unclaimed = await this.model.updateMany({
        where: {
          outreachId,
          state: OutreachHoldState.placing,
          releaseRequested: false,
        },
        data: { state: OutreachHoldState.scheduled, claimedAt: null },
      })
      if (unclaimed.count === 0) {
        await this.model.updateMany({
          where: { outreachId, state: OutreachHoldState.placing },
          data: { state: OutreachHoldState.released, claimedAt: null },
        })
      }
      throw new BadRequestException('This send has no scheduled time')
    }
    const sendAt = row.outreach.date

    let held: { paymentIntentId: string; captureBefore: Date }
    try {
      held = await this.stripe.createOutreachManualCaptureHold({
        customerId: row.stripeCustomerId,
        paymentMethodId: row.paymentMethodId,
        amountInCents: row.estimateCents,
        outreachId,
        holdAttempt: row.holdAttempt,
        offSession,
        metadata: {
          outreachId: String(outreachId),
          holdAttempt: String(row.holdAttempt),
          channel: row.channel,
        },
      })
    } catch (err) {
      if (err instanceof StripeOutreachHoldDeclinedError) {
        return this.recordDecline(outreachId, err.declineCode)
      }
      throw err
    }

    if (!fitsCaptureWindow(sendAt, held.captureBefore)) {
      this.logger.error(
        { outreachId, sendAt, captureBefore: held.captureBefore },
        'Payment hold lapses before the send can settle; voiding it',
      )
      await this.voidHold(held.paymentIntentId, outreachId, 'window_fit')
      await this.model.updateMany({
        where: { outreachId, state: OutreachHoldState.placing },
        data: {
          state: OutreachHoldState.released,
          holdAttempt: { increment: 1 },
          claimedAt: null,
        },
      })
      throw new ConflictException(
        'The card hold would expire before this send can be charged',
      )
    }

    const commit = await this.model.updateMany({
      where: {
        outreachId,
        state: OutreachHoldState.placing,
        releaseRequested: false,
      },
      data: {
        state: OutreachHoldState.held,
        paymentIntentId: held.paymentIntentId,
        authorizedCents: row.estimateCents,
        captureBefore: held.captureBefore,
        declineCode: null,
        claimedAt: null,
      },
    })
    if (commit.count === 1) {
      return { outcome: 'held', captureBefore: held.captureBefore }
    }

    // A release arrived while Stripe was placing, or the send was deleted.
    // The hold must not stand.
    await this.voidHold(held.paymentIntentId, outreachId, 'lost_commit')
    await this.model.updateMany({
      where: { outreachId, state: OutreachHoldState.placing },
      data: {
        state: OutreachHoldState.released,
        holdAttempt: { increment: 1 },
        claimedAt: null,
      },
    })
    throw new ConflictException('This send was canceled')
  }

  async getHold(outreachId: number): Promise<HoldView | null> {
    const row = await this.findUnique({ where: { outreachId } })
    if (!row) {
      return null
    }
    if (row.state === OutreachHoldState.held) {
      if (!row.paymentIntentId) {
        throw new InternalServerErrorException('Held payment has no intent')
      }
      let intent: Stripe.PaymentIntent
      try {
        intent = await this.stripe.retrievePaymentIntent(row.paymentIntentId)
      } catch (err) {
        this.logger.error({ err, outreachId }, 'Failed to read payment hold')
        throw new BadGatewayException('Failed to read payment hold')
      }
      if (intent.status !== 'requires_capture') {
        this.logger.error(
          {
            outreachId,
            paymentIntentId: row.paymentIntentId,
            stripeStatus: intent.status,
          },
          'Payment hold is held here but no longer capturable at Stripe',
        )
        throw new ConflictException('The payment hold is no longer active')
      }
    }
    return {
      state: row.state,
      authorizedCents: row.authorizedCents,
      captureBefore: row.captureBefore,
    }
  }

  // Placement and the expiry guard read Outreach.date when they run, so only
  // a placed hold has anything to re-check: one the new time no longer fits is
  // voided and goes back to scheduled under a fresh attempt.
  async reschedule({ outreachId }: { outreachId: number }): Promise<void> {
    const row = await this.model.findUnique({
      where: { outreachId },
      include: { outreach: { select: { date: true } } },
    })
    if (!row) {
      return
    }
    switch (row.state) {
      case OutreachHoldState.scheduled:
      case OutreachHoldState.hold_failed:
        return
      case OutreachHoldState.held:
        break
      default:
        throw new ConflictException(
          `The payment hold can't be moved while it is ${row.state}`,
        )
    }

    const sendAt = requireSendDate(row.outreach.date)
    if (
      row.captureBefore &&
      row.paymentIntentId &&
      fitsCaptureWindow(sendAt, row.captureBefore)
    ) {
      return
    }

    const claim = await this.model.updateMany({
      where: { outreachId, state: OutreachHoldState.held },
      data: { state: OutreachHoldState.releasing, claimedAt: new Date() },
    })
    if (claim.count === 0) {
      throw new ConflictException('The payment hold changed; try again')
    }
    if (row.paymentIntentId) {
      await this.voidHold(row.paymentIntentId, outreachId)
    }
    const rescheduled = await this.model.updateMany({
      where: {
        outreachId,
        state: OutreachHoldState.releasing,
        releaseRequested: false,
      },
      data: {
        state: OutreachHoldState.scheduled,
        paymentIntentId: null,
        authorizedCents: null,
        captureBefore: null,
        holdAttempt: { increment: 1 },
        claimedAt: null,
      },
    })
    if (rescheduled.count === 0) {
      // A cancel arrived while the hold was being voided.
      await this.model.updateMany({
        where: { outreachId, state: OutreachHoldState.releasing },
        data: {
          state: OutreachHoldState.released,
          holdAttempt: { increment: 1 },
          claimedAt: null,
        },
      })
    }
  }

  async settle({ outreachId }: { outreachId: number }): Promise<void> {
    const claim = await this.model.updateMany({
      where: { outreachId, state: OutreachHoldState.held },
      data: { state: OutreachHoldState.capturing, claimedAt: new Date() },
    })
    if (claim.count === 0) {
      const current = await this.findUnique({ where: { outreachId } })
      if (!current) {
        throw new NotFoundException('No payment hold for this send')
      }
      if (
        current.state === OutreachHoldState.capturing ||
        current.state === OutreachHoldState.captured
      ) {
        return
      }
      throw new ConflictException(
        `There is no payment hold to settle (${current.state})`,
      )
    }

    const row = await this.model.findUniqueOrThrow({ where: { outreachId } })
    const { paymentIntentId, authorizedCents } = row
    const adapterType = this.settlementAdapters.get(row.channel)
    if (!paymentIntentId || authorizedCents == null || !adapterType) {
      await this.revertCapturingToHeld(outreachId)
      throw new InternalServerErrorException(
        `Can't settle the ${row.channel} payment hold for this send`,
      )
    }

    // A throw here leaves the row in capturing for the recovery sweep.
    const report = await this.moduleRef
      .get(adapterType, { strict: false })
      .stopAndReport(outreachId)
    if (!report.ready) {
      await this.revertCapturingToHeld(outreachId)
      return
    }
    if (!Number.isInteger(report.amountCents) || report.amountCents < 0) {
      throw new InternalServerErrorException(
        `The ${row.channel} channel reported an invalid amount`,
      )
    }

    const amountCents = Math.min(report.amountCents, authorizedCents)
    if (amountCents === 0) {
      await this.voidHold(paymentIntentId, outreachId)
      await this.model.updateMany({
        where: { outreachId, state: OutreachHoldState.capturing },
        data: {
          state: OutreachHoldState.released,
          capturedCents: 0,
          holdAttempt: { increment: 1 },
          claimedAt: null,
        },
      })
      return
    }

    // Keyed on the intent, so a replay after a lost response returns the
    // first capture. That holds only while stopAndReport reports the same
    // amount once drained, which the adapter contract requires.
    let captured: Stripe.PaymentIntent
    try {
      captured = await this.stripe.capturePaymentIntent(
        paymentIntentId,
        amountCents,
        `outreach-capture-${paymentIntentId}`,
      )
    } catch (err) {
      this.logger.error(
        { err, outreachId, paymentIntentId, amountCents },
        'Payment capture failed; left in capturing for recovery',
      )
      throw new BadGatewayException('Failed to capture payment')
    }
    if (captured.status !== 'succeeded') {
      this.logger.error(
        { outreachId, paymentIntentId, stripeStatus: captured.status },
        'Payment capture did not succeed; left in capturing for recovery',
      )
      throw new BadGatewayException('Payment capture did not succeed')
    }

    const commit = await this.model.updateMany({
      where: { outreachId, state: OutreachHoldState.capturing },
      data: {
        state: OutreachHoldState.captured,
        capturedCents: captured.amount_received,
        claimedAt: null,
      },
    })
    if (commit.count === 0) {
      this.logger.error(
        { outreachId, paymentIntentId, amountCents },
        'CRITICAL payment captured at Stripe but the hold row was not ' +
          'capturing; the charge may be unrecorded',
      )
    }
  }

  async release({ outreachId }: { outreachId: number }): Promise<void> {
    for (let attempt = 0; attempt < RELEASE_ATTEMPTS; attempt++) {
      const row = await this.findUnique({ where: { outreachId } })
      if (!row) {
        return
      }
      switch (row.state) {
        case OutreachHoldState.released:
          return
        case OutreachHoldState.releasing: {
          // A reschedule voiding the hold would otherwise put it back to
          // scheduled; the flag makes it finish as released.
          const flagged = await this.model.updateMany({
            where: { outreachId, state: OutreachHoldState.releasing },
            data: { releaseRequested: true },
          })
          if (flagged.count === 1) return
          break
        }
        case OutreachHoldState.scheduled:
        case OutreachHoldState.hold_failed: {
          const released = await this.model.updateMany({
            where: { outreachId, state: row.state },
            data: { state: OutreachHoldState.released, claimedAt: null },
          })
          if (released.count === 1) return
          break
        }
        case OutreachHoldState.placing: {
          // The placer voids instead of committing held.
          const flagged = await this.model.updateMany({
            where: { outreachId, state: OutreachHoldState.placing },
            data: { releaseRequested: true },
          })
          if (flagged.count === 1) return
          break
        }
        case OutreachHoldState.held: {
          const claim = await this.model.updateMany({
            where: { outreachId, state: OutreachHoldState.held },
            data: {
              state: OutreachHoldState.releasing,
              claimedAt: new Date(),
            },
          })
          if (claim.count === 0) break
          if (row.paymentIntentId) {
            await this.voidHold(row.paymentIntentId, outreachId)
          }
          await this.model.updateMany({
            where: { outreachId, state: OutreachHoldState.releasing },
            data: {
              state: OutreachHoldState.released,
              holdAttempt: { increment: 1 },
              claimedAt: null,
            },
          })
          return
        }
        default:
          throw new ConflictException(
            `This send's payment is already ${row.state}`,
          )
      }
    }
    throw new ConflictException('The payment hold kept changing; try again')
  }

  async updateCard({
    outreachId,
    userId,
    paymentMethodId,
  }: {
    outreachId: number
    userId: number
    paymentMethodId: string
  }): Promise<SaveCardAndPlanResult> {
    const row = await this.model.findUnique({
      where: { outreachId },
      include: { outreach: { select: { date: true } } },
    })
    if (!row) {
      throw new NotFoundException('No payment hold for this send')
    }
    if (
      row.state !== OutreachHoldState.scheduled &&
      row.state !== OutreachHoldState.hold_failed
    ) {
      return this.planOutcome(row)
    }
    const sendAt = requireSendDate(row.outreach.date)
    if (!isAfter(sendAt, new Date())) {
      throw new BadRequestException('The send time has already passed')
    }
    const customerId = await this.resolveCustomerForCard(
      userId,
      paymentMethodId,
    )

    const placeNow = isWithinPlacementWindow(sendAt)
    const claim = await this.model.updateMany({
      where: { outreachId, state: row.state },
      data: {
        paymentMethodId,
        stripeCustomerId: customerId,
        declineCode: null,
        ...(placeNow
          ? { state: OutreachHoldState.placing, claimedAt: new Date() }
          : { state: OutreachHoldState.scheduled }),
      },
    })
    if (claim.count === 0) {
      return this.planOutcome(
        await this.model.findUniqueOrThrow({ where: { outreachId } }),
      )
    }
    return placeNow
      ? this.placeHold(outreachId, { offSession: false })
      : { outcome: 'scheduled' }
  }

  private planOutcome(row: OutreachPaymentHold): SaveCardAndPlanResult {
    switch (row.state) {
      case OutreachHoldState.held:
        if (!row.captureBefore) {
          throw new InternalServerErrorException('Held payment has no window')
        }
        return { outcome: 'held', captureBefore: row.captureBefore }
      case OutreachHoldState.scheduled:
        return { outcome: 'scheduled' }
      case OutreachHoldState.hold_failed:
        return { outcome: 'declined', declineCode: row.declineCode }
      case OutreachHoldState.placing:
        throw new ConflictException('The payment hold is still being placed')
      default:
        throw new ConflictException(`This send's payment is ${row.state}`)
    }
  }

  private async resolveCustomerForCard(
    userId: number,
    paymentMethodId: string,
  ): Promise<string> {
    const user = await this.users.findUser({ id: userId })
    if (!user) {
      throw new NotFoundException('User not found')
    }
    const customerId = await this.stripe.ensureCustomer(user)
    const paymentMethod =
      await this.stripe.retrievePaymentMethod(paymentMethodId)
    if (paymentMethod.customer !== customerId) {
      throw new BadRequestException('That card is not on file for this account')
    }
    if (paymentMethod.type !== 'card') {
      throw new BadRequestException('Only a card can pay for this send')
    }
    return customerId
  }

  private async recordDecline(
    outreachId: number,
    declineCode: string | null,
  ): Promise<SaveCardAndPlanResult> {
    const failed = await this.model.updateMany({
      where: {
        outreachId,
        state: OutreachHoldState.placing,
        releaseRequested: false,
      },
      data: {
        state: OutreachHoldState.hold_failed,
        holdAttempt: { increment: 1 },
        declineCode,
        claimedAt: null,
      },
    })
    if (failed.count === 0) {
      await this.model.updateMany({
        where: { outreachId, state: OutreachHoldState.placing },
        data: {
          state: OutreachHoldState.released,
          holdAttempt: { increment: 1 },
          declineCode,
          claimedAt: null,
        },
      })
    }
    return { outcome: 'declined', declineCode }
  }

  private async revertCapturingToHeld(outreachId: number): Promise<void> {
    await this.model.updateMany({
      where: { outreachId, state: OutreachHoldState.capturing },
      data: { state: OutreachHoldState.held, claimedAt: null },
    })
  }

  // An anomaly void (window fit, lost commit) is always recorded; a normal
  // release is recorded only if Stripe refused the cancel. Recording is
  // best-effort: a held card is not a charge, and the hold lapses on its own.
  private async voidHold(
    paymentIntentId: string,
    outreachId: number,
    anomaly?: Extract<OrphanedHoldReason, 'window_fit' | 'lost_commit'>,
  ): Promise<void> {
    let voided = true
    try {
      await this.stripe.cancelHold(paymentIntentId)
    } catch (err) {
      voided = false
      this.logger.error(
        { err, outreachId, paymentIntentId },
        'Failed to void payment hold',
      )
    }
    const reason = anomaly ?? (voided ? null : 'release_failed')
    if (!reason) return
    try {
      await this.orphanedHolds.record(paymentIntentId, outreachId, reason)
    } catch (err) {
      this.logger.error(
        { err, outreachId, paymentIntentId },
        'Failed to record orphaned payment hold for reconcile',
      )
    }
  }
}
