import { BadGatewayException } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { addDays, addHours, subMinutes } from 'date-fns'
import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, MockInstance, vi } from 'vitest'
import { useTestService } from '@/test-service'
import {
  OutreachHoldState,
  OutreachPaymentHold,
  OutreachStatus,
  OutreachType,
} from '@/generated/prisma'
import { disableVendorCrons } from '@/shared/test-utils/appEnvOverrides'
import {
  StripeOutreachHoldDeclinedError,
  StripeService,
} from '@/vendors/stripe/services/stripe.service'
import { SettlementAdapter } from '../paymentHolds.types'
import { PaymentHoldsService } from './paymentHolds.service'
import { PaymentHoldsSweepService } from './paymentHoldsSweep.service'

const service = useTestService()

const CUSTOMER_ID = 'cus_sweep'
const INTENT_ID = 'pi_sweep'
const ORG_SLUG = 'eo-payment-hold-sweeps'

class TestSettlementAdapter implements SettlementAdapter {
  stopAndReport = vi.fn<SettlementAdapter['stopAndReport']>()
}

let sweeps: PaymentHoldsSweepService
let holds: PaymentHoldsService
let adapter: TestSettlementAdapter
let placeSpy: MockInstance<StripeService['createOutreachManualCaptureHold']>
let findSpy: MockInstance<StripeService['findOutreachHolds']>
let retrieveIntentSpy: MockInstance<StripeService['retrievePaymentIntent']>
let captureSpy: MockInstance<StripeService['capturePaymentIntent']>
let cancelSpy: MockInstance<StripeService['cancelHold']>

const intent = (
  overrides: Partial<Stripe.PaymentIntent>,
): Stripe.Response<Stripe.PaymentIntent> =>
  ({
    id: INTENT_ID,
    object: 'payment_intent',
    ...overrides,
  }) as unknown as Stripe.Response<Stripe.PaymentIntent>

const stripeHold = (
  status: Stripe.PaymentIntent.Status,
  overrides: { paymentIntentId?: string; declineCode?: string | null } = {},
) => ({
  paymentIntentId: INTENT_ID,
  status,
  captureBefore: addDays(new Date(), 4),
  declineCode: null,
  ...overrides,
})

beforeEach(async () => {
  sweeps = service.app.get(PaymentHoldsSweepService)
  holds = service.app.get(PaymentHoldsService)
  const stripe = service.app.get(StripeService)
  placeSpy = vi
    .spyOn(stripe, 'createOutreachManualCaptureHold')
    .mockResolvedValue({
      paymentIntentId: INTENT_ID,
      captureBefore: addDays(new Date(), 4),
    })
  findSpy = vi.spyOn(stripe, 'findOutreachHolds').mockResolvedValue([])
  retrieveIntentSpy = vi
    .spyOn(stripe, 'retrievePaymentIntent')
    .mockResolvedValue(intent({ status: 'requires_capture' }))
  captureSpy = vi
    .spyOn(stripe, 'capturePaymentIntent')
    .mockImplementation(async (_id: string, amount: number) =>
      intent({ status: 'succeeded', amount_received: amount }),
    )
  cancelSpy = vi.spyOn(stripe, 'cancelHold').mockResolvedValue(undefined)

  adapter = new TestSettlementAdapter()
  holds.registerSettlementAdapter(OutreachType.email, TestSettlementAdapter)
  const moduleRef = (holds as unknown as { moduleRef: ModuleRef }).moduleRef
  vi.spyOn(moduleRef, 'get').mockReturnValue(adapter)

  await service.prisma.organization.create({
    data: { slug: ORG_SLUG, ownerId: service.user.id, positionId: 'pos-1' },
  })
})

const createHold = async (
  state: OutreachHoldState,
  {
    date = addDays(new Date(), 2),
    ...overrides
  }: Partial<OutreachPaymentHold> & { date?: Date } = {},
): Promise<number> => {
  const outreach = await service.prisma.outreach.create({
    data: {
      organizationSlug: ORG_SLUG,
      outreachType: OutreachType.email,
      status: OutreachStatus.pending,
      date,
    },
  })
  const placed =
    state === OutreachHoldState.held || state === OutreachHoldState.capturing
  await service.prisma.outreachPaymentHold.create({
    data: {
      outreachId: outreach.id,
      channel: OutreachType.email,
      state,
      stripeCustomerId: CUSTOMER_ID,
      paymentMethodId: 'pm_card',
      estimateCents: 5000,
      ...(placed
        ? {
            paymentIntentId: INTENT_ID,
            authorizedCents: 5000,
            captureBefore: addDays(new Date(), 4),
          }
        : {}),
      ...overrides,
    },
  })
  return outreach.id
}

const staleClaim = () => subMinutes(new Date(), 30)

const readHold = (outreachId: number) =>
  service.prisma.outreachPaymentHold.findUniqueOrThrow({
    where: { outreachId },
  })

describe('sweepPlacements', () => {
  it('places scheduled holds within 3 days, off-session, and leaves later ones', async () => {
    const soon = await createHold(OutreachHoldState.scheduled)
    const later = await createHold(OutreachHoldState.scheduled, {
      date: addDays(new Date(), 10),
    })

    await sweeps.sweepPlacements()

    expect(placeSpy).toHaveBeenCalledTimes(1)
    expect(placeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        outreachId: soon,
        holdAttempt: 0,
        offSession: true,
      }),
    )
    expect(await readHold(soon)).toMatchObject({
      state: OutreachHoldState.held,
      paymentIntentId: INTENT_ID,
    })
    expect((await readHold(later)).state).toBe(OutreachHoldState.scheduled)
  })

  it('places once when two replicas sweep the same slot', async () => {
    const outreachId = await createHold(OutreachHoldState.scheduled)

    await Promise.all([sweeps.sweepPlacements(), sweeps.sweepPlacements()])

    expect(placeSpy).toHaveBeenCalledTimes(1)
    expect((await readHold(outreachId)).state).toBe(OutreachHoldState.held)
  })

  it('records a decline as hold_failed under a bumped attempt', async () => {
    const outreachId = await createHold(OutreachHoldState.scheduled)
    placeSpy.mockRejectedValue(
      new StripeOutreachHoldDeclinedError('declined', 'card_declined'),
    )

    await sweeps.sweepPlacements()

    expect(await readHold(outreachId)).toMatchObject({
      state: OutreachHoldState.hold_failed,
      holdAttempt: 1,
      declineCode: 'card_declined',
    })
  })

  it('keeps going past a row Stripe fails on', async () => {
    const first = await createHold(OutreachHoldState.scheduled)
    const second = await createHold(OutreachHoldState.scheduled)
    placeSpy
      .mockRejectedValueOnce(new BadGatewayException('stripe down'))
      .mockResolvedValue({
        paymentIntentId: 'pi_second',
        captureBefore: addDays(new Date(), 4),
      })

    await sweeps.sweepPlacements()

    const states = [
      (await readHold(first)).state,
      (await readHold(second)).state,
    ]
    expect(states).toContain(OutreachHoldState.placing)
    expect(states).toContain(OutreachHoldState.held)
  })

  it('alerts on holds still scheduled after their send time', async () => {
    const overdue = await createHold(OutreachHoldState.scheduled, {
      date: subMinutes(new Date(), 5),
    })
    const errorSpy = vi.spyOn(sweeps.logger, 'error')

    await sweeps.sweepPlacements()

    expect(placeSpy).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(
      { outreachIds: [overdue] },
      expect.stringContaining('past their send time'),
    )
  })

  it('does nothing when vendor crons are off', async () => {
    disableVendorCrons()
    await createHold(OutreachHoldState.scheduled)

    await sweeps.sweepPlacements()

    expect(placeSpy).not.toHaveBeenCalled()
  })
})

describe('sweepStaleClaims: placing', () => {
  it('adopts a live hold a stalled placement left at Stripe', async () => {
    const outreachId = await createHold(OutreachHoldState.placing, {
      claimedAt: staleClaim(),
    })
    findSpy.mockResolvedValue([stripeHold('requires_capture')])

    await sweeps.sweepStaleClaims()

    expect(findSpy).toHaveBeenCalledWith({
      customerId: CUSTOMER_ID,
      outreachId,
      holdAttempt: 0,
    })
    expect(placeSpy).not.toHaveBeenCalled()
    expect(await readHold(outreachId)).toMatchObject({
      state: OutreachHoldState.held,
      paymentIntentId: INTENT_ID,
      holdAttempt: 0,
    })
  })

  it('voids the found hold when a cancel arrived during the placement', async () => {
    const outreachId = await createHold(OutreachHoldState.placing, {
      claimedAt: staleClaim(),
      releaseRequested: true,
    })
    findSpy.mockResolvedValue([stripeHold('requires_capture')])

    await sweeps.sweepStaleClaims()

    expect(cancelSpy).toHaveBeenCalledWith(INTENT_ID)
    expect((await readHold(outreachId)).state).toBe(OutreachHoldState.released)
    expect(await service.prisma.outreachOrphanedHold.findMany()).toEqual([
      expect.objectContaining({ paymentIntentId: INTENT_ID }),
    ])
  })

  it('records a decline the stalled placement got', async () => {
    const outreachId = await createHold(OutreachHoldState.placing, {
      claimedAt: staleClaim(),
    })
    findSpy.mockResolvedValue([
      stripeHold('requires_payment_method', { declineCode: 'expired_card' }),
    ])

    await sweeps.sweepStaleClaims()

    expect(await readHold(outreachId)).toMatchObject({
      state: OutreachHoldState.hold_failed,
      holdAttempt: 1,
      declineCode: 'expired_card',
    })
  })

  it('reschedules under a fresh attempt when Stripe has no intent', async () => {
    const outreachId = await createHold(OutreachHoldState.placing, {
      claimedAt: staleClaim(),
    })

    await sweeps.sweepStaleClaims()

    expect(await readHold(outreachId)).toMatchObject({
      state: OutreachHoldState.scheduled,
      holdAttempt: 1,
      claimedAt: null,
    })
  })

  it('leaves a placement that is still within its claim window', async () => {
    const outreachId = await createHold(OutreachHoldState.placing, {
      claimedAt: new Date(),
    })

    await sweeps.sweepStaleClaims()

    expect(findSpy).not.toHaveBeenCalled()
    expect((await readHold(outreachId)).state).toBe(OutreachHoldState.placing)
  })

  it('keeps the hold when a stalled placer loses its commit to recovery', async () => {
    const outreachId = await createHold(OutreachHoldState.placing, {
      claimedAt: staleClaim(),
    })
    findSpy.mockResolvedValue([stripeHold('requires_capture')])
    placeSpy.mockImplementation(async () => {
      await sweeps.sweepStaleClaims()
      return {
        paymentIntentId: INTENT_ID,
        captureBefore: addDays(new Date(), 4),
      }
    })

    await expect(
      holds.placeHold(outreachId, { offSession: true }),
    ).resolves.toMatchObject({ outcome: 'held' })

    expect(cancelSpy).not.toHaveBeenCalled()
    expect(await readHold(outreachId)).toMatchObject({
      state: OutreachHoldState.held,
      paymentIntentId: INTENT_ID,
    })
    expect(await service.prisma.outreachOrphanedHold.count()).toBe(0)
  })

  it('leaves a row that moved on from placing before recovery reached it', async () => {
    const outreachId = await createHold(OutreachHoldState.capturing, {
      claimedAt: staleClaim(),
    })

    await holds.recoverStalePlacement(outreachId)

    expect(findSpy).not.toHaveBeenCalled()
    expect(cancelSpy).not.toHaveBeenCalled()
    expect((await readHold(outreachId)).state).toBe(OutreachHoldState.capturing)
  })

  it('recovers once when two replicas sweep at the same time', async () => {
    await createHold(OutreachHoldState.placing, { claimedAt: staleClaim() })

    await Promise.all([sweeps.sweepStaleClaims(), sweeps.sweepStaleClaims()])

    expect(findSpy).toHaveBeenCalledTimes(1)
  })
})

describe('sweepStaleClaims: capturing', () => {
  it('records a capture that landed but never committed', async () => {
    const outreachId = await createHold(OutreachHoldState.capturing, {
      claimedAt: staleClaim(),
    })
    retrieveIntentSpy.mockResolvedValue(
      intent({ status: 'succeeded', amount_received: 3100 }),
    )

    await sweeps.sweepStaleClaims()

    expect(adapter.stopAndReport).not.toHaveBeenCalled()
    expect(captureSpy).not.toHaveBeenCalled()
    expect(await readHold(outreachId)).toMatchObject({
      state: OutreachHoldState.captured,
      capturedCents: 3100,
    })
  })

  it('finishes a capture that never reached Stripe', async () => {
    const outreachId = await createHold(OutreachHoldState.capturing, {
      claimedAt: staleClaim(),
    })
    adapter.stopAndReport.mockResolvedValue({ ready: true, amountCents: 2000 })

    await sweeps.sweepStaleClaims()

    expect(captureSpy).toHaveBeenCalledWith(
      INTENT_ID,
      2000,
      `outreach-capture-${INTENT_ID}`,
    )
    expect((await readHold(outreachId)).state).toBe(OutreachHoldState.captured)
  })

  it('marks a hold that lapsed before capture uncollectable', async () => {
    const outreachId = await createHold(OutreachHoldState.capturing, {
      claimedAt: staleClaim(),
    })
    retrieveIntentSpy.mockResolvedValue(
      intent({ status: 'canceled', cancellation_reason: 'automatic' }),
    )

    await sweeps.sweepStaleClaims()

    expect(captureSpy).not.toHaveBeenCalled()
    expect((await readHold(outreachId)).state).toBe(
      OutreachHoldState.uncollectable,
    )
  })

  it('finishes a $0 settle whose own void landed before its commit', async () => {
    const outreachId = await createHold(OutreachHoldState.capturing, {
      claimedAt: staleClaim(),
    })
    retrieveIntentSpy.mockResolvedValue(
      intent({
        status: 'canceled',
        cancellation_reason: 'requested_by_customer',
      }),
    )

    await sweeps.sweepStaleClaims()

    expect(await readHold(outreachId)).toMatchObject({
      state: OutreachHoldState.released,
      capturedCents: 0,
    })
  })
})

describe('settleExpiringHolds', () => {
  it('settles holds within 12 hours of their capture deadline only', async () => {
    const expiring = await createHold(OutreachHoldState.held, {
      captureBefore: addHours(new Date(), 6),
    })
    const healthy = await createHold(OutreachHoldState.held, {
      paymentIntentId: 'pi_healthy',
      captureBefore: addDays(new Date(), 3),
    })
    adapter.stopAndReport.mockResolvedValue({ ready: true, amountCents: 4000 })

    await sweeps.settleExpiringHolds()

    expect(adapter.stopAndReport).toHaveBeenCalledTimes(1)
    expect(adapter.stopAndReport).toHaveBeenCalledWith(expiring)
    expect((await readHold(expiring)).state).toBe(OutreachHoldState.captured)
    expect((await readHold(healthy)).state).toBe(OutreachHoldState.held)
  })
})

describe('reconcileOrphanedHolds', () => {
  const recordOrphan = (paymentIntentId: string) =>
    service.prisma.outreachOrphanedHold.create({
      data: { paymentIntentId, outreachId: 1, reason: 'release_failed' },
    })

  it('re-voids a hold that is still live, and stamps it voided', async () => {
    const orphan = await recordOrphan(INTENT_ID)

    await sweeps.reconcileOrphanedHolds()

    expect(cancelSpy).toHaveBeenCalledWith(INTENT_ID)
    const row = await service.prisma.outreachOrphanedHold.findUniqueOrThrow({
      where: { id: orphan.id },
    })
    expect(row.voidedAt).not.toBeNull()
  })

  it('stamps an already-canceled hold voided without cancelling again', async () => {
    const orphan = await recordOrphan(INTENT_ID)
    retrieveIntentSpy.mockResolvedValue(intent({ status: 'canceled' }))

    await sweeps.reconcileOrphanedHolds()

    expect(cancelSpy).not.toHaveBeenCalled()
    const row = await service.prisma.outreachOrphanedHold.findUniqueOrThrow({
      where: { id: orphan.id },
    })
    expect(row.voidedAt).not.toBeNull()
  })

  it('leaves the row for the next sweep when the cancel fails', async () => {
    const orphan = await recordOrphan(INTENT_ID)
    cancelSpy.mockRejectedValue(new BadGatewayException('stripe down'))

    await sweeps.reconcileOrphanedHolds()

    const row = await service.prisma.outreachOrphanedHold.findUniqueOrThrow({
      where: { id: orphan.id },
    })
    expect(row.voidedAt).toBeNull()
  })
})
