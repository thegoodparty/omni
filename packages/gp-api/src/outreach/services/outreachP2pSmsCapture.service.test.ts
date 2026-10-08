import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'
import Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaService } from '@/prisma/prisma.service'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { StripeService } from 'src/vendors/stripe/services/stripe.service'
import { calcTextAmountInCents } from 'src/shared/util/textPricing.util'
import { FREE_TEXTS_OFFER } from 'src/shared/constants/freeTextsOffer'
import { P2pSmsSettleState } from 'src/generated/prisma'
import { OutreachP2pSmsCaptureService } from './outreachP2pSmsCapture.service'

const OUTREACH_ID = 7788
const PEERLY_LIST_ID = 42
const BUILD_ID = 'build-1'
const INTENT_ID = 'pi_test'
const LEADS_LOADED = 500
// The undiscounted hold Stripe authorized — the price of all leads.
const AUTHORIZED = calcTextAmountInCents(LEADS_LOADED)

const mockIntent = (
  overrides: Partial<Stripe.PaymentIntent> = {},
): Stripe.PaymentIntent =>
  ({
    id: INTENT_ID,
    object: 'payment_intent',
    status: 'requires_capture',
    amount: AUTHORIZED,
    latest_charge: 'ch_test',
    ...overrides,
  }) as Stripe.PaymentIntent

// The updateMany call whose data would set a given settleState, or undefined.
const callSetting =
  (model: { updateMany: ReturnType<typeof vi.fn> }) =>
  (state: P2pSmsSettleState) =>
    model.updateMany.mock.calls
      .map((call) => call[0])
      .find((args) => args?.data?.settleState === state)

describe('OutreachP2pSmsCaptureService', () => {
  let service: OutreachP2pSmsCaptureService
  let sms: {
    findMany: ReturnType<typeof vi.fn>
    findUnique: ReturnType<typeof vi.fn>
    updateMany: ReturnType<typeof vi.fn>
  }
  let outreach: {
    findUnique: ReturnType<typeof vi.fn>
    findMany: ReturnType<typeof vi.fn>
  }
  let peerlyPhoneList: { findUnique: ReturnType<typeof vi.fn> }
  let stripe: {
    retrievePaymentIntent: ReturnType<typeof vi.fn>
    capturePaymentIntent: ReturnType<typeof vi.fn>
    voidHold: ReturnType<typeof vi.fn>
  }
  const settingState = () => callSetting(sms)

  // Authorized hold + ready build with a stable count — the rendezvous
  // complete, the live PI capturable. Individual tests override pieces.
  const arrange = (opts: {
    smsRow?: Record<string, unknown> | null
    build?: Record<string, unknown> | null
    outreachRow?: Record<string, unknown> | null
    claimCount?: number
    intent?: Stripe.PaymentIntent
  }) => {
    sms.findUnique.mockResolvedValue(
      opts.smsRow === undefined
        ? {
            outreachId: OUTREACH_ID,
            settleState: P2pSmsSettleState.authorized,
            authorizationIntentId: INTENT_ID,
            authorizedAmountInCents: AUTHORIZED,
          }
        : opts.smsRow,
    )
    outreach.findUnique.mockResolvedValue(
      opts.outreachRow === undefined
        ? {
            phoneListId: PEERLY_LIST_ID,
            textCount: null,
            billableTextCount: null,
          }
        : opts.outreachRow,
    )
    peerlyPhoneList.findUnique.mockResolvedValue(
      opts.build === undefined
        ? {
            id: BUILD_ID,
            buildStatus: 'ready',
            leadsLoaded: LEADS_LOADED,
          }
        : opts.build,
    )
    sms.updateMany.mockResolvedValue({ count: opts.claimCount ?? 1 })
    stripe.retrievePaymentIntent.mockResolvedValue(opts.intent ?? mockIntent())
    stripe.capturePaymentIntent.mockResolvedValue(
      mockIntent({ status: 'succeeded', amount_received: AUTHORIZED }),
    )
  }

  beforeEach(async () => {
    vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
    sms = { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() }
    outreach = { findUnique: vi.fn(), findMany: vi.fn() }
    peerlyPhoneList = { findUnique: vi.fn() }
    stripe = {
      retrievePaymentIntent: vi.fn(),
      capturePaymentIntent: vi.fn(),
      voidHold: vi.fn().mockResolvedValue(undefined),
    }

    const moduleRef = await Test.createTestingModule({
      providers: [
        OutreachP2pSmsCaptureService,
        {
          provide: PrismaService,
          useValue: { outreachP2pSms: sms, outreach, peerlyPhoneList },
        },
        { provide: StripeService, useValue: stripe },
        { provide: PinoLogger, useValue: createMockLogger() },
      ],
    }).compile()

    service = moduleRef.get(OutreachP2pSmsCaptureService)
  })

  it('captures an authorized + ready hold from the post-hold edge (a)', async () => {
    arrange({})

    await service.captureHold(OUTREACH_ID)

    expect(stripe.capturePaymentIntent).toHaveBeenCalledWith(
      INTENT_ID,
      AUTHORIZED,
      `p2p-sms-capture-${OUTREACH_ID}`,
    )
    expect(settingState()(P2pSmsSettleState.captured)?.data).toMatchObject({
      capturedAmountInCents: AUTHORIZED,
      chargeIntentId: 'ch_test',
      peerlyPhoneListId: BUILD_ID,
    })
  })

  it('captures from the build-ready edge (b) once the list is finished', async () => {
    arrange({})
    outreach.findMany.mockResolvedValue([{ id: OUTREACH_ID }])

    await service.captureHoldsForReadyList(PEERLY_LIST_ID)

    expect(outreach.findMany).toHaveBeenCalledWith({
      where: {
        phoneListId: PEERLY_LIST_ID,
        p2pSms: { settleState: P2pSmsSettleState.authorized },
      },
      select: { id: true },
    })
    expect(stripe.capturePaymentIntent).toHaveBeenCalledOnce()
    expect(settingState()(P2pSmsSettleState.captured)).toBeDefined()
  })

  it('clamps the capture to the authorized hold when the computed amount is higher', async () => {
    // A bigger list than the hold was placed for: discounted > authorized.
    peerlyPhoneList.findUnique.mockResolvedValue({
      id: BUILD_ID,
      buildStatus: 'ready',
      leadsLoaded: LEADS_LOADED * 10,
    })
    arrange({
      build: {
        id: BUILD_ID,
        buildStatus: 'ready',
        leadsLoaded: LEADS_LOADED * 10,
      },
    })

    await service.captureHold(OUTREACH_ID)

    // Never above the hold: clamped to the authorized amount.
    expect(stripe.capturePaymentIntent).toHaveBeenCalledWith(
      INTENT_ID,
      AUTHORIZED,
      `p2p-sms-capture-${OUTREACH_ID}`,
    )
  })

  it('captures the discounted amount (below the hold) when the free-texts offer applied', async () => {
    const leads = FREE_TEXTS_OFFER.COUNT + 1000
    const authorized = calcTextAmountInCents(leads)
    const discounted = calcTextAmountInCents(leads - FREE_TEXTS_OFFER.COUNT)
    arrange({
      smsRow: {
        outreachId: OUTREACH_ID,
        settleState: P2pSmsSettleState.authorized,
        authorizationIntentId: INTENT_ID,
        authorizedAmountInCents: authorized,
      },
      // billableTextCount < textCount AND the campaign redeemed an offer =>
      // the free-texts offer was applied to this send.
      outreachRow: {
        phoneListId: PEERLY_LIST_ID,
        textCount: leads,
        billableTextCount: leads - FREE_TEXTS_OFFER.COUNT,
        campaign: { freeTextsOfferRedeemedAt: new Date('2026-01-01') },
      },
      build: { id: BUILD_ID, buildStatus: 'ready', leadsLoaded: leads },
    })

    await service.captureHold(OUTREACH_ID)

    expect(discounted).toBeLessThan(authorized)
    expect(stripe.capturePaymentIntent).toHaveBeenCalledWith(
      INTENT_ID,
      discounted,
      `p2p-sms-capture-${OUTREACH_ID}`,
    )
  })

  it('does NOT discount when the count is reduced but the campaign never redeemed an offer', async () => {
    const leads = FREE_TEXTS_OFFER.COUNT + 1000
    const authorized = calcTextAmountInCents(leads)
    arrange({
      smsRow: {
        outreachId: OUTREACH_ID,
        settleState: P2pSmsSettleState.authorized,
        authorizationIntentId: INTENT_ID,
        authorizedAmountInCents: authorized,
      },
      // A spoofed reduced billableTextCount, but no redeemed offer on the
      // campaign — the guard blocks the discount, so the full hold is captured.
      outreachRow: {
        phoneListId: PEERLY_LIST_ID,
        textCount: leads,
        billableTextCount: leads - FREE_TEXTS_OFFER.COUNT,
        campaign: { freeTextsOfferRedeemedAt: null },
      },
      build: { id: BUILD_ID, buildStatus: 'ready', leadsLoaded: leads },
    })

    await service.captureHold(OUTREACH_ID)

    expect(stripe.capturePaymentIntent).toHaveBeenCalledWith(
      INTENT_ID,
      authorized,
      `p2p-sms-capture-${OUTREACH_ID}`,
    )
  })

  it('voids (does not capture) when the final amount is below the Stripe floor', async () => {
    // Everything scrubbed / free: zero billable leads.
    arrange({
      build: { id: BUILD_ID, buildStatus: 'ready', leadsLoaded: 0 },
    })

    await service.captureHold(OUTREACH_ID)

    expect(stripe.capturePaymentIntent).not.toHaveBeenCalled()
    expect(stripe.voidHold).toHaveBeenCalledWith(INTENT_ID)
    expect(settingState()(P2pSmsSettleState.voided)).toBeDefined()
  })

  it('reconciles an already-succeeded PI without a second capture', async () => {
    arrange({
      intent: mockIntent({ status: 'succeeded', amount_received: 999 }),
    })

    await service.captureHold(OUTREACH_ID)

    expect(stripe.capturePaymentIntent).not.toHaveBeenCalled()
    expect(settingState()(P2pSmsSettleState.captured)?.data).toMatchObject({
      capturedAmountInCents: 999,
    })
  })

  it('parks a lapsed/canceled hold voided, never blind-charging', async () => {
    arrange({ intent: mockIntent({ status: 'canceled' }) })

    await service.captureHold(OUTREACH_ID)

    expect(stripe.capturePaymentIntent).not.toHaveBeenCalled()
    expect(stripe.voidHold).not.toHaveBeenCalled()
    expect(settingState()(P2pSmsSettleState.voided)).toBeDefined()
  })

  it('reverts to authorized (no terminal) when the capture call fails', async () => {
    arrange({})
    stripe.capturePaymentIntent.mockRejectedValue(new Error('stripe down'))

    await service.captureHold(OUTREACH_ID)

    expect(settingState()(P2pSmsSettleState.captured)).toBeUndefined()
    // Reverted so a later sweep retries.
    expect(settingState()(P2pSmsSettleState.authorized)).toBeDefined()
  })

  it('is a no-op replay when the claim loses the race (already capturing)', async () => {
    arrange({ claimCount: 0 })

    await service.captureHold(OUTREACH_ID)

    // Claimed nothing: never read the PI, never captured, never settled.
    expect(sms.findUnique).not.toHaveBeenCalled()
    expect(stripe.retrievePaymentIntent).not.toHaveBeenCalled()
    expect(stripe.capturePaymentIntent).not.toHaveBeenCalled()
  })

  it('does not capture while the build is not yet ready', async () => {
    arrange({
      build: { id: BUILD_ID, buildStatus: 'processing', leadsLoaded: null },
    })

    await service.captureHold(OUTREACH_ID)

    // Readiness gate fails before the claim: nothing moves.
    expect(sms.updateMany).not.toHaveBeenCalled()
    expect(stripe.capturePaymentIntent).not.toHaveBeenCalled()
  })

  it('writes and moves nothing when the flag is off', async () => {
    vi.stubEnv('WIN_SMS_HOLD_BILLING', 'false')
    arrange({})

    await service.captureHold(OUTREACH_ID)
    await service.captureHoldsForReadyList(PEERLY_LIST_ID)

    expect(outreach.findUnique).not.toHaveBeenCalled()
    expect(outreach.findMany).not.toHaveBeenCalled()
    expect(sms.updateMany).not.toHaveBeenCalled()
    expect(stripe.capturePaymentIntent).not.toHaveBeenCalled()
    expect(stripe.voidHold).not.toHaveBeenCalled()
  })

  describe('sweepCaptures', () => {
    it('skips entirely off dev/prod (never touches the DB)', async () => {
      vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'preview')

      await service.sweepCaptures()

      expect(sms.findMany).not.toHaveBeenCalled()
    })

    it('selects only authorized holds past the grace window, expiry-first', async () => {
      vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'prod')
      sms.findMany.mockResolvedValue([])

      await service.sweepCaptures()

      // Backstop candidates: authorized AND older than the grace floor, so it
      // never races the recording webhook's own discount stamp + inline
      // capture; nearest-expiry first so none lapse under a backlog.
      const authorizedSelect = sms.findMany.mock.calls
        .map((call) => call[0])
        .find(
          (args) => args?.where?.settleState === P2pSmsSettleState.authorized,
        )
      expect(authorizedSelect?.where?.updatedAt?.lt).toBeInstanceOf(Date)
      expect(authorizedSelect?.orderBy).toMatchObject({ captureBefore: 'asc' })
    })
  })
})
