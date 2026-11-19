import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  Type,
} from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { addDays, addHours, isAfter, subMinutes } from 'date-fns'
import Stripe from 'stripe'
import {
  OutreachHoldState,
  OutreachPaymentHold,
  OutreachStatus,
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
  HOLD_CLAIM_STALE_MINUTES,
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
import { PaymentHoldEventsService } from './paymentHoldEvents.service'

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
    private readonly events: PaymentHoldEventsService,
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

  async createCardSetupIntent({
    userId,
  }: {
    userId: number
  }): Promise<CardSetupIntent> {
    const user = await this.users.findUser({ id: userId })
    if (!user) {
      throw new NotFoundException('User not found')
    }
    const customerId = await this.stripe.ensureCustomer(user)
    return this.stripe.createSetupIntent(customerId)
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
    {
      offSession,
      notifyDecline = offSession,
    }: { offSession: boolean; notifyDecline?: boolean },
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
        return this.recordDecline(outreachId, err.declineCode, notifyDecline)
      }
      throw err
    }

    return this.commitPlacedHold(outreachId, sendAt, row.estimateCents, held)
  }

  // The placement sweep's claim. It places off-session: no one is there to
  // see a decline, which goes to hold_failed for the card-update email.
  async placeScheduledHold(
    outreachId: number,
  ): Promise<SaveCardAndPlanResult | null> {
    const claim = await this.model.updateMany({
      where: { outreachId, state: OutreachHoldState.scheduled },
      data: { state: OutreachHoldState.placing, claimedAt: new Date() },
    })
    return claim.count === 1
      ? this.placeHold(outreachId, { offSession: true })
      : null
  }

  // A placement that never resolved. Recovery reads what the attempt left at
  // Stripe instead of replaying its key: the replay would have to repeat the
  // attempt's offSession, which isn't stored, and claimedAt is refreshed on
  // each retry, so it can't tell when Stripe's 24-hour key window has passed.
  async recoverStalePlacement(outreachId: number): Promise<void> {
    const row = await this.model.findUnique({
      where: { outreachId },
      include: { outreach: { select: { date: true } } },
    })
    if (
      row?.state !== OutreachHoldState.placing ||
      !(await this.reclaimStale(row))
    ) {
      return
    }

    const intents = await this.stripe.findOutreachHolds({
      customerId: row.stripeCustomerId,
      outreachId,
      holdAttempt: row.holdAttempt,
    })
    const [live, ...extra] = intents.filter(
      (intent) => intent.status === 'requires_capture',
    )
    for (const intent of extra) {
      await this.voidHold(intent.paymentIntentId, outreachId, 'lost_commit')
    }
    if (live) {
      this.logger.warn(
        { outreachId, paymentIntentId: live.paymentIntentId },
        'Adopting a payment hold a stalled placement left at Stripe',
      )
      if (row.outreach.date) {
        await this.commitPlacedHold(
          outreachId,
          row.outreach.date,
          row.estimateCents,
          live,
        )
        return
      }
      const current = await this.findUnique({ where: { outreachId } })
      if (current?.paymentIntentId === live.paymentIntentId) return
      await this.voidHold(live.paymentIntentId, outreachId, 'lost_commit')
      await this.returnStalePlacement(outreachId)
      return
    }
    const declined = intents.find(
      (intent) =>
        intent.status === 'requires_payment_method' ||
        intent.status === 'requires_action',
    )
    if (declined) {
      await this.recordDecline(
        outreachId,
        declined.declineCode ?? declined.status,
        true,
      )
      return
    }
    await this.returnStalePlacement(outreachId)
  }

  // A capture that never resolved: the channel may have stopped, and the
  // capture may have landed with its commit lost.
  async recoverStaleCapture(outreachId: number): Promise<void> {
    const row = await this.findUnique({ where: { outreachId } })
    if (
      row?.state !== OutreachHoldState.capturing ||
      !(await this.reclaimStale(row))
    ) {
      return
    }
    if (!row.paymentIntentId) {
      this.logger.error({ outreachId }, 'Capturing payment hold has no intent')
      return
    }

    let intent: Stripe.PaymentIntent
    try {
      intent = await this.stripe.retrievePaymentIntent(row.paymentIntentId)
    } catch (err) {
      this.logger.error({ err, outreachId }, 'Failed to read payment hold')
      throw new BadGatewayException('Failed to read payment hold')
    }
    switch (intent.status) {
      case 'requires_capture':
        return this.completeSettle(outreachId)
      case 'succeeded': {
        const committed = await this.model.updateMany({
          where: { outreachId, state: OutreachHoldState.capturing },
          data: {
            state: OutreachHoldState.captured,
            capturedCents: intent.amount_received,
            claimedAt: null,
          },
        })
        if (committed.count === 1) {
          await this.events.emit('receipt', outreachId)
        }
        return
      }
      case 'canceled':
        // Our own void of a $0 settle that stopped before its commit.
        if (intent.cancellation_reason !== 'automatic') {
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
        this.logger.error(
          { outreachId, paymentIntentId: row.paymentIntentId },
          'CRITICAL payment hold lapsed before capture; marked uncollectable',
        )
        await this.model.updateMany({
          where: { outreachId, state: OutreachHoldState.capturing },
          data: { state: OutreachHoldState.uncollectable, claimedAt: null },
        })
        return
      default:
        this.logger.error(
          { outreachId, stripeStatus: intent.status },
          'Capturing payment hold is in an unexpected Stripe state',
        )
    }
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

    return this.completeSettle(outreachId)
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

  // estimateCents replaces the stored estimate, for a channel confirming
  // again after a decline at confirm: the send's price may have changed since.
  // Safe on these rows because their holdAttempt has never reached Stripe.
  async updateCard({
    outreachId,
    userId,
    paymentMethodId,
    estimateCents,
    offSession = false,
    notifyDecline,
  }: {
    outreachId: number
    userId: number
    paymentMethodId: string
    estimateCents?: number
    offSession?: boolean
    notifyDecline?: boolean
  }): Promise<SaveCardAndPlanResult> {
    if (
      estimateCents !== undefined &&
      (!Number.isInteger(estimateCents) || estimateCents <= 0)
    ) {
      throw new BadRequestException('The estimate must be a positive amount')
    }
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
        ...(estimateCents !== undefined ? { estimateCents } : {}),
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
      ? this.placeHold(outreachId, { offSession, notifyDecline })
      : { outcome: 'scheduled' }
  }

  // payment_method.attached: a card landed on the customer, so a declined
  // hold whose send is still ahead is retried on it. Goes through updateCard,
  // which owns the claim. Nobody is present to complete 3-D Secure in a
  // webhook, so the placement is off-session, like the sweep's. A draft's
  // hold is skipped: its send isn't confirmed, and the card the user is
  // adding goes through the channel's own confirm.
  async retryHoldFailedForAttachedCard(
    customerId: string,
    paymentMethodId: string,
  ): Promise<void> {
    const rows = await this.model.findMany({
      where: {
        state: OutreachHoldState.hold_failed,
        stripeCustomerId: customerId,
        outreach: {
          date: { gt: new Date() },
          status: { not: OutreachStatus.draft },
        },
      },
      select: { outreachId: true },
    })
    if (rows.length === 0) return
    const user = await this.users.findByCustomerId(customerId)
    if (!user) return
    for (const { outreachId } of rows) {
      try {
        await this.updateCard({
          outreachId,
          userId: user.id,
          paymentMethodId,
          offSession: true,
          notifyDecline: false,
        })
      } catch (err) {
        this.logger.warn(
          { err, outreachId, customerId },
          'Could not retry the declined payment hold on the attached card',
        )
      }
    }
  }

  // payment_method.detached: a scheduled hold's card is gone. Stripe refuses
  // to place a hold on it without creating an intent, which the placement
  // path would retry until the send. Failing the hold now is what sends the
  // user the decline email. The row's attempt was never sent to Stripe, so
  // it keeps its holdAttempt, and a new card retries under the same key.
  async flagScheduledHoldsForDetachedCard(
    paymentMethodId: string,
  ): Promise<void> {
    const rows = await this.model.findMany({
      where: { state: OutreachHoldState.scheduled, paymentMethodId },
      select: { outreachId: true },
    })
    let failed = 0
    for (const { outreachId } of rows) {
      const moved = await this.model.updateMany({
        where: {
          outreachId,
          state: OutreachHoldState.scheduled,
          paymentMethodId,
        },
        data: {
          state: OutreachHoldState.hold_failed,
          declineCode: 'payment_method_detached',
        },
      })
      if (moved.count === 1) {
        failed += 1
        await this.events.emit('hold_failed', outreachId)
      }
    }
    if (failed > 0) {
      this.logger.warn(
        { paymentMethodId, count: failed },
        'The card on scheduled payment holds was removed; holds marked failed',
      )
    }
  }

  // charge.dispute.created. A dispute needs a charge, so only a captured hold
  // moves. A capturing row will be captured within the recovery window, so the
  // webhook is asked to redeliver rather than losing the dispute.
  async markDisputedByIntent(paymentIntentId: string): Promise<void> {
    const moved = await this.model.updateMany({
      where: { paymentIntentId, state: OutreachHoldState.captured },
      data: { state: OutreachHoldState.disputed },
    })
    if (moved.count > 0) return
    const row = await this.model.findFirst({ where: { paymentIntentId } })
    if (!row || row.state === OutreachHoldState.disputed) return
    if (row.state === OutreachHoldState.capturing) {
      throw new ServiceUnavailableException(
        'The payment hold is still being captured',
      )
    }
    this.logger.error(
      { outreachId: row.outreachId, paymentIntentId, state: row.state },
      'A dispute arrived for a payment hold that was not captured',
    )
  }

  // The send time came and no hold was ever placed: the user's card never
  // went through. The row is released so the channel finds nothing to send
  // against, and the user is told. Returns whether this call released it.
  // Never a draft's hold: that send was never scheduled.
  async releaseUnpaid(outreachId: number): Promise<boolean> {
    const released = await this.model.updateMany({
      where: {
        outreachId,
        state: {
          in: [OutreachHoldState.scheduled, OutreachHoldState.hold_failed],
        },
        outreach: {
          date: { lte: new Date() },
          status: { not: OutreachStatus.draft },
        },
      },
      data: { state: OutreachHoldState.released, claimedAt: null },
    })
    if (released.count === 0) return false
    await this.events.emit('canceled', outreachId)
    return true
  }

  private async commitPlacedHold(
    outreachId: number,
    sendAt: Date,
    estimateCents: number,
    held: { paymentIntentId: string; captureBefore: Date },
  ): Promise<SaveCardAndPlanResult> {
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
        authorizedCents: estimateCents,
        captureBefore: held.captureBefore,
        declineCode: null,
        claimedAt: null,
      },
    })
    if (commit.count === 1) {
      return { outcome: 'held', captureBefore: held.captureBefore }
    }

    // A stalled placer and recovery can both hold this same intent; whichever
    // committed it first owns it, and the other must not void it. The owner
    // may since have released it.
    const current = await this.findUnique({ where: { outreachId } })
    if (current?.paymentIntentId === held.paymentIntentId) {
      if (current.state === OutreachHoldState.released) {
        throw new ConflictException('This send was canceled')
      }
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

  // The half of settle that runs under the capturing claim. Recovery re-enters
  // here for a capture that stalled.
  private async completeSettle(outreachId: number): Promise<void> {
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
    if (commit.count === 1) {
      await this.events.emit('receipt', outreachId)
      return
    }
    if (commit.count === 0) {
      const current = await this.findUnique({ where: { outreachId } })
      if (current?.state === OutreachHoldState.captured) return
      this.logger.error(
        { outreachId, paymentIntentId, amountCents },
        'CRITICAL payment captured at Stripe but the hold row was not ' +
          'capturing; the charge may be unrecorded',
      )
    }
  }

  // Takes over a placing or capturing claim older than the stale window. The
  // compare-and-set on the old claimedAt elects one recoverer.
  private async reclaimStale(row: OutreachPaymentHold): Promise<boolean> {
    if (
      !row.claimedAt ||
      isAfter(row.claimedAt, subMinutes(new Date(), HOLD_CLAIM_STALE_MINUTES))
    ) {
      return false
    }
    const reclaim = await this.model.updateMany({
      where: {
        outreachId: row.outreachId,
        state: row.state,
        claimedAt: row.claimedAt,
      },
      data: { claimedAt: new Date() },
    })
    return reclaim.count === 1
  }

  // Stripe shows no intent under this attempt, so a fresh attempt can't stack
  // a second hold. Bumping also avoids replaying a key whose saved response
  // can't be reproduced.
  private async returnStalePlacement(outreachId: number): Promise<void> {
    const rescheduled = await this.model.updateMany({
      where: {
        outreachId,
        state: OutreachHoldState.placing,
        releaseRequested: false,
      },
      data: {
        state: OutreachHoldState.scheduled,
        holdAttempt: { increment: 1 },
        claimedAt: null,
      },
    })
    if (rescheduled.count === 0) {
      await this.model.updateMany({
        where: { outreachId, state: OutreachHoldState.placing },
        data: {
          state: OutreachHoldState.released,
          holdAttempt: { increment: 1 },
          claimedAt: null,
        },
      })
    }
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

  // A decline at confirm or on a card change is shown to the user who is
  // present, so only an off-session one emails. The attach webhook also
  // stays quiet: it races the user's own card save, and the daily reminder
  // covers a decline it finds.
  private async recordDecline(
    outreachId: number,
    declineCode: string | null,
    notify: boolean,
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
    if (failed.count === 1 && notify) {
      await this.events.emit('hold_failed', outreachId)
    }
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
