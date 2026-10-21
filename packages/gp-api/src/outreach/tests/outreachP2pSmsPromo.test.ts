import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { CrmCampaignsService } from '@/campaigns/services/crmCampaigns.service'
import { FREE_TEXTS_OFFER } from '@/shared/constants/freeTextsOffer'
import {
  calcTextAmountInCents,
  maxTextsForAmountInCents,
} from '@/shared/util/textPricing.util'
import { PurchaseType } from '@/payments/purchase.types'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { PeerlyP2pJobService } from '@/vendors/peerly/services/peerlyP2pJob.service'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { OutreachMaterializationService } from '../services/outreachMaterialization.service'
import { OutreachP2pSmsCancelService } from '../services/outreachP2pSmsCancel.service'
import { OutreachP2pSmsCaptureService } from '../services/outreachP2pSmsCapture.service'
import { OutreachPurchaseHandlerService } from '../services/outreachPurchase.service'
import {
  Campaign,
  OutreachStatus,
  OutreachType,
  P2pSmsSettleState,
  PhoneListBuildStatus,
} from '../../generated/prisma'

// A Win p2p hold checkout with a Stripe promotion code, driven through the
// real completion route and post-purchase handler. Stripe is stubbed at the
// SDK seam: the session reports what the code took off, the PaymentIntent the
// net hold, exactly as a test-mode checkout does.
const service = useTestService()

const SESSION_ID = 'cs_test_promo'
const INTENT_ID = 'pi_test_promo'
const CHARGE_ID = 'ch_test_promo'
const PROMO_ID = 'promo_test_1'
const PEERLY_LIST_ID = 930_001

let campaign: Campaign
let buildId: string
let savedListId: number
let stripe: {
  retrieveCheckoutSession: ReturnType<typeof vi.spyOn>
  retrievePaymentIntent: ReturnType<typeof vi.spyOn>
  capturePaymentIntent: ReturnType<typeof vi.spyOn>
  voidHold: ReturnType<typeof vi.spyOn>
  refundCharge: ReturnType<typeof vi.spyOn>
}

const intent = (
  overrides: Partial<Stripe.PaymentIntent> = {},
): Stripe.Response<Stripe.PaymentIntent> =>
  ({
    id: INTENT_ID,
    object: 'payment_intent',
    capture_method: 'manual',
    status: 'requires_capture',
    metadata: {},
    latest_charge: CHARGE_ID,
    ...overrides,
  }) as unknown as Stripe.Response<Stripe.PaymentIntent>

// What Stripe returns for the completed session: the undiscounted hold as
// the subtotal, the code's discount, and the net total the PI was placed for.
const completedSession = ({
  outreachId,
  holdInCents,
  discountInCents,
}: {
  outreachId: number
  holdInCents: number
  discountInCents: number
}): Stripe.Response<Stripe.Checkout.Session> => {
  const total = holdInCents - discountInCents
  return {
    id: SESSION_ID,
    object: 'checkout.session',
    status: 'complete',
    // A hold completes unpaid; a code that covers it all completes paid with
    // no PaymentIntent (verified in Stripe test mode).
    payment_status: total === 0 ? 'paid' : 'unpaid',
    payment_intent: total === 0 ? null : INTENT_ID,
    amount_subtotal: holdInCents,
    amount_total: total,
    total_details: {
      amount_discount: discountInCents,
      amount_shipping: 0,
      amount_tax: 0,
    },
    discounts:
      discountInCents > 0
        ? [{ coupon: 'co_test', promotion_code: PROMO_ID }]
        : [],
    metadata: {
      purchaseType: PurchaseType.TEXT,
      outreachType: 'p2p',
      campaignId: String(campaign.id),
      outreachId: String(outreachId),
      winSmsHoldBilling: 'true',
    },
  } as unknown as Stripe.Response<Stripe.Checkout.Session>
}

beforeEach(async () => {
  const slug = 'p2p-promo-4501'
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id, positionId: 'pos-1' },
  })
  campaign = await service.prisma.campaign.create({
    data: {
      id: 4501,
      slug,
      organizationSlug: slug,
      userId: service.user.id,
      isPro: true,
      details: {},
      data: {},
      aiContent: {},
    },
  })
  const savedList = await service.prisma.voterFileFilter.create({
    data: { organizationSlug: slug, name: 'saved list' },
  })
  savedListId = savedList.id

  const stripeService = service.app.get(StripeService)
  stripe = {
    retrieveCheckoutSession: vi.spyOn(stripeService, 'retrieveCheckoutSession'),
    retrievePaymentIntent: vi
      .spyOn(stripeService, 'retrievePaymentIntent')
      .mockResolvedValue(intent()),
    capturePaymentIntent: vi
      .spyOn(stripeService, 'capturePaymentIntent')
      .mockImplementation(async (_id: string, amount: number) =>
        intent({ status: 'succeeded', amount_received: amount }),
      ),
    voidHold: vi.spyOn(stripeService, 'voidHold').mockResolvedValue(undefined),
    refundCharge: vi.spyOn(stripeService, 'refundCharge'),
  }
  vi.spyOn(stripeService, 'updatePaymentIntentMetadata').mockResolvedValue(
    intent() as Stripe.Response<Stripe.PaymentIntent>,
  )

  vi.spyOn(
    service.app.get(S3Service),
    'getFileBytesWithContentType',
  ).mockResolvedValue({
    bytes: Buffer.from('fake-image-bytes'),
    contentType: 'image/png',
  })
  vi.spyOn(
    service.app.get(PeerlyP2pJobService),
    'createPeerlyP2pJob',
  ).mockResolvedValue('peerly-job-promo')
  vi.spyOn(service.app.get(PeerlyP2pJobService), 'deleteJob').mockResolvedValue(
    undefined,
  )
  vi.spyOn(service.app.get(SlackService), 'message').mockResolvedValue(
    'ok' as unknown as Awaited<ReturnType<SlackService['message']>>,
  )
  vi.spyOn(
    service.app.get(CrmCampaignsService),
    'getCrmCompanyOwnerName',
  ).mockResolvedValue('Test PA')
  vi.spyOn(
    service.app.get(OutreachMaterializationService),
    'materializeOutreach',
  ).mockResolvedValue(undefined as never)
})

// A built list and a paid-for draft that names it (the build-before-pay flow).
const seedReadyDraft = async (leads: number) => {
  const build = await service.prisma.peerlyPhoneList.create({
    data: {
      organizationSlug: campaign.organizationSlug,
      campaignId: campaign.id,
      token: 'promo-list-token',
      peerlyListId: PEERLY_LIST_ID,
      buildStatus: PhoneListBuildStatus.ready,
      leadsLoaded: leads,
      voterFileFilterId: savedListId,
    },
  })
  buildId = build.id
  return service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: campaign.organizationSlug,
      outreachType: OutreachType.p2p,
      status: OutreachStatus.pending_payment,
      phoneListId: PEERLY_LIST_ID,
      voterFileFilterId: savedListId,
      textCount: leads,
      script: 'Hi {first_name}. Paid for by Friends. Reply STOP to opt out.',
      imageUrl: 'https://assets.example.com/scheduled-campaign/x/p2p/a.png',
      identityId: '11538886',
      date: new Date(Date.now() + 7 * 86_400_000),
    },
  })
}

const complete = () =>
  service.client.post('/v1/payments/purchase/complete-checkout-session', {
    checkoutSessionId: SESSION_ID,
  })

const readSatellite = (outreachId: number) =>
  service.prisma.outreachP2pSms.findUniqueOrThrow({ where: { outreachId } })

// Arms the Stripe stubs for one completed checkout, then completes it.
const payWithPromo = async ({
  outreachId,
  holdInCents,
  discountInCents,
}: {
  outreachId: number
  holdInCents: number
  discountInCents: number
}) => {
  stripe.retrieveCheckoutSession.mockResolvedValue(
    completedSession({ outreachId, holdInCents, discountInCents }),
  )
  stripe.retrievePaymentIntent.mockResolvedValue(
    intent({ amount: holdInCents - discountInCents }),
  )
  return complete()
}

describe('a promotion code on a Win SMS hold checkout', () => {
  it('records the discount with the hold and captures the final count less the code', async () => {
    const leads = 8_000
    const hold = calcTextAmountInCents(leads)
    const discount = 5_000
    const draft = await seedReadyDraft(leads)

    const res = await payWithPromo({
      outreachId: draft.id,
      holdInCents: hold,
      discountInCents: discount,
    })

    expect(res.status).toBe(201)
    const sms = await readSatellite(draft.id)
    expect(sms).toMatchObject({
      authorizationIntentId: INTENT_ID,
      authorizedAmountInCents: hold - discount,
      promoDiscountInCents: discount,
      promotionCodeId: PROMO_ID,
      promoCoversTotal: false,
      settleState: P2pSmsSettleState.captured,
      capturedAmountInCents: hold - discount,
    })
    expect(stripe.capturePaymentIntent).toHaveBeenCalledWith(
      INTENT_ID,
      hold - discount,
      `p2p-sms-capture-${INTENT_ID}`,
    )
  })

  it('keeps the whole list under the send cap even though the hold is smaller', async () => {
    const leads = 8_000
    const hold = calcTextAmountInCents(leads)
    const discount = 5_000
    const draft = await seedReadyDraft(leads)
    await payWithPromo({
      outreachId: draft.id,
      holdInCents: hold,
      discountInCents: discount,
    })

    const cap = await service.app
      .get(OutreachP2pSmsCaptureService)
      .resolveSendCapForBuild(buildId)

    // The build carries no cap persisted at session creation here, so the
    // satellite fallback decides. Read off the net hold it would cut the list.
    expect(maxTextsForAmountInCents(hold - discount)).toBeLessThan(leads)
    expect(cap).toBeGreaterThanOrEqual(leads)
  })

  it('takes both discounts off at capture when the send also used the free-texts offer', async () => {
    await service.prisma.campaign.update({
      where: { id: campaign.id },
      data: { hasFreeTextsOffer: true },
    })
    const leads = FREE_TEXTS_OFFER.COUNT + 3_000
    const hold = calcTextAmountInCents(leads)
    const afterFreeTexts = calcTextAmountInCents(3_000)
    const discount = 2_000
    const draft = await seedReadyDraft(leads)

    await payWithPromo({
      outreachId: draft.id,
      holdInCents: hold,
      discountInCents: discount,
    })

    expect(afterFreeTexts - discount).toBeGreaterThanOrEqual(50)
    expect(stripe.capturePaymentIntent).toHaveBeenCalledWith(
      INTENT_ID,
      afterFreeTexts - discount,
      `p2p-sms-capture-${INTENT_ID}`,
    )
    expect((await readSatellite(draft.id)).freeTextsApplied).toBe(true)
  })

  it('settles at $0 when the free-texts offer and the code together cover the send', async () => {
    await service.prisma.campaign.update({
      where: { id: campaign.id },
      data: { hasFreeTextsOffer: true },
    })
    const leads = FREE_TEXTS_OFFER.COUNT + 1_000
    const hold = calcTextAmountInCents(leads)
    const afterFreeTexts = calcTextAmountInCents(1_000)
    // More than is left after the free texts, so the sum never goes negative.
    const discount = afterFreeTexts + 1_000
    const draft = await seedReadyDraft(leads)

    await payWithPromo({
      outreachId: draft.id,
      holdInCents: hold,
      discountInCents: discount,
    })

    expect(stripe.capturePaymentIntent).not.toHaveBeenCalled()
    expect(stripe.voidHold).toHaveBeenCalledWith(INTENT_ID)
    expect(await readSatellite(draft.id)).toMatchObject({
      settleState: P2pSmsSettleState.captured,
      capturedAmountInCents: 0,
      chargeIntentId: null,
      freeTextsApplied: true,
    })
    // The send used the offer, so it stays spent.
    const after = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(after.hasFreeTextsOffer).toBe(false)
  })

  it('records a send the code covered in full with no hold and settles it at $0', async () => {
    const leads = 8_000
    const hold = calcTextAmountInCents(leads)
    const draft = await seedReadyDraft(leads)

    const res = await payWithPromo({
      outreachId: draft.id,
      holdInCents: hold,
      discountInCents: hold,
    })

    expect(res.status).toBe(201)
    expect(await readSatellite(draft.id)).toMatchObject({
      authorizationIntentId: null,
      authorizedAmountInCents: 0,
      promoDiscountInCents: hold,
      promotionCodeId: PROMO_ID,
      promoCoversTotal: true,
      settleState: P2pSmsSettleState.captured,
      capturedAmountInCents: 0,
      peerlyPhoneListId: buildId,
    })
    const spine = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: draft.id },
    })
    expect(spine).toMatchObject({
      status: OutreachStatus.pending,
      projectId: 'peerly-job-promo',
      stripeCheckoutSessionId: SESSION_ID,
    })
    expect(stripe.retrievePaymentIntent).not.toHaveBeenCalled()
    expect(stripe.capturePaymentIntent).not.toHaveBeenCalled()
    expect(stripe.voidHold).not.toHaveBeenCalled()

    // And its whole list still fits under the send cap.
    const cap = await service.app
      .get(OutreachP2pSmsCaptureService)
      .resolveSendCapForBuild(buildId)
    expect(cap).toBeGreaterThanOrEqual(leads)
  })

  it('records nothing on the satellite for a covered checkout that was never a hold', async () => {
    const leads = 8_000
    const hold = calcTextAmountInCents(leads)
    const draft = await seedReadyDraft(leads)
    const session = completedSession({
      outreachId: draft.id,
      holdInCents: hold,
      discountInCents: hold,
    })
    stripe.retrieveCheckoutSession.mockResolvedValue({
      ...session,
      metadata: { ...session.metadata, winSmsHoldBilling: '' },
    } as Stripe.Response<Stripe.Checkout.Session>)

    const res = await complete()

    expect(res.status).toBe(201)
    expect(
      await service.prisma.outreachP2pSms.findUnique({
        where: { outreachId: draft.id },
      }),
    ).toBeNull()
  })

  it('is idempotent when the webhook replays the completion', async () => {
    const leads = 8_000
    const hold = calcTextAmountInCents(leads)
    const discount = 5_000
    const draft = await seedReadyDraft(leads)
    await payWithPromo({
      outreachId: draft.id,
      holdInCents: hold,
      discountInCents: discount,
    })
    const first = await readSatellite(draft.id)
    // Stripe now reports the hold captured.
    stripe.retrievePaymentIntent.mockResolvedValue(
      intent({
        amount: hold - discount,
        status: 'succeeded',
        amount_received: hold - discount,
      }),
    )

    await service.app
      .get(OutreachPurchaseHandlerService)
      .executePostPurchase(SESSION_ID, {
        purchaseType: PurchaseType.TEXT,
        outreachType: 'p2p',
        campaignId: String(campaign.id),
        outreachId: String(draft.id),
      })

    expect(stripe.capturePaymentIntent).toHaveBeenCalledOnce()
    const second = await readSatellite(draft.id)
    expect(second).toMatchObject({
      settleState: P2pSmsSettleState.captured,
      capturedAmountInCents: first.capturedAmountInCents,
      promoDiscountInCents: discount,
      promotionCodeId: PROMO_ID,
    })
  })

  it('replays a covered completion without touching the settled row', async () => {
    const leads = 8_000
    const hold = calcTextAmountInCents(leads)
    const draft = await seedReadyDraft(leads)
    await payWithPromo({
      outreachId: draft.id,
      holdInCents: hold,
      discountInCents: hold,
    })

    const res = await complete()

    expect(res.status).toBe(201)
    expect(await readSatellite(draft.id)).toMatchObject({
      settleState: P2pSmsSettleState.captured,
      capturedAmountInCents: 0,
      promoCoversTotal: true,
    })
  })

  it('finalizes and settles a covered draft paid before its list finished building', async () => {
    const leads = 8_000
    const hold = calcTextAmountInCents(leads)
    const build = await service.prisma.peerlyPhoneList.create({
      data: {
        organizationSlug: campaign.organizationSlug,
        campaignId: campaign.id,
        buildStatus: PhoneListBuildStatus.building,
        voterFileFilterId: savedListId,
      },
    })
    const draft = await seedReadyDraft(leads)
    await service.prisma.outreach.update({
      where: { id: draft.id },
      data: { phoneListId: null },
    })
    const session = completedSession({
      outreachId: draft.id,
      holdInCents: hold,
      discountInCents: hold,
    })
    stripe.retrieveCheckoutSession.mockResolvedValue({
      ...session,
      metadata: { ...session.metadata, phoneListBuildId: build.id },
    } as Stripe.Response<Stripe.Checkout.Session>)

    const res = await complete()

    // Nothing to send to yet: the payment is recorded and the send waits for
    // the build, linked through the satellite like any pre-build hold.
    expect(res.status).toBe(201)
    expect(await readSatellite(draft.id)).toMatchObject({
      settleState: P2pSmsSettleState.authorized,
      promoCoversTotal: true,
      peerlyPhoneListId: build.id,
    })
    expect(
      await service.prisma.outreach.findUniqueOrThrow({
        where: { id: draft.id },
      }),
    ).toMatchObject({
      status: OutreachStatus.pending_payment,
      stripeCheckoutSessionId: SESSION_ID,
    })

    const readyListId = 930_002
    await service.prisma.peerlyPhoneList.update({
      where: { id: build.id },
      data: {
        buildStatus: PhoneListBuildStatus.ready,
        peerlyListId: readyListId,
        leadsLoaded: leads,
      },
    })
    const capture = service.app.get(OutreachP2pSmsCaptureService)
    await capture.finalizeDraftsForReadyList(readyListId)
    await capture.captureHoldsForReadyList(readyListId)

    expect(
      await service.prisma.outreach.findUniqueOrThrow({
        where: { id: draft.id },
      }),
    ).toMatchObject({
      status: OutreachStatus.pending,
      phoneListId: readyListId,
      projectId: 'peerly-job-promo',
    })
    expect(await readSatellite(draft.id)).toMatchObject({
      settleState: P2pSmsSettleState.captured,
      capturedAmountInCents: 0,
    })
    expect(stripe.capturePaymentIntent).not.toHaveBeenCalled()
  })

  describe('a cancel after a promo hold', () => {
    const cancel = (outreachId: number) =>
      service.app
        .get(OutreachP2pSmsCancelService)
        .cancel(outreachId, campaign.id)

    it('voids a partial-promo hold that has not been captured', async () => {
      const leads = 8_000
      const hold = calcTextAmountInCents(leads)
      const discount = 5_000
      // Not submitted yet, so capture waits and the hold stays authorized.
      vi.spyOn(
        service.app.get(PeerlyP2pJobService),
        'createPeerlyP2pJob',
      ).mockRejectedValueOnce(new Error('peerly down'))
      const draft = await seedReadyDraft(leads)
      const res = await payWithPromo({
        outreachId: draft.id,
        holdInCents: hold,
        discountInCents: discount,
      })
      // The Peerly failure reaches Stripe as a retryable error.
      expect(res.status).toBe(502)
      expect((await readSatellite(draft.id)).settleState).toBe(
        P2pSmsSettleState.authorized,
      )

      const { refunded } = await cancel(draft.id)

      expect(refunded).toBe(false)
      expect(stripe.voidHold).toHaveBeenCalledWith(INTENT_ID)
      expect((await readSatellite(draft.id)).settleState).toBe(
        P2pSmsSettleState.voided,
      )
    })

    it('refunds only what was captured off a partial-promo hold', async () => {
      const leads = 8_000
      const hold = calcTextAmountInCents(leads)
      const discount = 5_000
      const draft = await seedReadyDraft(leads)
      await payWithPromo({
        outreachId: draft.id,
        holdInCents: hold,
        discountInCents: discount,
      })
      stripe.retrievePaymentIntent.mockResolvedValue(
        intent({ status: 'succeeded', amount_received: hold - discount }),
      )
      stripe.refundCharge.mockResolvedValue({
        status: 'succeeded',
      } as unknown as Stripe.Response<Stripe.Refund>)

      const { refunded } = await cancel(draft.id)

      expect(refunded).toBe(true)
      // A charge refund with no amount returns what the charge captured.
      expect(stripe.refundCharge).toHaveBeenCalledWith(
        CHARGE_ID,
        `p2p-sms-refund-${CHARGE_ID}`,
      )
    })

    it('releases a covered send with no Stripe call and hands back the free texts', async () => {
      await service.prisma.campaign.update({
        where: { id: campaign.id },
        data: { hasFreeTextsOffer: true },
      })
      const leads = 8_000
      const hold = calcTextAmountInCents(leads)
      const draft = await seedReadyDraft(leads)
      await payWithPromo({
        outreachId: draft.id,
        holdInCents: hold,
        discountInCents: hold,
      })
      expect((await readSatellite(draft.id)).capturedAmountInCents).toBe(0)
      stripe.retrievePaymentIntent.mockClear()

      const { refunded } = await cancel(draft.id)

      expect(refunded).toBe(false)
      expect(stripe.retrievePaymentIntent).not.toHaveBeenCalled()
      expect(stripe.refundCharge).not.toHaveBeenCalled()
      expect((await readSatellite(draft.id)).settleState).toBe(
        P2pSmsSettleState.voided,
      )
      const after = await service.prisma.campaign.findUniqueOrThrow({
        where: { id: campaign.id },
      })
      expect(after.hasFreeTextsOffer).toBe(true)
      expect(
        (
          await service.prisma.outreach.findUniqueOrThrow({
            where: { id: draft.id },
          })
        ).status,
      ).toBe(OutreachStatus.canceled)
    })
  })
})
