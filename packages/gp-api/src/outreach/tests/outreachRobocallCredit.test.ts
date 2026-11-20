import { randomUUID } from 'node:crypto'
import { addDays, addHours } from 'date-fns'
import Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { FeaturesService } from '@/features/services/features.service'
import { OutreachRobocallService } from '@/outreach/services/outreachRobocall.service'
import { OutreachRobocallCaptureService } from '@/outreach/services/outreachRobocallCapture.service'
import { OutreachRobocallCancelService } from '@/outreach/services/outreachRobocallCancel.service'
import { OutreachRobocallHoldService } from '@/outreach/services/outreachRobocallHold.service'
import { OutreachRobocallDeferredHoldService } from '@/outreach/services/outreachRobocallDeferredHold.service'
import { OutreachNotificationService } from '@/outreach/services/outreachNotification.service'
import { calcRobocallTotalInCents } from '@/shared/util/robocallPricing.util'
import { WIN_PER_CAMPAIGN_PRICING_FLAG } from '@/shared/util/winPerCampaignPricingFlag.util'
import {
  Campaign,
  OutreachStatus,
  RobocallSettleState,
} from '../../generated/prisma'

const service = useTestService()

const paymentIntentsCreate = vi.fn()
const paymentIntentsCancel = vi.fn()
const paymentMethodsRetrieve = vi.fn()

let campaign: Campaign
let orgSlug: string
let filterId: number
let billableCount: number
let featureSpy: ReturnType<typeof vi.spyOn>
let captureSpy: ReturnType<typeof vi.spyOn>
let voidSpy: ReturnType<typeof vi.spyOn>

// 2,000 calls: a $92 estimate, inside the $175 credit.
const SMALL_COUNT = 2000
// 6,000 calls: a $272 estimate, more than the credit covers.
const LARGE_COUNT = 6000

const setBalance = (outreachCreditCents: number) =>
  service.prisma.campaign.update({
    where: { id: campaign.id },
    data: { outreachCreditCents },
  })

const balance = async () =>
  (
    await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
  ).outreachCreditCents

beforeEach(async () => {
  billableCount = SMALL_COUNT
  const stripe = service.app.get(StripeService)
  const stripeClient = (stripe as unknown as { stripe: Stripe }).stripe
  vi.spyOn(stripeClient.paymentIntents, 'create').mockImplementation(
    paymentIntentsCreate,
  )
  vi.spyOn(stripeClient.paymentIntents, 'cancel').mockImplementation(
    paymentIntentsCancel,
  )
  vi.spyOn(stripeClient.paymentMethods, 'retrieve').mockImplementation(
    paymentMethodsRetrieve,
  )
  paymentIntentsCancel.mockResolvedValue({})
  paymentMethodsRetrieve.mockResolvedValue({
    id: 'pm_1',
    customer: 'cus_test',
    type: 'card',
  })
  paymentIntentsCreate.mockImplementation(async (params) => ({
    id: 'pi_credit',
    status: 'requires_capture',
    amount: params.amount,
    amount_capturable: params.amount,
    capture_before: Math.floor(addDays(new Date(), 7).getTime() / 1000),
  }))
  captureSpy = vi
    .spyOn(stripe, 'capturePaymentIntent')
    .mockResolvedValue({ id: 'pi_credit' } as unknown as Stripe.PaymentIntent)
  voidSpy = vi.spyOn(stripe, 'voidHold').mockResolvedValue(undefined)
  vi.spyOn(stripe, 'retrievePaymentIntent').mockResolvedValue({
    id: 'pi_credit',
    status: 'requires_capture',
  } as unknown as Stripe.Response<Stripe.PaymentIntent>)
  featureSpy = vi
    .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
    .mockResolvedValue(true)

  vi.spyOn(
    service.app.get(OutreachRobocallService),
    'deriveBillableCount',
  ).mockImplementation(async () => billableCount)
  vi.spyOn(service.app.get(AnalyticsService), 'track').mockResolvedValue(
    undefined as never,
  )
  vi.spyOn(
    service.app.get(OutreachNotificationService),
    'notifyRobocallScheduled',
  ).mockResolvedValue(undefined)
  vi.spyOn(
    service.app.get(OutreachNotificationService),
    'notifyRobocallCompleted',
  ).mockResolvedValue(undefined as never)

  const campaignId = 994
  orgSlug = `campaign-${campaignId}`
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id, positionId: 'pos-1' },
  })
  campaign = await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'jane-doe',
      isPro: true,
      outreachCreditCents: 17500,
      details: { state: 'TX', city: 'Georgetown', zip: '78634' },
      data: {},
    },
  })
  const filter = await service.prisma.voterFileFilter.create({
    data: { organizationSlug: orgSlug },
  })
  filterId = filter.id
  await service.prisma.user.update({
    where: { id: service.user.id },
    data: { metaData: { customerId: 'cus_test' } },
  })
})

const createDraft = async (sendAt: Date = addDays(new Date(), 2)) => {
  const spine = await service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: orgSlug,
      outreachType: 'robocall',
      status: 'pending_payment',
      date: sendAt,
      voterFileFilterId: filterId,
    },
  })
  await service.prisma.outreachRobocall.create({
    data: {
      outreachId: spine.id,
      audioKey: `robocall/994/${randomUUID()}.webm`,
      callbackNumber: '+15125550123',
      billableCount: SMALL_COUNT,
      amountInCents: calcRobocallTotalInCents(SMALL_COUNT),
    },
  })
  return spine.id
}

const authorize = (outreachId: number) =>
  service.client.post(
    `/v1/outreach/robocall/${outreachId}/authorize`,
    { paymentMethodId: 'pm_1' },
    { headers: { 'x-organization-slug': orgSlug } },
  )

const readSatellite = (outreachId: number) =>
  service.prisma.outreachRobocall.findUniqueOrThrow({ where: { outreachId } })

const readSpine = (outreachId: number) =>
  service.prisma.outreach.findUniqueOrThrow({ where: { id: outreachId } })

// What the completion sweep leaves behind: the run dialed and is ready to settle.
const readyToCapture = (outreachId: number, completedCallCount: number) =>
  service.prisma.outreachRobocall.update({
    where: { outreachId },
    data: {
      settleState: RobocallSettleState.settling,
      completedCallCount,
    },
  })

describe('robocall authorize with outreach credit', () => {
  it('places no card hold when credit covers the estimate, and reserves it', async () => {
    const estimate = calcRobocallTotalInCents(SMALL_COUNT)
    const outreachId = await createDraft()

    const res = await authorize(outreachId)

    expect(res.status).toBe(201)
    expect(res.data).toMatchObject({
      status: 'authorized',
      authorizedAmountInCents: 0,
    })
    expect(paymentIntentsCreate).not.toHaveBeenCalled()
    expect((await readSpine(outreachId)).creditReservedCents).toBe(estimate)
    expect(await balance()).toBe(17500 - estimate)
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.authorized)
    expect(satellite.promoCoversTotal).toBe(true)
    expect(satellite.authorizationIntentId).toBeNull()
  })

  it('holds only the remainder when credit covers part of the estimate', async () => {
    billableCount = LARGE_COUNT
    const estimate = calcRobocallTotalInCents(LARGE_COUNT)
    const outreachId = await createDraft()

    const res = await authorize(outreachId)

    expect(res.data).toMatchObject({
      status: 'authorized',
      authorizedAmountInCents: estimate - 17500,
    })
    expect(paymentIntentsCreate).toHaveBeenCalledTimes(1)
    expect(paymentIntentsCreate.mock.calls[0]?.[0]).toMatchObject({
      amount: estimate - 17500,
    })
    expect((await readSpine(outreachId)).creditReservedCents).toBe(17500)
    expect(await balance()).toBe(0)
    expect((await readSatellite(outreachId)).authorizedAmountInCents).toBe(
      estimate - 17500,
    )
  })

  it('forgives a remainder under the Stripe minimum instead of holding it', async () => {
    const estimate = calcRobocallTotalInCents(SMALL_COUNT)
    await setBalance(estimate - 20)
    const outreachId = await createDraft()

    const res = await authorize(outreachId)

    expect(res.data).toMatchObject({
      status: 'authorized',
      authorizedAmountInCents: 0,
    })
    expect(paymentIntentsCreate).not.toHaveBeenCalled()
    expect(await balance()).toBe(0)
  })

  it('draws no credit and holds the full estimate with the flag off', async () => {
    featureSpy.mockImplementation(
      async ({ feature }: { feature: string }) =>
        feature !== WIN_PER_CAMPAIGN_PRICING_FLAG,
    )
    const estimate = calcRobocallTotalInCents(SMALL_COUNT)
    const outreachId = await createDraft()

    const res = await authorize(outreachId)

    expect(res.data).toMatchObject({ authorizedAmountInCents: estimate })
    expect(paymentIntentsCreate.mock.calls[0]?.[0]).toMatchObject({
      amount: estimate,
    })
    expect((await readSpine(outreachId)).creditReservedCents).toBe(0)
    expect(await balance()).toBe(17500)
  })

  it('reserves nothing for a send deferred past the hold window until the hold is placed', async () => {
    const outreachId = await createDraft(addDays(new Date(), 10))

    const deferred = await authorize(outreachId)

    expect(deferred.data).toMatchObject({ status: 'deferred' })
    expect((await readSpine(outreachId)).creditReservedCents).toBe(0)
    expect(await balance()).toBe(17500)

    // The send is now inside the window: the sweep places the hold, with no card
    // passed, and the reserve is taken then.
    await service.prisma.outreach.update({
      where: { id: outreachId },
      data: { date: addDays(new Date(), 2) },
    })
    const user = await service.prisma.user.findUniqueOrThrow({
      where: { id: service.user.id },
    })
    const organization = await service.prisma.organization.findUniqueOrThrow({
      where: { slug: orgSlug },
    })
    await service.app
      .get(OutreachRobocallHoldService)
      .authorizeHold(user, campaign, organization, outreachId)

    expect((await readSpine(outreachId)).creditReservedCents).toBe(
      calcRobocallTotalInCents(SMALL_COUNT),
    )
    expect(paymentIntentsCreate).not.toHaveBeenCalled()
  })
})

describe('robocall capture with outreach credit', () => {
  it('uses the whole reserve of a credit-covered run and leaves the balance', async () => {
    const estimate = calcRobocallTotalInCents(SMALL_COUNT)
    const outreachId = await createDraft()
    await authorize(outreachId)
    await service.prisma.outreach.update({
      where: { id: outreachId },
      data: { status: OutreachStatus.in_progress },
    })
    await readyToCapture(outreachId, SMALL_COUNT)

    await service.app
      .get(OutreachRobocallCaptureService)
      .captureDraft(outreachId)

    expect(captureSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.captured,
    )
    expect((await readSpine(outreachId)).creditSettledAt).not.toBeNull()
    expect(await balance()).toBe(17500 - estimate)
  })

  it('captures the card remainder and spends the credit to zero on a partly covered run', async () => {
    billableCount = LARGE_COUNT
    const estimate = calcRobocallTotalInCents(LARGE_COUNT)
    const outreachId = await createDraft()
    await authorize(outreachId)
    await readyToCapture(outreachId, LARGE_COUNT)

    await service.app
      .get(OutreachRobocallCaptureService)
      .captureDraft(outreachId)

    expect(captureSpy).toHaveBeenCalledWith(
      'pi_credit',
      estimate - 17500,
      'robocall-capture-pi_credit',
    )
    expect((await readSpine(outreachId)).creditSettledAt).not.toBeNull()
    expect(await balance()).toBe(0)
  })

  it('returns the whole reserve when no call connected on a covered run', async () => {
    const outreachId = await createDraft()
    await authorize(outreachId)
    await readyToCapture(outreachId, 0)

    await service.app
      .get(OutreachRobocallCaptureService)
      .captureDraft(outreachId)

    expect(await balance()).toBe(17500)
    expect((await readSpine(outreachId)).creditReservedCents).toBe(0)
  })

  it('returns the whole reserve when a zero-connect run voids its hold', async () => {
    billableCount = LARGE_COUNT
    const outreachId = await createDraft()
    await authorize(outreachId)
    await readyToCapture(outreachId, 0)

    await service.app
      .get(OutreachRobocallCaptureService)
      .captureDraft(outreachId)

    expect(voidSpy).toHaveBeenCalledWith('pi_credit')
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.voided,
    )
    expect(await balance()).toBe(17500)
  })
})

describe('robocall cancel with outreach credit', () => {
  it('returns the reserve when a scheduled run is canceled before it dials', async () => {
    billableCount = LARGE_COUNT
    const outreachId = await createDraft(addHours(new Date(), 60))
    await authorize(outreachId)
    expect(await balance()).toBe(0)

    await service.app
      .get(OutreachRobocallCancelService)
      .cancel(outreachId, campaign.id)

    expect(voidSpy).toHaveBeenCalledWith('pi_credit')
    expect(await balance()).toBe(17500)
  })
})

describe('robocall hold that fails on infrastructure', () => {
  const stripeOutage = () =>
    new Stripe.errors.StripeConnectionError({
      message: 'An error occurred with our connection to Stripe.',
      type: 'api_error',
    })

  const sweepAbandoned = (hoursIdle: number) =>
    service.app
      .get(OutreachRobocallDeferredHoldService)
      .releaseAbandonedReserves(addHours(new Date(), hoursIdle))

  it('keeps the reserve so the retry holds the same amount under the same key', async () => {
    billableCount = LARGE_COUNT
    const estimate = calcRobocallTotalInCents(LARGE_COUNT)
    const outreachId = await createDraft()
    paymentIntentsCreate.mockRejectedValueOnce(stripeOutage())

    const failed = await authorize(outreachId)

    expect(failed.status).toBe(502)
    expect((await readSpine(outreachId)).creditReservedCents).toBe(17500)
    expect(await balance()).toBe(0)

    const retried = await authorize(outreachId)

    expect(retried.data).toMatchObject({
      status: 'authorized',
      authorizedAmountInCents: estimate - 17500,
    })
    expect(await balance()).toBe(0)
  })

  it('returns the reserve of a draft nobody retried once the key has expired', async () => {
    billableCount = LARGE_COUNT
    const outreachId = await createDraft()
    paymentIntentsCreate.mockRejectedValueOnce(stripeOutage())
    await authorize(outreachId)

    await sweepAbandoned(24)
    expect((await readSpine(outreachId)).creditReservedCents).toBe(17500)

    await sweepAbandoned(26)
    expect((await readSpine(outreachId)).creditReservedCents).toBe(0)
    expect((await readSpine(outreachId)).creditSettledAt).toBeNull()
    expect(await balance()).toBe(17500)
  })

  it('still gives a late retry its credit after the sweep returned it', async () => {
    billableCount = LARGE_COUNT
    const estimate = calcRobocallTotalInCents(LARGE_COUNT)
    const outreachId = await createDraft()
    paymentIntentsCreate.mockRejectedValueOnce(stripeOutage())
    await authorize(outreachId)
    await sweepAbandoned(26)

    const retried = await authorize(outreachId)

    expect(retried.data).toMatchObject({
      status: 'authorized',
      authorizedAmountInCents: estimate - 17500,
    })
    expect((await readSpine(outreachId)).creditReservedCents).toBe(17500)
    expect(await balance()).toBe(0)
  })

  it('leaves a declined draft alone, which the card-update retry resumes', async () => {
    billableCount = LARGE_COUNT
    const outreachId = await createDraft()
    paymentIntentsCreate.mockRejectedValueOnce(
      new Stripe.errors.StripeCardError({
        message: 'Your card was declined.',
        type: 'card_error',
        code: 'card_declined',
      }),
    )
    await authorize(outreachId)

    await sweepAbandoned(48)

    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.hold_failed,
    )
    expect((await readSpine(outreachId)).creditReservedCents).toBe(17500)
  })
})
