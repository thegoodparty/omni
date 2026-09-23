import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import { addDays, getUnixTime } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Stripe from 'stripe'
import { useTestService } from '@/test-service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { HubspotSingleSendService } from '@/crm/hubspotSingleSend.service'
import { OutreachRobocallService } from '@/outreach/services/outreachRobocall.service'
import { OutreachRobocallHoldService } from '@/outreach/services/outreachRobocallHold.service'
import { OutreachRobocallPromoService } from '@/outreach/services/outreachRobocallPromo.service'
import { OutreachNotificationService } from '@/outreach/services/outreachNotification.service'
import { Campaign, RobocallSettleState } from '../../generated/prisma'
import { calcRobocallTotalInCents } from '@/shared/util/robocallPricing.util'

const service = useTestService()

const promotionCodesList = vi.fn()
const promotionCodesUpdate = vi.fn()
const paymentIntentsCreate = vi.fn()
const paymentIntentsCancel = vi.fn()
const paymentMethodsRetrieve = vi.fn()

let campaign: Campaign
let orgSlug: string
let filterId: number

// 100 landlines at the per-call rate + the $2 number fee.
const ESTIMATE = calcRobocallTotalInCents(100)

// A promotion code as Stripe returns it from `promotionCodes.list` with
// `data.promotion.coupon` expanded. Only the fields the service reads.
const stripePromo = (
  overrides: {
    id?: string
    code?: string
    amountOff?: number | null
    percentOff?: number | null
    minimumAmount?: number | null
    valid?: boolean
  } = {},
) =>
  ({
    id: overrides.id ?? 'promo_1',
    code: overrides.code ?? 'CALLS1000',
    active: true,
    restrictions: { minimum_amount: overrides.minimumAmount ?? null },
    promotion: {
      type: 'coupon',
      coupon: {
        id: 'coupon_1',
        amount_off:
          overrides.amountOff === undefined ? 4500 : overrides.amountOff,
        percent_off: overrides.percentOff ?? null,
        currency: 'usd',
        valid: overrides.valid ?? true,
      },
    },
  }) as unknown as Stripe.PromotionCode

const listResult = (promo: Stripe.PromotionCode | null) =>
  ({
    data: promo ? [promo] : [],
  }) as unknown as Stripe.ApiList<Stripe.PromotionCode>

beforeEach(async () => {
  const stripe = service.app.get(StripeService)
  const stripeClient = (stripe as unknown as { stripe: Stripe }).stripe
  vi.spyOn(stripeClient.promotionCodes, 'list').mockImplementation(
    promotionCodesList,
  )
  vi.spyOn(stripeClient.promotionCodes, 'update').mockImplementation(
    promotionCodesUpdate,
  )
  vi.spyOn(stripeClient.paymentIntents, 'create').mockImplementation(
    paymentIntentsCreate,
  )
  vi.spyOn(stripeClient.paymentIntents, 'cancel').mockImplementation(
    paymentIntentsCancel,
  )
  vi.spyOn(stripeClient.paymentMethods, 'retrieve').mockImplementation(
    paymentMethodsRetrieve,
  )
  promotionCodesUpdate.mockResolvedValue({})
  paymentIntentsCancel.mockResolvedValue({})
  paymentMethodsRetrieve.mockResolvedValue({
    id: 'pm_1',
    customer: 'cus_test',
    type: 'card',
  })
  paymentIntentsCreate.mockImplementation(async (params) => ({
    id: 'pi_promo',
    status: 'requires_capture',
    amount: params.amount,
    amount_capturable: params.amount,
    capture_before: getUnixTime(addDays(new Date(), 7)),
  }))

  vi.spyOn(
    service.app.get(OutreachRobocallService),
    'deriveBillableCount',
  ).mockResolvedValue(100)
  vi.spyOn(service.app.get(AnalyticsService), 'track').mockResolvedValue(
    undefined as never,
  )
  vi.spyOn(
    service.app.get(HubspotSingleSendService),
    'sendSingleSend',
  ).mockResolvedValue(undefined as never)
  vi.spyOn(
    service.app.get(OutreachNotificationService),
    'notifyRobocallScheduled',
  ).mockResolvedValue(undefined)

  const campaignId = 995
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
      details: { state: 'TX', city: 'Georgetown', zip: '78634' },
      data: {},
      aiContent: {},
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

const orgHeaders = () => ({ headers: { 'x-organization-slug': orgSlug } })

const createDraft = async ({
  settleState = RobocallSettleState.pending_payment,
  promo,
}: {
  settleState?: RobocallSettleState
  promo?: {
    promotionCodeId: string
    promoCode: string
    promoDiscountInCents: number
    promoRedeemedAt?: Date
  }
} = {}): Promise<number> => {
  const spine = await service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: orgSlug,
      outreachType: 'robocall',
      status: 'pending_payment',
      date: addDays(new Date(), 2),
      voterFileFilterId: filterId,
    },
  })
  await service.prisma.outreachRobocall.create({
    data: {
      outreachId: spine.id,
      audioKey: `robocall/995/${randomUUID()}.webm`,
      callbackNumber: '+15125550123',
      billableCount: 100,
      amountInCents: ESTIMATE,
      settleState,
      ...(promo ?? {}),
    },
  })
  return spine.id
}

const applyPromo = (outreachId: number, code: string) =>
  service.client.post(
    `/v1/outreach/robocall/${outreachId}/promo`,
    { code },
    orgHeaders(),
  )

const postAuthorize = (outreachId: number, body: object = {}) =>
  service.client.post(
    `/v1/outreach/robocall/${outreachId}/authorize`,
    body,
    orgHeaders(),
  )

const readSatellite = (outreachId: number) =>
  service.prisma.outreachRobocall.findUniqueOrThrow({ where: { outreachId } })

const readSpine = (outreachId: number) =>
  service.prisma.outreach.findUniqueOrThrow({ where: { id: outreachId } })

describe('POST /v1/outreach/robocall/:outreachId/promo', () => {
  it('remembers a partial amount-off code and prices the remainder, consuming nothing', async () => {
    promotionCodesList.mockResolvedValue(
      listResult(stripePromo({ amountOff: 300 })),
    )
    const outreachId = await createDraft()

    const res = await applyPromo(outreachId, 'CALLS1000')

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({
      promoCode: 'CALLS1000',
      promoDiscountInCents: 300,
      amountDueInCents: ESTIMATE - 300,
      coversTotal: false,
    })
    const satellite = await readSatellite(outreachId)
    expect(satellite.promotionCodeId).toBe('promo_1')
    expect(satellite.promoCode).toBe('CALLS1000')
    expect(satellite.promoDiscountInCents).toBe(300)
    expect(satellite.promoRedeemedAt).toBeNull()
    // Applying only remembers the code; Stripe is not told it was spent.
    expect(promotionCodesUpdate).not.toHaveBeenCalled()
  })

  it('reports a code worth more than the run as covering the total', async () => {
    promotionCodesList.mockResolvedValue(
      listResult(stripePromo({ amountOff: 4500 })),
    )
    const outreachId = await createDraft()

    const res = await applyPromo(outreachId, 'CALLS1000')

    expect(res.data).toEqual({
      promoCode: 'CALLS1000',
      promoDiscountInCents: ESTIMATE,
      amountDueInCents: 0,
      coversTotal: true,
    })
  })

  it('prices the code off the live estimate, not a stale stored amount', async () => {
    // A draft from before the number fee shipped stores a fee-less amount. A
    // code that would cover that stale figure must not read as covering the
    // live estimate the authorize path will hold against.
    promotionCodesList.mockResolvedValue(
      listResult(stripePromo({ amountOff: ESTIMATE - 200 })),
    )
    const outreachId = await createDraft()
    await service.prisma.outreachRobocall.update({
      where: { outreachId },
      data: { amountInCents: ESTIMATE - 200 },
    })

    const res = await applyPromo(outreachId, 'CALLS1000')

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({
      promoCode: 'CALLS1000',
      promoDiscountInCents: ESTIMATE - 200,
      amountDueInCents: 200,
      coversTotal: false,
    })
  })

  it('treats a sub-minimum remainder as covered rather than holding under 50 cents', async () => {
    promotionCodesList.mockResolvedValue(
      listResult(stripePromo({ amountOff: ESTIMATE - 20 })),
    )
    const outreachId = await createDraft()

    const res = await applyPromo(outreachId, 'CALLS1000')

    expect(res.data.coversTotal).toBe(true)
    expect(res.data.amountDueInCents).toBe(0)
  })

  it('rejects an unknown or inactive code', async () => {
    promotionCodesList.mockResolvedValue(listResult(null))
    const outreachId = await createDraft()

    const res = await applyPromo(outreachId, 'NOPE')

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    const satellite = await readSatellite(outreachId)
    expect(satellite.promotionCodeId).toBeNull()
  })

  it('rejects a code another robocall already spent', async () => {
    promotionCodesList.mockResolvedValue(listResult(stripePromo()))
    await createDraft({
      settleState: RobocallSettleState.authorized,
      promo: {
        promotionCodeId: 'promo_1',
        promoCode: 'CALLS1000',
        promoDiscountInCents: 400,
        promoRedeemedAt: new Date(),
      },
    })
    const outreachId = await createDraft()

    const res = await applyPromo(outreachId, 'CALLS1000')

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(res.data.message).toMatch(/already been used/)
  })

  it('refuses to change the code on a draft that already holds money', async () => {
    promotionCodesList.mockResolvedValue(listResult(stripePromo()))
    const outreachId = await createDraft({
      settleState: RobocallSettleState.authorized,
    })

    const res = await applyPromo(outreachId, 'CALLS1000')

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('DELETE forgets the remembered code', async () => {
    const outreachId = await createDraft({
      promo: {
        promotionCodeId: 'promo_1',
        promoCode: 'CALLS1000',
        promoDiscountInCents: 300,
      },
    })

    const res = await service.client.delete(
      `/v1/outreach/robocall/${outreachId}/promo`,
      orgHeaders(),
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({
      promoCode: null,
      promoDiscountInCents: 0,
      amountDueInCents: ESTIMATE,
      coversTotal: false,
    })
    const satellite = await readSatellite(outreachId)
    expect(satellite.promotionCodeId).toBeNull()
    expect(satellite.promoCode).toBeNull()
  })
})

describe('POST /v1/outreach/robocall/:outreachId/authorize with a promo', () => {
  it('holds the discounted amount, stamps the redemption, and deactivates the code', async () => {
    promotionCodesList.mockResolvedValue(
      listResult(stripePromo({ amountOff: 300 })),
    )
    const outreachId = await createDraft({
      promo: {
        promotionCodeId: 'promo_1',
        promoCode: 'CALLS1000',
        promoDiscountInCents: 300,
      },
    })

    const res = await postAuthorize(outreachId, { paymentMethodId: 'pm_1' })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toMatchObject({
      status: 'authorized',
      authorizedAmountInCents: ESTIMATE - 300,
      promoDiscountInCents: 300,
    })
    expect(paymentIntentsCreate).toHaveBeenCalledTimes(1)
    expect(paymentIntentsCreate.mock.calls[0]?.[0]).toMatchObject({
      amount: ESTIMATE - 300,
    })
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.authorized)
    expect(satellite.authorizedAmountInCents).toBe(ESTIMATE - 300)
    expect(satellite.promoDiscountInCents).toBe(300)
    expect(satellite.promoRedeemedAt).not.toBeNull()
    expect(satellite.promoCoversTotal).toBe(false)
    expect(promotionCodesUpdate).toHaveBeenCalledWith('promo_1', {
      active: false,
    })
  })

  it('schedules a fully covered run with no card and no hold', async () => {
    promotionCodesList.mockResolvedValue(
      listResult(stripePromo({ amountOff: 4500 })),
    )
    const outreachId = await createDraft({
      promo: {
        promotionCodeId: 'promo_1',
        promoCode: 'CALLS1000',
        promoDiscountInCents: ESTIMATE,
      },
    })

    const res = await postAuthorize(outreachId)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toMatchObject({
      status: 'authorized',
      settleState: RobocallSettleState.authorized,
      authorizedAmountInCents: 0,
      promoDiscountInCents: ESTIMATE,
    })
    expect(paymentIntentsCreate).not.toHaveBeenCalled()
    expect(paymentMethodsRetrieve).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.authorized)
    expect(satellite.authorizationIntentId).toBeNull()
    expect(satellite.authorizedAmountInCents).toBe(0)
    expect(satellite.promoCoversTotal).toBe(true)
    expect(satellite.promoRedeemedAt).not.toBeNull()
    expect(promotionCodesUpdate).toHaveBeenCalledWith('promo_1', {
      active: false,
    })
    // Visible in history like any scheduled send.
    expect((await readSpine(outreachId)).status).toBe('pending')
  })

  it('does not schedule a covered run twice', async () => {
    promotionCodesList.mockResolvedValue(
      listResult(stripePromo({ amountOff: 4500 })),
    )
    const outreachId = await createDraft({
      promo: {
        promotionCodeId: 'promo_1',
        promoCode: 'CALLS1000',
        promoDiscountInCents: ESTIMATE,
      },
    })

    await postAuthorize(outreachId)
    const again = await postAuthorize(outreachId)

    expect(again.data).toMatchObject({
      status: 'authorized',
      authorizedAmountInCents: 0,
      promoDiscountInCents: ESTIMATE,
    })
    expect(promotionCodesUpdate).toHaveBeenCalledTimes(1)
  })

  it('refuses a code spent elsewhere between apply and authorize, holding nothing', async () => {
    promotionCodesList.mockResolvedValue(listResult(null))
    const outreachId = await createDraft({
      promo: {
        promotionCodeId: 'promo_1',
        promoCode: 'CALLS1000',
        promoDiscountInCents: 300,
      },
    })

    const res = await postAuthorize(outreachId, { paymentMethodId: 'pm_1' })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(paymentIntentsCreate).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.pending_payment)
  })

  it('the database refuses a second redemption of one code', async () => {
    const redeemed = {
      promotionCodeId: 'promo_1',
      promoCode: 'CALLS1000',
      promoDiscountInCents: 300,
      promoRedeemedAt: new Date(),
    }
    await createDraft({
      settleState: RobocallSettleState.authorized,
      promo: redeemed,
    })

    await expect(
      createDraft({
        settleState: RobocallSettleState.authorized,
        promo: redeemed,
      }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('voids the hold and refuses when another draft redeemed the code during placement', async () => {
    // The pre-check passed for both drafts; the other one committed first.
    // Skipping resolveForAuthorize's re-check is what reproduces that window.
    await createDraft({
      settleState: RobocallSettleState.authorized,
      promo: {
        promotionCodeId: 'promo_1',
        promoCode: 'CALLS1000',
        promoDiscountInCents: 300,
        promoRedeemedAt: new Date(),
      },
    })
    const outreachId = await createDraft({
      promo: {
        promotionCodeId: 'promo_1',
        promoCode: 'CALLS1000',
        promoDiscountInCents: 300,
      },
    })
    vi.spyOn(
      service.app.get(OutreachRobocallPromoService),
      'resolveForAuthorize',
    ).mockResolvedValueOnce({
      promotionCodeId: 'promo_1',
      promoCode: 'CALLS1000',
      discountInCents: 300,
      coversTotal: false,
    })

    const res = await postAuthorize(outreachId, { paymentMethodId: 'pm_1' })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(res.data.message).toMatch(/already been used/)
    expect(paymentIntentsCreate).toHaveBeenCalledTimes(1)
    expect(paymentIntentsCancel).toHaveBeenCalledWith('pi_promo')
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.pending_payment)
    expect(satellite.authorizationIntentId).toBeNull()
    expect(satellite.promoRedeemedAt).toBeNull()
    expect(promotionCodesUpdate).not.toHaveBeenCalled()
    const orphan = await service.prisma.robocallOrphanedHold.findUnique({
      where: { paymentIntentId: 'pi_promo' },
    })
    expect(orphan?.reason).toBe('lost_commit')
  })

  it('refuses a covered run whose code another draft redeemed first, scheduling nothing', async () => {
    await createDraft({
      settleState: RobocallSettleState.authorized,
      promo: {
        promotionCodeId: 'promo_1',
        promoCode: 'CALLS1000',
        promoDiscountInCents: ESTIMATE,
        promoRedeemedAt: new Date(),
      },
    })
    const outreachId = await createDraft({
      promo: {
        promotionCodeId: 'promo_1',
        promoCode: 'CALLS1000',
        promoDiscountInCents: ESTIMATE,
      },
    })
    vi.spyOn(
      service.app.get(OutreachRobocallPromoService),
      'resolveForAuthorize',
    ).mockResolvedValueOnce({
      promotionCodeId: 'promo_1',
      promoCode: 'CALLS1000',
      discountInCents: ESTIMATE,
      coversTotal: true,
    })

    const res = await postAuthorize(outreachId)

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(res.data.message).toMatch(/already been used/)
    expect(paymentIntentsCreate).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.pending_payment)
    expect(satellite.promoRedeemedAt).toBeNull()
    expect(satellite.promoCoversTotal).toBe(false)
    expect((await readSpine(outreachId)).status).toBe('pending_payment')
    expect(promotionCodesUpdate).not.toHaveBeenCalled()
  })

  it('400s a cardless authorize when the promo does not cover the run', async () => {
    promotionCodesList.mockResolvedValue(
      listResult(stripePromo({ amountOff: 300 })),
    )
    const outreachId = await createDraft({
      promo: {
        promotionCodeId: 'promo_1',
        promoCode: 'CALLS1000',
        promoDiscountInCents: 300,
      },
    })

    const res = await postAuthorize(outreachId)

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.pending_payment)
    expect(satellite.promoRedeemedAt).toBeNull()
  })
})

describe('promo restore on a pre-dial unwind', () => {
  it('failSend hands a spent code back and reactivates it in Stripe', async () => {
    const outreachId = await createDraft({
      settleState: RobocallSettleState.authorized,
      promo: {
        promotionCodeId: 'promo_1',
        promoCode: 'CALLS1000',
        promoDiscountInCents: ESTIMATE,
        promoRedeemedAt: new Date(),
      },
    })
    await service.prisma.outreachRobocall.update({
      where: { outreachId },
      data: { promoCoversTotal: true, authorizedAmountInCents: 0 },
    })

    await service.app
      .get(OutreachRobocallHoldService)
      .failSend(outreachId, 'staging')

    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.send_failed)
    expect(satellite.promoRedeemedAt).toBeNull()
    expect(satellite.promoCoversTotal).toBe(false)
    // The code itself stays on the row for the audit trail.
    expect(satellite.promotionCodeId).toBe('promo_1')
    expect(promotionCodesUpdate).toHaveBeenCalledWith('promo_1', {
      active: true,
    })
  })
})
