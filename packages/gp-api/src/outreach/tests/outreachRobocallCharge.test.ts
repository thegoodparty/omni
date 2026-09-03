import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import { addDays } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Stripe from 'stripe'
import { useTestService } from '@/test-service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { OutreachRobocallService } from '@/outreach/services/outreachRobocall.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { Campaign, RobocallSettleState } from '../../generated/prisma'
import { calcRobocallTotalInCents } from '@/shared/util/robocallPricing.util'

// The CONTINGENCY upfront-charge pay path (robocall-estimate-billing branch): the
// pay endpoint charges the estimate in full up front when
// ROBOCALL_ESTIMATE_BILLING_ENABLED is set, instead of placing a hold. These
// tests exercise BOTH flag states through the SAME POST .../authorize endpoint.
const service = useTestService()

const paymentIntentsCreate = vi.fn()
const paymentIntentsCancel = vi.fn()
const paymentMethodsRetrieve = vi.fn()

let campaign: Campaign
let orgSlug: string
let filterId: number
let deriveSpy: ReturnType<typeof vi.spyOn>
let trackSpy: ReturnType<typeof vi.spyOn>

const originalFlag = process.env.ROBOCALL_ESTIMATE_BILLING_ENABLED

beforeEach(async () => {
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

  deriveSpy = vi.spyOn(
    service.app.get(OutreachRobocallService),
    'deriveBillableCount',
  )
  trackSpy = vi
    .spyOn(service.app.get(AnalyticsService), 'track')
    .mockResolvedValue(undefined as never)

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

afterEach(() => {
  if (originalFlag === undefined) {
    delete process.env.ROBOCALL_ESTIMATE_BILLING_ENABLED
  } else {
    process.env.ROBOCALL_ESTIMATE_BILLING_ENABLED = originalFlag
  }
})

const orgHeaders = () => ({ headers: { 'x-organization-slug': orgSlug } })

const createDraft = async ({
  sendInDays = 2,
  settleState = RobocallSettleState.pending_payment,
}: {
  sendInDays?: number
  settleState?: RobocallSettleState
} = {}): Promise<number> => {
  const spine = await service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: orgSlug,
      outreachType: 'robocall',
      status: 'pending_payment',
      date: addDays(new Date(), sendInDays),
      voterFileFilterId: filterId,
    },
  })
  await service.prisma.outreachRobocall.create({
    data: {
      outreachId: spine.id,
      audioKey: `robocall/995/${randomUUID()}.webm`,
      callbackNumber: '+15125550123',
      billableCount: 100,
      amountInCents: 450,
      settleState,
    },
  })
  return spine.id
}

const postAuthorize = (outreachId: number, paymentMethodId = 'pm_1') =>
  service.client.post(
    `/v1/outreach/robocall/${outreachId}/authorize`,
    { paymentMethodId },
    orgHeaders(),
  )

const readSatellite = (outreachId: number) =>
  service.prisma.outreachRobocall.findUniqueOrThrow({ where: { outreachId } })

const readSpine = (outreachId: number) =>
  service.prisma.outreach.findUniqueOrThrow({ where: { id: outreachId } })

const mockCardOnFile = () =>
  paymentMethodsRetrieve.mockResolvedValue({
    id: 'pm_1',
    customer: 'cus_test',
    type: 'card',
  })

describe('POST /authorize with ROBOCALL_ESTIMATE_BILLING_ENABLED=true', () => {
  beforeEach(() => {
    process.env.ROBOCALL_ESTIMATE_BILLING_ENABLED = 'true'
  })

  it('charges the estimate up front, settles to paid, emits one Receipt', async () => {
    const outreachId = await createDraft({ sendInDays: 2 })
    deriveSpy.mockResolvedValue(100)
    mockCardOnFile()
    paymentIntentsCreate.mockResolvedValue({
      id: 'pi_charge_1',
      status: 'succeeded',
    })

    const res = await postAuthorize(outreachId)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({
      status: 'paid',
      settleState: RobocallSettleState.paid,
      chargedAmountInCents: calcRobocallTotalInCents(100),
    })

    // Automatic capture (a charge, not a manual-capture hold), with the stable
    // estimate idempotency key.
    const createArgs = paymentIntentsCreate.mock.calls[0]
    expect(createArgs?.[0]).toMatchObject({
      amount: calcRobocallTotalInCents(100),
      currency: 'usd',
      customer: 'cus_test',
      payment_method: 'pm_1',
      capture_method: 'automatic',
      confirm: true,
      off_session: true,
    })
    expect(createArgs?.[0]?.metadata?.kind).toBe('robocall_estimate_charge')
    expect(createArgs?.[1]?.idempotencyKey).toBe(
      `robocall-estimate-charge-${outreachId}`,
    )

    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.paid)
    expect(satellite.chargeIntentId).toBe('pi_charge_1')
    expect(satellite.capturedAmountInCents).toBe(calcRobocallTotalInCents(100))
    expect(satellite.paymentMethodId).toBe('pm_1')
    expect(satellite.stripeCustomerId).toBe('cus_test')
    // No hold is placed on this path.
    expect(satellite.authorizationIntentId).toBeNull()

    // The spine advances off pending_payment so the row shows in the history.
    expect((await readSpine(outreachId)).status).toBe('pending')

    expect(trackSpy).toHaveBeenCalledTimes(1)
    const [userId, event, props, , messageId] = trackSpy.mock.calls[0] ?? []
    expect(userId).toBe(service.user.id)
    expect(event).toBe(EVENTS.Robocall.Receipt)
    expect(
      (props as { capturedAmountInDollars: number }).capturedAmountInDollars,
    ).toBe(calcRobocallTotalInCents(100) / 100)
    expect(messageId).toBe(`${outreachId}:receipt`)
  })

  it('records charge_failed (not a 502) and emails once when the card is declined', async () => {
    const outreachId = await createDraft({ sendInDays: 2 })
    deriveSpy.mockResolvedValue(100)
    mockCardOnFile()
    paymentIntentsCreate.mockRejectedValue(
      new Stripe.errors.StripeCardError({
        type: 'card_error',
        message: 'Your card was declined.',
        code: 'card_declined',
      }),
    )

    const res = await postAuthorize(outreachId)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.status).toBe('charge_failed')

    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.charge_failed)
    // A declined draft is never `paid`, so the staging/send sweeps (which key on
    // paid) can never dial it — money was never taken.
    expect(satellite.settleState).not.toBe(RobocallSettleState.paid)
    expect(satellite.capturedAmountInCents).toBeNull()
    // The spine stays hidden — a decline is not a committed send.
    expect((await readSpine(outreachId)).status).toBe('pending_payment')

    expect(trackSpy).toHaveBeenCalledTimes(1)
    const [, event, , , messageId] = trackSpy.mock.calls[0] ?? []
    expect(event).toBe(EVENTS.Robocall.ChargeFailed)
    expect(messageId).toBe(`${outreachId}:charge_failed`)
  })

  it('rejects an estimate over the per-run ceiling and takes no money', async () => {
    const outreachId = await createDraft({ sendInDays: 2 })
    // 11112 landlines → just over the $500 ceiling.
    deriveSpy.mockResolvedValue(11112)
    mockCardOnFile()

    const res = await postAuthorize(outreachId)

    expect(res.status).toBe(HttpStatus.CONFLICT)
    expect(paymentIntentsCreate).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.pending_payment,
    )
    expect((await readSpine(outreachId)).status).toBe('pending_payment')
  })

  it('reverts to pending_payment (no charge recorded) on a transient infra error', async () => {
    const outreachId = await createDraft({ sendInDays: 2 })
    deriveSpy.mockResolvedValue(100)
    mockCardOnFile()
    // A non-card error is infra → 502, revert with NO chargeIntentId so a retry
    // re-charges under the same idempotency key.
    paymentIntentsCreate.mockRejectedValue(new Error('stripe down'))

    const res = await postAuthorize(outreachId)

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.pending_payment)
    expect(satellite.chargeIntentId).toBeNull()
    expect((await readSpine(outreachId)).status).toBe('pending_payment')
  })

  it('charges exactly once under a concurrent double-call', async () => {
    const outreachId = await createDraft({ sendInDays: 2 })
    deriveSpy.mockResolvedValue(100)
    mockCardOnFile()
    paymentIntentsCreate.mockResolvedValue({
      id: 'pi_charge_1',
      status: 'succeeded',
    })

    const [a, b] = await Promise.all([
      postAuthorize(outreachId),
      postAuthorize(outreachId),
    ])

    // The claim CAS elects a single charger: exactly one PaymentIntent is
    // created even when two requests race the same draft.
    expect(paymentIntentsCreate).toHaveBeenCalledTimes(1)
    const statuses = [a.data.status, b.data.status].sort()
    // One request charges (paid); the other loses the claim and reads back the
    // live state (paid), never a second charge.
    expect(statuses).toEqual(['paid', 'paid'])
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.paid,
    )
  })

  it('is idempotent on a repeat call after a successful charge', async () => {
    const outreachId = await createDraft({ sendInDays: 2 })
    deriveSpy.mockResolvedValue(100)
    mockCardOnFile()
    paymentIntentsCreate.mockResolvedValue({
      id: 'pi_charge_1',
      status: 'succeeded',
    })

    await postAuthorize(outreachId)
    // A second call finds the draft already `paid`, so it reads back the state
    // and never charges again.
    const res = await postAuthorize(outreachId)

    expect(paymentIntentsCreate).toHaveBeenCalledTimes(1)
    expect(res.data.status).toBe('paid')
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.paid,
    )
  })

  it('a retry after a transient failure replays the FROZEN estimate + key', async () => {
    const outreachId = await createDraft({ sendInDays: 2 })
    mockCardOnFile()
    // First attempt derives 100, freezes that estimate, then the charge fails
    // transiently (infra 502) → revert to pending_payment with the estimate
    // frozen on the row.
    deriveSpy.mockResolvedValueOnce(100)
    paymentIntentsCreate.mockRejectedValueOnce(new Error('stripe down'))
    const first = await postAuthorize(outreachId)
    expect(first.status).toBe(HttpStatus.BAD_GATEWAY)

    // The billable count SHIFTS before the retry — a re-derive would now price
    // 200. The retry must NOT re-derive; it reuses the frozen 100.
    deriveSpy.mockResolvedValue(200)
    paymentIntentsCreate.mockResolvedValue({
      id: 'pi_charge_1',
      status: 'succeeded',
    })
    const second = await postAuthorize(outreachId)

    expect(second.data.status).toBe('paid')
    // Deriving happened exactly once (the first attempt); the retry reused the
    // frozen value instead of re-deriving.
    expect(deriveSpy).toHaveBeenCalledTimes(1)
    // Both charge attempts carry the SAME frozen amount under the SAME
    // idempotency key — never a divergent amount Stripe would reject as
    // keys-must-match.
    expect(paymentIntentsCreate.mock.calls[0]?.[0]?.amount).toBe(
      calcRobocallTotalInCents(100),
    )
    expect(paymentIntentsCreate.mock.calls[1]?.[0]?.amount).toBe(
      calcRobocallTotalInCents(100),
    )
    expect(paymentIntentsCreate.mock.calls[1]?.[1]?.idempotencyKey).toBe(
      `robocall-estimate-charge-${outreachId}`,
    )
    // The commit records the FROZEN estimate as captured, not a re-derived one.
    expect((await readSatellite(outreachId)).capturedAmountInCents).toBe(
      calcRobocallTotalInCents(100),
    )
  })

  it('freezes the estimate at claim and commits capturedAmountInCents from it', async () => {
    const outreachId = await createDraft({ sendInDays: 2 })
    deriveSpy.mockResolvedValue(100)
    mockCardOnFile()
    paymentIntentsCreate.mockResolvedValue({
      id: 'pi_charge_1',
      status: 'succeeded',
    })

    await postAuthorize(outreachId)

    const satellite = await readSatellite(outreachId)
    // The estimate is pinned to the frozen-estimate column at claim, and the
    // commit records capturedAmountInCents from that same frozen value.
    expect(satellite.authorizedAmountInCents).toBe(
      calcRobocallTotalInCents(100),
    )
    expect(satellite.capturedAmountInCents).toBe(calcRobocallTotalInCents(100))
  })

  it('two concurrent claims freeze the same amount and charge once', async () => {
    const outreachId = await createDraft({ sendInDays: 2 })
    deriveSpy.mockResolvedValue(100)
    mockCardOnFile()
    paymentIntentsCreate.mockResolvedValue({
      id: 'pi_charge_1',
      status: 'succeeded',
    })

    const [a, b] = await Promise.all([
      postAuthorize(outreachId),
      postAuthorize(outreachId),
    ])

    expect(paymentIntentsCreate).toHaveBeenCalledTimes(1)
    expect([a.data.status, b.data.status].sort()).toEqual(['paid', 'paid'])
    // Deterministic derivation + the single-owner claim mean both requests would
    // freeze the SAME amount; only one charges.
    const satellite = await readSatellite(outreachId)
    expect(satellite.authorizedAmountInCents).toBe(
      calcRobocallTotalInCents(100),
    )
    expect(satellite.capturedAmountInCents).toBe(calcRobocallTotalInCents(100))
  })
})

describe('POST /authorize with the flag OFF still runs the hold model', () => {
  beforeEach(() => {
    delete process.env.ROBOCALL_ESTIMATE_BILLING_ENABLED
  })

  it('places a manual-capture hold and never an automatic-capture charge', async () => {
    const outreachId = await createDraft({ sendInDays: 2 })
    deriveSpy.mockResolvedValue(100)
    mockCardOnFile()
    paymentIntentsCreate.mockResolvedValue({
      id: 'pi_hold_1',
      status: 'requires_capture',
      capture_before: Math.floor(addDays(new Date(), 7).getTime() / 1000),
    })

    const res = await postAuthorize(outreachId)

    expect(res.data.status).toBe('authorized')
    // The default model places a MANUAL-capture hold under the hold key — never
    // the automatic-capture estimate charge.
    const createArgs = paymentIntentsCreate.mock.calls[0]
    expect(createArgs?.[0]?.capture_method).toBe('manual')
    expect(createArgs?.[1]?.idempotencyKey).toBe(
      `robocall-hold-${outreachId}-1`,
    )
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.authorized)
    expect(satellite.chargeIntentId).toBeNull()
  })
})
