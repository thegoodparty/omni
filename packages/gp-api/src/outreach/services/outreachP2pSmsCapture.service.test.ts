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
import { OutreachService } from './outreach.service'
import { OutreachP2pSmsFreeTextsService } from './outreachP2pSmsFreeTexts.service'

const OUTREACH_ID = 7788
const CAMPAIGN_ID = 9911
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
    findFirst: ReturnType<typeof vi.fn>
    findUnique: ReturnType<typeof vi.fn>
    updateMany: ReturnType<typeof vi.fn>
  }
  let outreach: {
    findUnique: ReturnType<typeof vi.fn>
    findMany: ReturnType<typeof vi.fn>
    updateMany: ReturnType<typeof vi.fn>
  }
  let peerlyPhoneList: { findUnique: ReturnType<typeof vi.fn> }
  let stripe: {
    retrievePaymentIntent: ReturnType<typeof vi.fn>
    capturePaymentIntent: ReturnType<typeof vi.fn>
    voidHold: ReturnType<typeof vi.fn>
  }
  let outreachService: { finalizeOutreachPurchase: ReturnType<typeof vi.fn> }
  let freeTexts: { restore: ReturnType<typeof vi.fn> }
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
            // Submitted to Peerly (projectId stamped) — capture never bills an
            // unsent send.
            projectId: 'job-sent',
            campaign: { hasFreeTextsOffer: false },
            p2pSms: { freeTextsApplied: false },
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
    sms = {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    }
    outreach = { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() }
    peerlyPhoneList = { findUnique: vi.fn() }
    stripe = {
      retrievePaymentIntent: vi.fn(),
      capturePaymentIntent: vi.fn(),
      voidHold: vi.fn().mockResolvedValue(undefined),
    }
    outreachService = {
      finalizeOutreachPurchase: vi.fn().mockResolvedValue(undefined),
    }
    freeTexts = { restore: vi.fn().mockResolvedValue(true) }

    const moduleRef = await Test.createTestingModule({
      providers: [
        OutreachP2pSmsCaptureService,
        {
          provide: PrismaService,
          useValue: { outreachP2pSms: sms, outreach, peerlyPhoneList },
        },
        { provide: StripeService, useValue: stripe },
        { provide: OutreachService, useValue: outreachService },
        { provide: OutreachP2pSmsFreeTextsService, useValue: freeTexts },
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

  describe('resolveSendCapForBuild (send cap — never oversend)', () => {
    it('returns the paid count (max texts the hold covers) for an authorized build', async () => {
      sms.findFirst.mockResolvedValue({ authorizedAmountInCents: AUTHORIZED })

      const cap = await service.resolveSendCapForBuild(BUILD_ID)

      // The hold authorized AUTHORIZED cents = calc(500), so the cap is 500 — the
      // largest count whose price does not exceed the hold.
      expect(cap).toBe(LEADS_LOADED)
      // Found through the satellite link (peerlyPhoneListId), only for a live hold.
      expect(sms.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            peerlyPhoneListId: BUILD_ID,
            settleState: {
              in: [
                P2pSmsSettleState.authorized,
                P2pSmsSettleState.capturing,
                P2pSmsSettleState.captured,
              ],
            },
          }),
        }),
      )
    })

    it('returns the PERSISTED build cap with no hold linked yet — order-independent (cap set at session creation, before the webhook link)', async () => {
      // The oversend race: the build resolves and uploads BEFORE the payment
      // webhook links the hold to the satellite. The persisted sendCapTexts
      // (stamped at session creation) still caps it — no satellite hold needed.
      peerlyPhoneList.findUnique.mockResolvedValue({ sendCapTexts: 250 })
      sms.findFirst.mockResolvedValue(null)

      const cap = await service.resolveSendCapForBuild(BUILD_ID)

      expect(cap).toBe(250)
      // The persisted field short-circuits — the satellite is never consulted.
      expect(sms.findFirst).not.toHaveBeenCalled()
      expect(peerlyPhoneList.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: BUILD_ID } }),
      )
    })

    it('prefers the persisted build cap over the satellite hold when both exist', async () => {
      peerlyPhoneList.findUnique.mockResolvedValue({ sendCapTexts: 10 })
      sms.findFirst.mockResolvedValue({ authorizedAmountInCents: AUTHORIZED })

      expect(await service.resolveSendCapForBuild(BUILD_ID)).toBe(10)
      expect(sms.findFirst).not.toHaveBeenCalled()
    })

    it('falls back to the satellite hold when the build carries no persisted cap', async () => {
      peerlyPhoneList.findUnique.mockResolvedValue({ sendCapTexts: null })
      sms.findFirst.mockResolvedValue({ authorizedAmountInCents: AUTHORIZED })

      expect(await service.resolveSendCapForBuild(BUILD_ID)).toBe(LEADS_LOADED)
    })

    it('returns null when no cap is persisted and no hold is authorized (no cap applied)', async () => {
      peerlyPhoneList.findUnique.mockResolvedValue({ sendCapTexts: null })
      sms.findFirst.mockResolvedValue(null)
      expect(await service.resolveSendCapForBuild(BUILD_ID)).toBeNull()
    })

    it('returns null when the flag is off (inert)', async () => {
      vi.stubEnv('WIN_SMS_HOLD_BILLING', 'false')
      expect(await service.resolveSendCapForBuild(BUILD_ID)).toBeNull()
      // Flag off short-circuits before any DB read.
      expect(sms.findFirst).not.toHaveBeenCalled()
    })
  })

  it('captures from the build-ready edge (b) via the satellite link once the list is finished', async () => {
    arrange({})
    // The ready list resolves to its durable row id, then the authorized holds
    // linked to it on the satellite — not via Outreach.phoneListId.
    peerlyPhoneList.findUnique.mockResolvedValueOnce({ id: BUILD_ID })
    sms.findMany.mockResolvedValue([{ outreachId: OUTREACH_ID }])

    await service.captureHoldsForReadyList(PEERLY_LIST_ID)

    expect(peerlyPhoneList.findUnique).toHaveBeenCalledWith({
      where: { peerlyListId: PEERLY_LIST_ID },
      select: { id: true },
    })
    expect(sms.findMany).toHaveBeenCalledWith({
      where: {
        peerlyPhoneListId: BUILD_ID,
        settleState: P2pSmsSettleState.authorized,
      },
      select: { outreachId: true },
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
      // The per-send server flag is set => the free-texts offer was applied to
      // THIS send. The offer is already redeemed, so the campaign flag is off.
      outreachRow: {
        phoneListId: PEERLY_LIST_ID,
        projectId: 'job-sent',
        campaign: { hasFreeTextsOffer: false },
        p2pSms: { freeTextsApplied: true },
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

  it('does NOT discount a send whose per-send free-texts flag is unset (full price)', async () => {
    const leads = FREE_TEXTS_OFFER.COUNT + 1000
    const authorized = calcTextAmountInCents(leads)
    arrange({
      smsRow: {
        outreachId: OUTREACH_ID,
        settleState: P2pSmsSettleState.authorized,
        authorizationIntentId: INTENT_ID,
        authorizedAmountInCents: authorized,
      },
      // This send never consumed the offer (per-send flag false) and the
      // campaign has none available — full price regardless of any count.
      outreachRow: {
        phoneListId: PEERLY_LIST_ID,
        projectId: 'job-sent',
        campaign: { hasFreeTextsOffer: false },
        p2pSms: { freeTextsApplied: false },
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

  it('waits (no capture) while an eligible campaign has not yet redeemed this send', async () => {
    arrange({
      // The campaign still has the offer available AND this send has not
      // stamped the per-send flag — redemption is pending (webhook mid-flight or
      // a retry), so capture must not bill it at full price yet.
      outreachRow: {
        phoneListId: PEERLY_LIST_ID,
        projectId: 'job-sent',
        campaign: { hasFreeTextsOffer: true },
        p2pSms: { freeTextsApplied: false },
      },
    })

    await service.captureHold(OUTREACH_ID)

    // Readiness gate fails before the claim: nothing moves, the hold stays
    // authorized for a later edge/sweep once redemption finalizes.
    expect(sms.updateMany).not.toHaveBeenCalled()
    expect(stripe.capturePaymentIntent).not.toHaveBeenCalled()
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
    // A capture-time void hands the free-texts offer back (closes C1's TODO).
    expect(freeTexts.restore).toHaveBeenCalledWith(OUTREACH_ID)
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
    // A lapsed-hold void also restores the free-texts offer (closes C1's TODO).
    expect(freeTexts.restore).toHaveBeenCalledWith(OUTREACH_ID)
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

  it('does not capture a send that has not been submitted to Peerly (no projectId)', async () => {
    // Build ready + hold authorized, but the send never went out (finalize
    // failed): the hold must stay authorized, never charged, so the finalize
    // backstop can re-send it.
    arrange({
      outreachRow: {
        phoneListId: PEERLY_LIST_ID,
        projectId: null,
        campaign: { hasFreeTextsOffer: false },
        p2pSms: { freeTextsApplied: false },
      },
    })

    await service.captureHold(OUTREACH_ID)

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

    // Flag-off kill switch on a row stranded mid-settlement (a rollback).
    const arrangeStaleRecovery = (intent: Stripe.PaymentIntent) => {
      vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'prod')
      // No authorized candidates; one stale `capturing` row to recover.
      sms.findMany.mockImplementation(
        (args: { where?: { settleState?: P2pSmsSettleState } }) =>
          Promise.resolve(
            args?.where?.settleState === P2pSmsSettleState.capturing
              ? [{ outreachId: OUTREACH_ID }]
              : [],
          ),
      )
      sms.updateMany.mockResolvedValue({ count: 1 })
      sms.findUnique.mockResolvedValue({
        outreachId: OUTREACH_ID,
        settleState: P2pSmsSettleState.capturing,
        authorizationIntentId: INTENT_ID,
        authorizedAmountInCents: AUTHORIZED,
      })
      outreach.findUnique.mockResolvedValue({
        phoneListId: PEERLY_LIST_ID,
        projectId: 'job-sent',
        campaign: { hasFreeTextsOffer: false },
        p2pSms: { freeTextsApplied: false },
      })
      peerlyPhoneList.findUnique.mockResolvedValue({
        id: BUILD_ID,
        buildStatus: 'ready',
        leadsLoaded: LEADS_LOADED,
      })
      stripe.retrievePaymentIntent.mockResolvedValue(intent)
    }

    it('flag off: reconciles a stale succeeded PI (records the capture that already happened)', async () => {
      vi.stubEnv('WIN_SMS_HOLD_BILLING', 'false')
      arrangeStaleRecovery(
        mockIntent({ status: 'succeeded', amount_received: 777 }),
      )

      await service.sweepCaptures()

      expect(stripe.capturePaymentIntent).not.toHaveBeenCalled()
      expect(settingState()(P2pSmsSettleState.captured)?.data).toMatchObject({
        capturedAmountInCents: 777,
      })
    })

    it('flag off: does NOT fresh-capture a stale requires_capture PI (reverts to authorized)', async () => {
      vi.stubEnv('WIN_SMS_HOLD_BILLING', 'false')
      arrangeStaleRecovery(mockIntent({ status: 'requires_capture' }))

      await service.sweepCaptures()

      expect(stripe.capturePaymentIntent).not.toHaveBeenCalled()
      expect(settingState()(P2pSmsSettleState.captured)).toBeUndefined()
      expect(settingState()(P2pSmsSettleState.authorized)).toBeDefined()
    })

    it('backstop re-finalizes a pre-build draft stranded past the build-ready edge', async () => {
      vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'prod')
      // One authorized candidate; no stale capturing rows.
      sms.findMany.mockImplementation(
        (args: { where?: { settleState?: P2pSmsSettleState } }) =>
          Promise.resolve(
            args?.where?.settleState === P2pSmsSettleState.authorized
              ? [{ outreachId: OUTREACH_ID }]
              : [],
          ),
      )
      // Its build is ready, so the capture half settles too.
      sms.findUnique.mockResolvedValue({
        outreachId: OUTREACH_ID,
        settleState: P2pSmsSettleState.authorized,
        authorizationIntentId: INTENT_ID,
        authorizedAmountInCents: AUTHORIZED,
      })
      sms.updateMany.mockResolvedValue({ count: 1 })
      stripe.retrievePaymentIntent.mockResolvedValue(mockIntent())
      stripe.capturePaymentIntent.mockResolvedValue(
        mockIntent({ status: 'succeeded', amount_received: AUTHORIZED }),
      )
      // A pre-build draft: paid, still pending_payment, phoneListId not stamped.
      outreach.findUnique.mockResolvedValue({
        id: OUTREACH_ID,
        campaignId: CAMPAIGN_ID,
        status: 'pending_payment',
        phoneListId: null,
        stripeCheckoutSessionId: 'cs_paid',
        p2pSms: { peerlyPhoneListId: BUILD_ID },
        // Fields the capture half reads once phoneListId is stamped.
        campaign: { hasFreeTextsOffer: false },
      })
      peerlyPhoneList.findUnique.mockResolvedValue({
        id: BUILD_ID,
        peerlyListId: PEERLY_LIST_ID,
        buildStatus: 'ready',
        leadsLoaded: LEADS_LOADED,
      })

      await service.sweepCaptures()

      expect(outreach.updateMany).toHaveBeenCalledWith({
        where: { id: OUTREACH_ID, phoneListId: null },
        data: { phoneListId: PEERLY_LIST_ID },
      })
      expect(outreachService.finalizeOutreachPurchase).toHaveBeenCalledWith(
        OUTREACH_ID,
        CAMPAIGN_ID,
        'cs_paid',
      )
    })
  })

  describe('finalizeDraftsForReadyList (build-ready finalize edge)', () => {
    // A pre-build draft: paid (recorded session), still pending_payment, with no
    // numeric phoneListId yet, linked to the just-ready build on the satellite.
    const arrangePreBuildDraft = (
      overrides: Record<string, unknown> = {},
    ): void => {
      peerlyPhoneList.findUnique.mockImplementation(
        (args: { where?: { peerlyListId?: number; id?: string } }) =>
          Promise.resolve(
            args?.where?.id === BUILD_ID ||
              args?.where?.peerlyListId === PEERLY_LIST_ID
              ? {
                  id: BUILD_ID,
                  peerlyListId: PEERLY_LIST_ID,
                  buildStatus: 'ready',
                  leadsLoaded: LEADS_LOADED,
                }
              : null,
          ),
      )
      sms.findMany.mockResolvedValue([{ outreachId: OUTREACH_ID }])
      outreach.findUnique.mockResolvedValue({
        id: OUTREACH_ID,
        campaignId: CAMPAIGN_ID,
        status: 'pending_payment',
        phoneListId: null,
        stripeCheckoutSessionId: 'cs_paid',
        p2pSms: { peerlyPhoneListId: BUILD_ID },
        ...overrides,
      })
    }

    it('stamps the numeric list id and finalizes a paid pre-build draft', async () => {
      arrangePreBuildDraft()

      await service.finalizeDraftsForReadyList(PEERLY_LIST_ID)

      expect(sms.findMany).toHaveBeenCalledWith({
        where: {
          peerlyPhoneListId: BUILD_ID,
          settleState: P2pSmsSettleState.authorized,
        },
        select: { outreachId: true },
      })
      expect(outreach.updateMany).toHaveBeenCalledWith({
        where: { id: OUTREACH_ID, phoneListId: null },
        data: { phoneListId: PEERLY_LIST_ID },
      })
      expect(outreachService.finalizeOutreachPurchase).toHaveBeenCalledWith(
        OUTREACH_ID,
        CAMPAIGN_ID,
        'cs_paid',
      )
    })

    it('does not re-finalize a draft already past pending_payment (build-before-pay)', async () => {
      arrangePreBuildDraft({
        status: 'in_progress',
        phoneListId: PEERLY_LIST_ID,
      })

      await service.finalizeDraftsForReadyList(PEERLY_LIST_ID)

      expect(outreach.updateMany).not.toHaveBeenCalled()
      expect(outreachService.finalizeOutreachPurchase).not.toHaveBeenCalled()
    })

    it('does not finalize a never-paid draft (no recorded checkout session)', async () => {
      arrangePreBuildDraft({ stripeCheckoutSessionId: null })

      await service.finalizeDraftsForReadyList(PEERLY_LIST_ID)

      expect(outreachService.finalizeOutreachPurchase).not.toHaveBeenCalled()
    })

    it('is inert when the flag is off', async () => {
      vi.stubEnv('WIN_SMS_HOLD_BILLING', 'false')
      arrangePreBuildDraft()

      await service.finalizeDraftsForReadyList(PEERLY_LIST_ID)

      expect(sms.findMany).not.toHaveBeenCalled()
      expect(outreachService.finalizeOutreachPurchase).not.toHaveBeenCalled()
    })
  })
})
