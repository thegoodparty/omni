import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { addDays, addHours } from 'date-fns'
import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, MockInstance, vi } from 'vitest'
import { useTestService } from '@/test-service'
import {
  OutreachHoldState,
  OutreachPaymentHold,
  OutreachStatus,
  OutreachType,
} from '@/generated/prisma'
import {
  StripeOutreachHoldDeclinedError,
  StripeService,
} from '@/vendors/stripe/services/stripe.service'
import { SettlementAdapter } from '../paymentHolds.types'
import { PaymentHoldsService } from './paymentHolds.service'

const service = useTestService()

const CUSTOMER_ID = 'cus_holds'
const CARD_ID = 'pm_card'
const INTENT_ID = 'pi_hold'
const ORG_SLUG = 'eo-payment-holds'

class TestSettlementAdapter implements SettlementAdapter {
  stopAndReport = vi.fn<SettlementAdapter['stopAndReport']>()
}

let holds: PaymentHoldsService
let adapter: TestSettlementAdapter
let placeSpy: MockInstance<StripeService['createOutreachManualCaptureHold']>
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

beforeEach(async () => {
  holds = service.app.get(PaymentHoldsService)
  const stripe = service.app.get(StripeService)
  vi.spyOn(stripe, 'ensureCustomer').mockResolvedValue(CUSTOMER_ID)
  vi.spyOn(stripe, 'retrievePaymentMethod').mockImplementation(
    async (id: string) =>
      ({ id, customer: CUSTOMER_ID, type: 'card' }) as Stripe.PaymentMethod,
  )
  placeSpy = vi
    .spyOn(stripe, 'createOutreachManualCaptureHold')
    .mockResolvedValue({
      paymentIntentId: INTENT_ID,
      captureBefore: addDays(new Date(), 7),
    })
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

const createSend = async (date: Date | null): Promise<number> => {
  const outreach = await service.prisma.outreach.create({
    data: {
      organizationSlug: ORG_SLUG,
      outreachType: OutreachType.email,
      status: OutreachStatus.pending_payment,
      date,
    },
  })
  return outreach.id
}

const createHold = async (
  state: OutreachHoldState,
  {
    date = addDays(new Date(), 2),
    ...overrides
  }: Partial<OutreachPaymentHold> & { date?: Date | null } = {},
): Promise<number> => {
  const outreachId = await createSend(date)
  const held =
    state === OutreachHoldState.held || state === OutreachHoldState.capturing
  await service.prisma.outreachPaymentHold.create({
    data: {
      outreachId,
      channel: OutreachType.email,
      state,
      stripeCustomerId: CUSTOMER_ID,
      paymentMethodId: CARD_ID,
      estimateCents: 5000,
      ...(held
        ? {
            paymentIntentId: INTENT_ID,
            authorizedCents: 5000,
            captureBefore: addDays(new Date(), 4),
          }
        : {}),
      ...overrides,
    },
  })
  return outreachId
}

const readHold = (outreachId: number) =>
  service.prisma.outreachPaymentHold.findUniqueOrThrow({
    where: { outreachId },
  })

const orphans = () => service.prisma.outreachOrphanedHold.findMany()

const plan = (outreachId: number) =>
  holds.saveCardAndPlan({
    outreachId,
    userId: service.user.id,
    paymentMethodId: CARD_ID,
    estimateCents: 5000,
  })

describe('saveCardAndPlan', () => {
  it('schedules a send more than 3 days out without touching Stripe', async () => {
    const outreachId = await createSend(addDays(new Date(), 10))

    await expect(plan(outreachId)).resolves.toEqual({ outcome: 'scheduled' })

    expect(placeSpy).not.toHaveBeenCalled()
    const row = await readHold(outreachId)
    expect(row).toMatchObject({
      state: OutreachHoldState.scheduled,
      stripeCustomerId: CUSTOMER_ID,
      paymentMethodId: CARD_ID,
      estimateCents: 5000,
      holdAttempt: 0,
      paymentIntentId: null,
    })
  })

  it('places an on-session hold now when the send is within 3 days', async () => {
    const outreachId = await createSend(addDays(new Date(), 2))
    const captureBefore = addDays(new Date(), 7)
    placeSpy.mockResolvedValue({ paymentIntentId: INTENT_ID, captureBefore })

    await expect(plan(outreachId)).resolves.toEqual({
      outcome: 'held',
      captureBefore,
    })

    expect(placeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: CUSTOMER_ID,
        paymentMethodId: CARD_ID,
        amountInCents: 5000,
        outreachId,
        holdAttempt: 0,
        offSession: false,
      }),
    )
    expect(await readHold(outreachId)).toMatchObject({
      state: OutreachHoldState.held,
      paymentIntentId: INTENT_ID,
      authorizedCents: 5000,
      captureBefore,
      claimedAt: null,
    })
  })

  it('creates the row in placing before Stripe is called', async () => {
    const outreachId = await createSend(addDays(new Date(), 1))
    let stateDuringPlacement: OutreachHoldState | undefined
    placeSpy.mockImplementation(async () => {
      stateDuringPlacement = (await readHold(outreachId)).state
      return {
        paymentIntentId: INTENT_ID,
        captureBefore: addDays(new Date(), 7),
      }
    })

    await plan(outreachId)

    expect(stateDuringPlacement).toBe(OutreachHoldState.placing)
  })

  it('returns a decline and records hold_failed under a bumped attempt', async () => {
    const outreachId = await createSend(addDays(new Date(), 2))
    placeSpy.mockRejectedValue(
      new StripeOutreachHoldDeclinedError('declined', 'insufficient_funds'),
    )

    await expect(plan(outreachId)).resolves.toEqual({
      outcome: 'declined',
      declineCode: 'insufficient_funds',
    })
    expect(await readHold(outreachId)).toMatchObject({
      state: OutreachHoldState.hold_failed,
      holdAttempt: 1,
      declineCode: 'insufficient_funds',
      paymentIntentId: null,
    })
  })

  it('returns the stored outcome on a repeat call without placing again', async () => {
    const outreachId = await createSend(addDays(new Date(), 2))
    await plan(outreachId)

    await expect(plan(outreachId)).resolves.toMatchObject({ outcome: 'held' })
    expect(placeSpy).toHaveBeenCalledTimes(1)
  })

  it('refuses a card that is not on the user’s customer', async () => {
    const outreachId = await createSend(addDays(new Date(), 2))
    vi.spyOn(
      service.app.get(StripeService),
      'retrievePaymentMethod',
    ).mockResolvedValue({
      id: CARD_ID,
      customer: 'cus_someone_else',
      type: 'card',
    } as Stripe.PaymentMethod)

    await expect(plan(outreachId)).rejects.toBeInstanceOf(BadRequestException)
    expect(
      await service.prisma.outreachPaymentHold.count({ where: { outreachId } }),
    ).toBe(0)
  })

  it('refuses a send whose time has passed', async () => {
    const outreachId = await createSend(addHours(new Date(), -1))

    await expect(plan(outreachId)).rejects.toBeInstanceOf(BadRequestException)
  })
})

describe('placement safety', () => {
  it('keeps the claim and attempt after a timeout, so a retry replays the same key', async () => {
    const outreachId = await createSend(addDays(new Date(), 2))
    placeSpy.mockRejectedValueOnce(new BadGatewayException('timeout'))

    await expect(plan(outreachId)).rejects.toBeInstanceOf(BadGatewayException)
    expect(await readHold(outreachId)).toMatchObject({
      state: OutreachHoldState.placing,
      holdAttempt: 0,
    })

    await expect(
      holds.placeHold(outreachId, { offSession: false }),
    ).resolves.toMatchObject({ outcome: 'held' })
    const attempts = placeSpy.mock.calls.map(([args]) => args.holdAttempt)
    expect(attempts).toEqual([0, 0])
    expect((await readHold(outreachId)).state).toBe(OutreachHoldState.held)
  })

  it('voids instead of committing when a release arrives mid-placement', async () => {
    const outreachId = await createSend(addDays(new Date(), 2))
    placeSpy.mockImplementation(async () => {
      await holds.release({ outreachId })
      return {
        paymentIntentId: INTENT_ID,
        captureBefore: addDays(new Date(), 7),
      }
    })

    await expect(plan(outreachId)).rejects.toBeInstanceOf(ConflictException)

    expect(cancelSpy).toHaveBeenCalledWith(INTENT_ID)
    expect(await readHold(outreachId)).toMatchObject({
      state: OutreachHoldState.released,
      holdAttempt: 1,
      paymentIntentId: null,
    })
    expect(await orphans()).toEqual([
      expect.objectContaining({
        paymentIntentId: INTENT_ID,
        outreachId,
        reason: 'lost_commit',
      }),
    ])
  })

  it('voids, records and fails a hold that lapses before the send settles', async () => {
    const outreachId = await createSend(addDays(new Date(), 2))
    placeSpy.mockResolvedValue({
      paymentIntentId: INTENT_ID,
      captureBefore: addDays(new Date(), 2),
    })

    await expect(plan(outreachId)).rejects.toBeInstanceOf(ConflictException)

    expect(cancelSpy).toHaveBeenCalledWith(INTENT_ID)
    expect(await readHold(outreachId)).toMatchObject({
      state: OutreachHoldState.released,
      holdAttempt: 1,
    })
    expect(await orphans()).toEqual([
      expect.objectContaining({ reason: 'window_fit' }),
    ])
  })
})

describe('getHold', () => {
  it('returns null when nothing is planned', async () => {
    const outreachId = await createSend(addDays(new Date(), 2))

    await expect(holds.getHold(outreachId)).resolves.toBeNull()
  })

  it('confirms a held hold is still requires_capture at Stripe', async () => {
    const outreachId = await createHold(OutreachHoldState.held)

    await expect(holds.getHold(outreachId)).resolves.toMatchObject({
      state: OutreachHoldState.held,
      authorizedCents: 5000,
    })
    expect(retrieveIntentSpy).toHaveBeenCalledWith(INTENT_ID)
  })

  it('refuses a held hold Stripe no longer has capturable', async () => {
    const outreachId = await createHold(OutreachHoldState.held)
    retrieveIntentSpy.mockResolvedValue(intent({ status: 'canceled' }))

    await expect(holds.getHold(outreachId)).rejects.toBeInstanceOf(
      ConflictException,
    )
  })
})

describe('reschedule', () => {
  it('leaves a held hold that still fits the new time', async () => {
    const outreachId = await createHold(OutreachHoldState.held)

    await holds.reschedule({ outreachId })

    expect(cancelSpy).not.toHaveBeenCalled()
    expect((await readHold(outreachId)).state).toBe(OutreachHoldState.held)
  })

  it('voids a held hold the new time no longer fits and reschedules it', async () => {
    const outreachId = await createHold(OutreachHoldState.held, {
      date: addDays(new Date(), 10),
    })

    await holds.reschedule({ outreachId })

    expect(cancelSpy).toHaveBeenCalledWith(INTENT_ID)
    expect(await readHold(outreachId)).toMatchObject({
      state: OutreachHoldState.scheduled,
      holdAttempt: 1,
      paymentIntentId: null,
      authorizedCents: null,
      captureBefore: null,
    })
  })

  it('finishes as released when a cancel arrives during the void', async () => {
    const outreachId = await createHold(OutreachHoldState.held, {
      date: addDays(new Date(), 10),
    })
    cancelSpy.mockImplementation(async () => {
      await holds.release({ outreachId })
    })

    await holds.reschedule({ outreachId })

    expect(await readHold(outreachId)).toMatchObject({
      state: OutreachHoldState.released,
      releaseRequested: true,
    })
  })

  it('refuses while a capture is in flight', async () => {
    const outreachId = await createHold(OutreachHoldState.capturing)

    await expect(holds.reschedule({ outreachId })).rejects.toBeInstanceOf(
      ConflictException,
    )
  })
})

describe('release', () => {
  it('releases a scheduled hold without calling Stripe', async () => {
    const outreachId = await createHold(OutreachHoldState.scheduled)

    await holds.release({ outreachId })

    expect(cancelSpy).not.toHaveBeenCalled()
    expect((await readHold(outreachId)).state).toBe(OutreachHoldState.released)
  })

  it('voids a held hold', async () => {
    const outreachId = await createHold(OutreachHoldState.held)

    await holds.release({ outreachId })
    await holds.release({ outreachId })

    expect(cancelSpy).toHaveBeenCalledTimes(1)
    expect((await readHold(outreachId)).state).toBe(OutreachHoldState.released)
    expect(await orphans()).toEqual([])
  })

  it('records a void Stripe refused for the reconcile sweep', async () => {
    const outreachId = await createHold(OutreachHoldState.held)
    cancelSpy.mockRejectedValue(new BadGatewayException('stripe down'))

    await holds.release({ outreachId })

    expect((await readHold(outreachId)).state).toBe(OutreachHoldState.released)
    expect(await orphans()).toEqual([
      expect.objectContaining({ reason: 'release_failed', voidedAt: null }),
    ])
  })

  it('keeps a cancel when placement finds the send has no time', async () => {
    const outreachId = await createHold(OutreachHoldState.placing, {
      date: null,
    })
    await holds.release({ outreachId })

    await expect(
      holds.placeHold(outreachId, { offSession: false }),
    ).rejects.toBeInstanceOf(BadRequestException)

    expect(placeSpy).not.toHaveBeenCalled()
    expect((await readHold(outreachId)).state).toBe(OutreachHoldState.released)
  })

  it('flags a placing hold for the placer instead of moving it', async () => {
    const outreachId = await createHold(OutreachHoldState.placing)

    await holds.release({ outreachId })

    expect(await readHold(outreachId)).toMatchObject({
      state: OutreachHoldState.placing,
      releaseRequested: true,
    })
  })

  it('refuses to release a captured hold', async () => {
    const outreachId = await createHold(OutreachHoldState.captured)

    await expect(holds.release({ outreachId })).rejects.toBeInstanceOf(
      ConflictException,
    )
  })
})

describe('updateCard', () => {
  const update = (outreachId: number, paymentMethodId = 'pm_new') =>
    holds.updateCard({ outreachId, userId: service.user.id, paymentMethodId })

  it('retries a declined hold on the new card under the bumped attempt', async () => {
    const outreachId = await createHold(OutreachHoldState.hold_failed, {
      holdAttempt: 1,
      declineCode: 'card_declined',
    })

    await expect(update(outreachId)).resolves.toMatchObject({
      outcome: 'held',
    })
    expect(placeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ paymentMethodId: 'pm_new', holdAttempt: 1 }),
    )
    expect(await readHold(outreachId)).toMatchObject({
      state: OutreachHoldState.held,
      paymentMethodId: 'pm_new',
      declineCode: null,
    })
  })

  it('saves the card for later when the send is more than 3 days out', async () => {
    const outreachId = await createHold(OutreachHoldState.hold_failed, {
      date: addDays(new Date(), 10),
      holdAttempt: 1,
    })

    await expect(update(outreachId)).resolves.toEqual({ outcome: 'scheduled' })
    expect(placeSpy).not.toHaveBeenCalled()
    expect(await readHold(outreachId)).toMatchObject({
      state: OutreachHoldState.scheduled,
      paymentMethodId: 'pm_new',
    })
  })

  it('refuses while a placement is in flight', async () => {
    const outreachId = await createHold(OutreachHoldState.placing)

    await expect(update(outreachId)).rejects.toBeInstanceOf(ConflictException)
    expect((await readHold(outreachId)).paymentMethodId).toBe(CARD_ID)
  })

  it('refuses a released hold', async () => {
    const outreachId = await createHold(OutreachHoldState.released)

    await expect(update(outreachId)).rejects.toBeInstanceOf(ConflictException)
  })
})

describe('settle', () => {
  it('captures what the channel reports and records it', async () => {
    const outreachId = await createHold(OutreachHoldState.held)
    adapter.stopAndReport.mockResolvedValue({ ready: true, amountCents: 3200 })

    await holds.settle({ outreachId })

    expect(adapter.stopAndReport).toHaveBeenCalledWith(outreachId)
    expect(captureSpy).toHaveBeenCalledWith(
      INTENT_ID,
      3200,
      `outreach-capture-${INTENT_ID}`,
    )
    expect(await readHold(outreachId)).toMatchObject({
      state: OutreachHoldState.captured,
      capturedCents: 3200,
      claimedAt: null,
    })
  })

  it('never captures more than was authorized', async () => {
    const outreachId = await createHold(OutreachHoldState.held)
    adapter.stopAndReport.mockResolvedValue({ ready: true, amountCents: 9000 })

    await holds.settle({ outreachId })

    expect(captureSpy).toHaveBeenCalledWith(INTENT_ID, 5000, expect.any(String))
  })

  it('goes back to held when the channel is still draining', async () => {
    const outreachId = await createHold(OutreachHoldState.held)
    adapter.stopAndReport.mockResolvedValue({ ready: false })

    await holds.settle({ outreachId })

    expect(captureSpy).not.toHaveBeenCalled()
    expect(await readHold(outreachId)).toMatchObject({
      state: OutreachHoldState.held,
      claimedAt: null,
    })
  })

  it('releases the hold when nothing is owed', async () => {
    const outreachId = await createHold(OutreachHoldState.held)
    adapter.stopAndReport.mockResolvedValue({ ready: true, amountCents: 0 })

    await holds.settle({ outreachId })

    expect(captureSpy).not.toHaveBeenCalled()
    expect(cancelSpy).toHaveBeenCalledWith(INTENT_ID)
    expect((await readHold(outreachId)).state).toBe(OutreachHoldState.released)
  })

  it('stays in capturing for recovery when the channel throws', async () => {
    const outreachId = await createHold(OutreachHoldState.held)
    adapter.stopAndReport.mockRejectedValue(new Error('drain failed'))

    await expect(holds.settle({ outreachId })).rejects.toThrow('drain failed')
    expect((await readHold(outreachId)).state).toBe(OutreachHoldState.capturing)
  })

  it('stays in capturing for recovery when the capture fails', async () => {
    const outreachId = await createHold(OutreachHoldState.held)
    adapter.stopAndReport.mockResolvedValue({ ready: true, amountCents: 3200 })
    captureSpy.mockRejectedValue(new Error('stripe down'))

    await expect(holds.settle({ outreachId })).rejects.toBeInstanceOf(
      BadGatewayException,
    )
    expect((await readHold(outreachId)).state).toBe(OutreachHoldState.capturing)
  })

  it('captures once when two settles race', async () => {
    const outreachId = await createHold(OutreachHoldState.held)
    adapter.stopAndReport.mockResolvedValue({ ready: true, amountCents: 3200 })

    await Promise.all([
      holds.settle({ outreachId }),
      holds.settle({ outreachId }),
    ])

    expect(adapter.stopAndReport).toHaveBeenCalledTimes(1)
    expect(captureSpy).toHaveBeenCalledTimes(1)
    expect((await readHold(outreachId)).state).toBe(OutreachHoldState.captured)
  })

  it.each([
    OutreachHoldState.scheduled,
    OutreachHoldState.hold_failed,
    OutreachHoldState.released,
  ])('refuses to settle a %s hold', async (state) => {
    const outreachId = await createHold(state)

    await expect(holds.settle({ outreachId })).rejects.toBeInstanceOf(
      ConflictException,
    )
    expect(captureSpy).not.toHaveBeenCalled()
  })
})

describe('createCardSetupIntent', () => {
  it("creates a SetupIntent on the user's Stripe customer", async () => {
    const setupSpy = vi
      .spyOn(service.app.get(StripeService), 'createSetupIntent')
      .mockResolvedValue({ clientSecret: 'seti_secret' })

    await expect(
      holds.createCardSetupIntent({ userId: service.user.id }),
    ).resolves.toEqual({ clientSecret: 'seti_secret' })
    expect(setupSpy).toHaveBeenCalledWith(CUSTOMER_ID)
  })
})
