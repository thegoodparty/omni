import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'
import { getUnixTime } from 'date-fns'
import Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaService } from '@/prisma/prisma.service'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { firstOrThrow } from 'src/shared/test-utils/arrays.util'
import { StripeService } from 'src/vendors/stripe/services/stripe.service'
import { P2pSmsSettleState } from 'src/generated/prisma'
import { OutreachP2pSmsHoldService } from './outreachP2pSmsHold.service'

const OUTREACH_ID = 7788
const SESSION_ID = 'cs_test_hold'
const INTENT_ID = 'pi_test_hold'

// A manual-capture hold completes at requires_capture; amount is the authorized
// (undiscounted) estimate in cents.
const mockIntent = (
  overrides: Partial<Stripe.PaymentIntent> = {},
): Stripe.PaymentIntent =>
  ({
    id: INTENT_ID,
    object: 'payment_intent',
    status: 'requires_capture',
    amount: 10500,
    ...overrides,
  }) as Stripe.PaymentIntent

describe('OutreachP2pSmsHoldService.recordHold', () => {
  let service: OutreachP2pSmsHoldService
  let model: {
    upsert: ReturnType<typeof vi.fn>
    updateMany: ReturnType<typeof vi.fn>
  }
  let peerlyPhoneList: {
    findUnique: ReturnType<typeof vi.fn>
    findFirst: ReturnType<typeof vi.fn>
  }
  let stripe: {
    retrieveCheckoutSession: ReturnType<typeof vi.fn>
    retrievePaymentIntent: ReturnType<typeof vi.fn>
  }

  // The args of the single updateMany call whose data would set `authorized`,
  // or undefined if no such call was made. (A call with count 0 is still a call
  // — the CAS guard, not the data, is what makes it a no-op on a replay.)
  const authorizedCall = () =>
    model.updateMany.mock.calls
      .map((call) => call[0])
      .find((args) => args?.data?.settleState === P2pSmsSettleState.authorized)

  beforeEach(async () => {
    model = { upsert: vi.fn(), updateMany: vi.fn() }
    peerlyPhoneList = { findUnique: vi.fn(), findFirst: vi.fn() }
    stripe = {
      retrieveCheckoutSession: vi
        .fn()
        .mockResolvedValue({ payment_intent: INTENT_ID }),
      retrievePaymentIntent: vi.fn().mockResolvedValue(mockIntent()),
    }

    const moduleRef = await Test.createTestingModule({
      providers: [
        OutreachP2pSmsHoldService,
        {
          provide: PrismaService,
          useValue: { outreachP2pSms: model, peerlyPhoneList },
        },
        { provide: StripeService, useValue: stripe },
        { provide: PinoLogger, useValue: createMockLogger() },
      ],
    }).compile()

    service = moduleRef.get(OutreachP2pSmsHoldService)
  })

  it('stamps authorized with the live intent id and amount on requires_capture', async () => {
    const captureBefore = getUnixTime(new Date('2026-02-01T00:00:00Z'))
    stripe.retrievePaymentIntent.mockResolvedValue(
      mockIntent({
        // capture_before is returned on a manual-capture auth but absent from
        // the SDK type.
        ...({ capture_before: captureBefore } as Partial<Stripe.PaymentIntent>),
      }),
    )
    model.updateMany.mockResolvedValue({ count: 1 })

    await service.recordHold({
      outreachId: OUTREACH_ID,
      checkoutSessionId: SESSION_ID,
    })

    const stamp = authorizedCall()
    expect(stamp?.data).toMatchObject({
      settleState: P2pSmsSettleState.authorized,
      authorizationIntentId: INTENT_ID,
      authorizedAmountInCents: 10500,
    })
    expect(stamp?.data?.captureBefore).toEqual(new Date('2026-02-01T00:00:00Z'))
  })

  it('links the satellite to its building phone list from the upload token', async () => {
    model.updateMany.mockResolvedValue({ count: 1 })
    peerlyPhoneList.findUnique.mockResolvedValue({ id: 'ppl-uuid-9' })

    await service.recordHold({
      outreachId: OUTREACH_ID,
      checkoutSessionId: SESSION_ID,
      phoneListToken: 'tok-xyz',
    })

    expect(peerlyPhoneList.findUnique).toHaveBeenCalledWith({
      where: { token: 'tok-xyz' },
      select: { id: true },
    })
    // The link is its OWN idempotent update (guarded on peerlyPhoneListId null),
    // separate from the authorize CAS, so a replay whose token now resolves can
    // backfill a link an earlier authorize left unset.
    const linkCall = model.updateMany.mock.calls
      .map((call) => call[0])
      .find((args) => args?.data?.peerlyPhoneListId === 'ppl-uuid-9')
    expect(linkCall?.where).toMatchObject({
      outreachId: OUTREACH_ID,
      peerlyPhoneListId: null,
    })
    expect(authorizedCall()?.data).not.toHaveProperty('peerlyPhoneListId')
  })

  it('backfills the link on a replay even when the authorize CAS no-ops (already authorized)', async () => {
    // Replay: the row is already past pending_payment, so the authorize CAS
    // matches nothing (count 0) — but the separate link update still backfills a
    // peerlyPhoneListId an earlier, token-less authorize left null.
    model.updateMany.mockResolvedValue({ count: 0 })
    peerlyPhoneList.findUnique.mockResolvedValue({ id: 'ppl-uuid-9' })

    await service.recordHold({
      outreachId: OUTREACH_ID,
      checkoutSessionId: SESSION_ID,
      phoneListToken: 'tok-xyz',
    })

    const linkCall = model.updateMany.mock.calls
      .map((call) => call[0])
      .find((args) => args?.data?.peerlyPhoneListId === 'ppl-uuid-9')
    expect(linkCall?.where).toMatchObject({
      outreachId: OUTREACH_ID,
      peerlyPhoneListId: null,
    })
  })

  it('leaves the satellite unlinked (no peerlyPhoneListId) when the token resolves to nothing', async () => {
    model.updateMany.mockResolvedValue({ count: 1 })
    peerlyPhoneList.findUnique.mockResolvedValue(null)

    await service.recordHold({
      outreachId: OUTREACH_ID,
      checkoutSessionId: SESSION_ID,
      phoneListToken: 'tok-unknown',
    })

    // The hold is still authorized; peerlyPhoneListId is simply omitted so the
    // CAS does not overwrite it with null.
    const stamp = authorizedCall()
    expect(stamp?.data?.settleState).toBe(P2pSmsSettleState.authorized)
    expect(stamp?.data).not.toHaveProperty('peerlyPhoneListId')
  })

  it('does not look up a phone list when no token is supplied', async () => {
    model.updateMany.mockResolvedValue({ count: 1 })

    await service.recordHold({
      outreachId: OUTREACH_ID,
      checkoutSessionId: SESSION_ID,
    })

    expect(peerlyPhoneList.findUnique).not.toHaveBeenCalled()
    expect(authorizedCall()?.data).not.toHaveProperty('peerlyPhoneListId')
  })

  // --- ASYNC build (slice G): link by the build id when the async build had no
  // token. The id is client-supplied, so the lookup is scoped to the campaign.

  it('links the satellite by build id (scoped to the campaign) when there is no token', async () => {
    model.updateMany.mockResolvedValue({ count: 1 })
    peerlyPhoneList.findFirst.mockResolvedValue({ id: 'build-xyz' })

    await service.recordHold({
      outreachId: OUTREACH_ID,
      checkoutSessionId: SESSION_ID,
      phoneListBuildId: 'build-xyz',
      campaignId: 111,
    })

    // Scoped to the campaign — a client-supplied id can only link its own
    // campaign's list — and the token lookup is never attempted.
    expect(peerlyPhoneList.findFirst).toHaveBeenCalledWith({
      where: { id: 'build-xyz', campaignId: 111 },
      select: { id: true },
    })
    expect(peerlyPhoneList.findUnique).not.toHaveBeenCalled()
    const linkCall = model.updateMany.mock.calls
      .map((call) => call[0])
      .find((args) => args?.data?.peerlyPhoneListId === 'build-xyz')
    expect(linkCall?.where).toMatchObject({
      outreachId: OUTREACH_ID,
      peerlyPhoneListId: null,
    })
  })

  it('leaves the satellite unlinked when the build id does not belong to the campaign', async () => {
    model.updateMany.mockResolvedValue({ count: 1 })
    // The {id, campaignId} lookup finds nothing — an unowned id.
    peerlyPhoneList.findFirst.mockResolvedValue(null)

    await service.recordHold({
      outreachId: OUTREACH_ID,
      checkoutSessionId: SESSION_ID,
      phoneListBuildId: 'build-foreign',
      campaignId: 111,
    })

    const stamp = authorizedCall()
    expect(stamp?.data?.settleState).toBe(P2pSmsSettleState.authorized)
    expect(stamp?.data).not.toHaveProperty('peerlyPhoneListId')
  })

  it('does not link by build id when no campaign is supplied (no ownership proof)', async () => {
    model.updateMany.mockResolvedValue({ count: 1 })

    await service.recordHold({
      outreachId: OUTREACH_ID,
      checkoutSessionId: SESSION_ID,
      phoneListBuildId: 'build-xyz',
    })

    expect(peerlyPhoneList.findFirst).not.toHaveBeenCalled()
    expect(authorizedCall()?.data).not.toHaveProperty('peerlyPhoneListId')
  })

  it('prefers the token over a build id when both are supplied', async () => {
    model.updateMany.mockResolvedValue({ count: 1 })
    peerlyPhoneList.findUnique.mockResolvedValue({ id: 'ppl-from-token' })

    await service.recordHold({
      outreachId: OUTREACH_ID,
      checkoutSessionId: SESSION_ID,
      phoneListToken: 'tok-xyz',
      phoneListBuildId: 'build-xyz',
      campaignId: 111,
    })

    expect(peerlyPhoneList.findUnique).toHaveBeenCalledWith({
      where: { token: 'tok-xyz' },
      select: { id: true },
    })
    expect(peerlyPhoneList.findFirst).not.toHaveBeenCalled()
    const linkCall = model.updateMany.mock.calls
      .map((call) => call[0])
      .find((args) => args?.data?.peerlyPhoneListId === 'ppl-from-token')
    expect(linkCall?.where).toMatchObject({ outreachId: OUTREACH_ID })
  })

  it('stamps straight from pending_payment via a single CAS (no hold_pending)', async () => {
    model.updateMany.mockResolvedValue({ count: 1 })

    await service.recordHold({
      outreachId: OUTREACH_ID,
      checkoutSessionId: SESSION_ID,
    })

    // Exactly one DB transition, guarded on the exact prior state, straight to
    // authorized — never a hold_pending intermediate that could strand.
    expect(model.updateMany).toHaveBeenCalledTimes(1)
    expect(firstOrThrow(model.updateMany.mock.calls)[0]).toMatchObject({
      where: {
        outreachId: OUTREACH_ID,
        settleState: P2pSmsSettleState.pending_payment,
        authorizationIntentId: null,
      },
      data: { settleState: P2pSmsSettleState.authorized },
    })
  })

  it('records hold_failed, not authorized, when the PI is confirmed but not requires_capture', async () => {
    stripe.retrievePaymentIntent.mockResolvedValue(
      mockIntent({ status: 'processing' }),
    )
    model.updateMany.mockResolvedValue({ count: 1 })

    await service.recordHold({
      outreachId: OUTREACH_ID,
      checkoutSessionId: SESSION_ID,
    })

    expect(authorizedCall()).toBeUndefined()
    expect(firstOrThrow(model.updateMany.mock.calls)[0]).toMatchObject({
      where: {
        outreachId: OUTREACH_ID,
        settleState: P2pSmsSettleState.pending_payment,
        authorizationIntentId: null,
      },
      data: { settleState: P2pSmsSettleState.hold_failed },
    })
  })

  it('does not place a second hold when the row already advanced (replay / second session)', async () => {
    // The row is already past pending_payment, so the single-owner CAS matches
    // nothing and updates zero rows.
    model.updateMany.mockResolvedValue({ count: 0 })

    await service.recordHold({
      outreachId: OUTREACH_ID,
      checkoutSessionId: SESSION_ID,
    })

    // Exactly one guarded write, and it is a no-op (count 0) — no second hold
    // is recorded and no retry re-writes.
    expect(model.updateMany).toHaveBeenCalledTimes(1)
    expect(authorizedCall()?.where).toMatchObject({
      settleState: P2pSmsSettleState.pending_payment,
      authorizationIntentId: null,
    })
  })

  it('records nothing when the completed session carries no PaymentIntent', async () => {
    stripe.retrieveCheckoutSession.mockResolvedValue({ payment_intent: null })

    await service.recordHold({
      outreachId: OUTREACH_ID,
      checkoutSessionId: SESSION_ID,
    })

    expect(model.upsert).not.toHaveBeenCalled()
    expect(model.updateMany).not.toHaveBeenCalled()
    expect(stripe.retrievePaymentIntent).not.toHaveBeenCalled()
  })
})
