import { addHours, subMinutes } from 'date-fns'
import type Stripe from 'stripe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { OutreachP2pSmsReconcileService } from '@/outreach/services/outreachP2pSmsReconcile.service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import {
  Campaign,
  OutreachStatus,
  P2pSmsSettleState,
} from '../../generated/prisma'

const service = useTestService()

let reconcile: OutreachP2pSmsReconcileService
let retrieveSpy: ReturnType<typeof vi.spyOn>
let refundChargeSpy: ReturnType<typeof vi.spyOn>
let listRefundsSpy: ReturnType<typeof vi.spyOn>
let voidSpy: ReturnType<typeof vi.spyOn>

let campaign: Campaign
let orgSlug: string
let filterId: number

const INTENT_ID = 'pi_hold_1'
const CHARGE_ID = 'ch_hold_1'

const mockIntent = (
  overrides: Partial<Stripe.PaymentIntent> = {},
): Stripe.Response<Stripe.PaymentIntent> =>
  ({
    id: INTENT_ID,
    object: 'payment_intent',
    status: 'succeeded',
    amount: 5000,
    latest_charge: CHARGE_ID,
    ...overrides,
  }) as unknown as Stripe.Response<Stripe.PaymentIntent>

const refundResult = (status: string): Stripe.Response<Stripe.Refund> =>
  ({ status }) as unknown as Stripe.Response<Stripe.Refund>

const refund = (status: string): Stripe.Refund =>
  ({ status }) as unknown as Stripe.Refund

const originalEnv = process.env.OTEL_SERVICE_ENVIRONMENT

beforeEach(async () => {
  process.env.OTEL_SERVICE_ENVIRONMENT = 'prod'
  vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
  reconcile = service.app.get(OutreachP2pSmsReconcileService)

  const stripe = service.app.get(StripeService)
  retrieveSpy = vi
    .spyOn(stripe, 'retrievePaymentIntent')
    .mockResolvedValue(mockIntent())
  refundChargeSpy = vi
    .spyOn(stripe, 'refundCharge')
    .mockResolvedValue(refundResult('succeeded'))
  listRefundsSpy = vi.spyOn(stripe, 'listChargeRefunds').mockResolvedValue([])
  voidSpy = vi.spyOn(stripe, 'voidHold').mockResolvedValue(undefined)

  const campaignId = 7711
  orgSlug = `campaign-${campaignId}`
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id, positionId: 'pos-1' },
  })
  campaign = await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'hold-reconcile-me',
      isPro: true,
      details: {},
      data: {},
      aiContent: {},
    },
  })
  const filter = await service.prisma.voterFileFilter.create({
    data: { organizationSlug: orgSlug },
  })
  filterId = filter.id
})

afterEach(() => {
  if (originalEnv === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
  else process.env.OTEL_SERVICE_ENVIRONMENT = originalEnv
})

const createHold = async ({
  settleState,
  spineStatus = OutreachStatus.pending,
  authorizationIntentId = INTENT_ID as string | null,
  chargeIntentId = null as string | null,
  freeTextsApplied = false,
  projectId = null as string | null,
  deniedAt = null as Date | null,
  sendInHours = -24,
}: {
  settleState: P2pSmsSettleState
  spineStatus?: OutreachStatus
  authorizationIntentId?: string | null
  chargeIntentId?: string | null
  freeTextsApplied?: boolean
  projectId?: string | null
  deniedAt?: Date | null
  sendInHours?: number
}): Promise<number> => {
  const spine = await service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: orgSlug,
      outreachType: 'p2p',
      status: spineStatus,
      date: addHours(new Date(), sendInHours),
      voterFileFilterId: filterId,
      projectId,
      deniedAt,
      stripeCheckoutSessionId: 'cs_paid_1',
    },
  })
  await service.prisma.outreachP2pSms.create({
    data: {
      outreachId: spine.id,
      settleState,
      authorizationIntentId,
      authorizedAmountInCents: 5000,
      chargeIntentId,
      freeTextsApplied,
    },
  })
  return spine.id
}

// @updatedAt advances to now on create, so the stale-guarded sweeps skip a row
// until it has sat untouched past the stale window. Backdate updated_at directly
// (an ordinary update would re-bump it) so a candidate reads as genuinely stale.
const backdateUpdatedAt = async (outreachId: number, minutesAgo: number) => {
  await service.prisma.$executeRaw`
    UPDATE outreach_p2p_sms
    SET updated_at = ${subMinutes(new Date(), minutesAgo)}
    WHERE outreach_id = ${outreachId}`
}

const markOfferRedeemed = async (outreachId: number) => {
  await service.prisma.campaign.update({
    where: { id: campaign.id },
    data: { hasFreeTextsOffer: false, freeTextsOfferRedeemedAt: new Date() },
  })
  await service.prisma.outreachP2pSms.update({
    where: { outreachId },
    data: { freeTextsApplied: true },
  })
}

const readSatellite = (outreachId: number) =>
  service.prisma.outreachP2pSms.findFirstOrThrow({ where: { outreachId } })
const readSpine = (outreachId: number) =>
  service.prisma.outreach.findUniqueOrThrow({ where: { id: outreachId } })
const readCampaign = () =>
  service.prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } })

describe('OutreachP2pSmsReconcileService.sweepStrandedRefunding', () => {
  it('refunds a stranded refunding row when Stripe holds no refund yet', async () => {
    listRefundsSpy.mockResolvedValue([])
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.refunding,
      chargeIntentId: CHARGE_ID,
    })
    await backdateUpdatedAt(outreachId, 20)

    await reconcile.sweepStrandedRefunding()

    expect(refundChargeSpy).toHaveBeenCalledWith(
      CHARGE_ID,
      `p2p-sms-refund-${CHARGE_ID}`,
    )
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.refunded,
    )
  })

  it('stamps refunded WITHOUT a second refund when Stripe already holds one', async () => {
    listRefundsSpy.mockResolvedValue([refund('succeeded')])
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.refunding,
      chargeIntentId: CHARGE_ID,
      freeTextsApplied: true,
    })
    await markOfferRedeemed(outreachId)
    await backdateUpdatedAt(outreachId, 20)

    await reconcile.sweepStrandedRefunding()

    // Idempotent: verified the existing refund, never issued a second.
    expect(refundChargeSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.refunded,
    )
    // Free-texts restored exactly once.
    const after = await readCampaign()
    expect(after.hasFreeTextsOffer).toBe(true)
    expect(after.freeTextsOfferRedeemedAt).toBeNull()
  })

  it('leaves the row refunding for a later sweep on a transient Stripe failure', async () => {
    listRefundsSpy.mockResolvedValue([])
    refundChargeSpy.mockRejectedValue(new Error('stripe down'))
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.refunding,
      chargeIntentId: CHARGE_ID,
    })
    await backdateUpdatedAt(outreachId, 20)

    await reconcile.sweepStrandedRefunding()

    // Never stamped refunded without a committed refund.
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.refunding,
    )
  })

  it('leaves the row refunding when Stripe accepts a non-committed refund', async () => {
    listRefundsSpy.mockResolvedValue([])
    refundChargeSpy.mockResolvedValue(refundResult('failed'))
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.refunding,
      chargeIntentId: CHARGE_ID,
    })
    await backdateUpdatedAt(outreachId, 20)

    await reconcile.sweepStrandedRefunding()

    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.refunding,
    )
  })

  it('elects ONE owner under a concurrent double-run (refunds once)', async () => {
    listRefundsSpy.mockResolvedValue([])
    refundChargeSpy.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(refundResult('succeeded')), 50),
        ),
    )
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.refunding,
      chargeIntentId: CHARGE_ID,
    })
    await backdateUpdatedAt(outreachId, 20)

    await Promise.all([
      reconcile.sweepStrandedRefunding(),
      reconcile.sweepStrandedRefunding(),
    ])

    // The stale-guarded self-transition CAS elects one owner.
    expect(refundChargeSpy).toHaveBeenCalledOnce()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.refunded,
    )
  })

  it('does NOT touch a fresh refunding row (stale guard)', async () => {
    listRefundsSpy.mockResolvedValue([])
    // updatedAt is `now` from create — inside the stale window.
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.refunding,
      chargeIntentId: CHARGE_ID,
    })

    await reconcile.sweepStrandedRefunding()

    expect(refundChargeSpy).not.toHaveBeenCalled()
    expect(listRefundsSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.refunding,
    )
  })

  it('no-ops with the flag off', async () => {
    vi.stubEnv('WIN_SMS_HOLD_BILLING', 'false')
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.refunding,
      chargeIntentId: CHARGE_ID,
    })
    await backdateUpdatedAt(outreachId, 20)

    await reconcile.sweepStrandedRefunding()

    expect(refundChargeSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.refunding,
    )
  })

  it('no-ops off prod', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.refunding,
      chargeIntentId: CHARGE_ID,
    })
    await backdateUpdatedAt(outreachId, 20)

    await reconcile.sweepStrandedRefunding()

    expect(refundChargeSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.refunding,
    )
  })
})

describe('OutreachP2pSmsReconcileService.sweepDeniedUnreleased', () => {
  it('refunds a denied captured hold whose release never ran', async () => {
    retrieveSpy.mockResolvedValue(mockIntent({ status: 'succeeded' }))
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.captured,
      chargeIntentId: CHARGE_ID,
      deniedAt: new Date(),
    })
    await backdateUpdatedAt(outreachId, 20)

    await reconcile.sweepDeniedUnreleased()

    expect(refundChargeSpy).toHaveBeenCalledWith(
      CHARGE_ID,
      `p2p-sms-refund-${CHARGE_ID}`,
    )
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.refunded,
    )
  })

  it('voids a denied authorized hold whose release never ran', async () => {
    retrieveSpy.mockResolvedValue(mockIntent({ status: 'requires_capture' }))
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.authorized,
      deniedAt: new Date(),
    })
    await backdateUpdatedAt(outreachId, 20)

    await reconcile.sweepDeniedUnreleased()

    expect(voidSpy).toHaveBeenCalledWith(INTENT_ID)
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.voided,
    )
  })

  it('is a no-op on an already-released (terminal) denied row', async () => {
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.refunded,
      chargeIntentId: CHARGE_ID,
      deniedAt: new Date(),
    })
    await backdateUpdatedAt(outreachId, 20)

    await reconcile.sweepDeniedUnreleased()

    expect(refundChargeSpy).not.toHaveBeenCalled()
    expect(voidSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.refunded,
    )
  })

  it('leaves a row for retry when its release fails transiently', async () => {
    retrieveSpy.mockResolvedValue(mockIntent({ status: 'succeeded' }))
    refundChargeSpy.mockRejectedValue(new Error('stripe down'))
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.captured,
      chargeIntentId: CHARGE_ID,
      deniedAt: new Date(),
    })
    await backdateUpdatedAt(outreachId, 20)

    await reconcile.sweepDeniedUnreleased()

    // releaseForDeny reverted refunding → captured; the sweep swallowed the
    // throw and the row is left for the next pass.
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.captured,
    )
  })

  it('continues past a record whose release throws', async () => {
    retrieveSpy.mockResolvedValue(mockIntent({ status: 'succeeded' }))
    const first = await createHold({
      settleState: P2pSmsSettleState.captured,
      chargeIntentId: CHARGE_ID,
      deniedAt: new Date(),
    })
    const second = await createHold({
      settleState: P2pSmsSettleState.captured,
      chargeIntentId: 'ch_second',
      deniedAt: new Date(),
    })
    await backdateUpdatedAt(first, 20)
    await backdateUpdatedAt(second, 20)
    refundChargeSpy.mockImplementation(async (chargeId: string) => {
      if (chargeId === CHARGE_ID) throw new Error('boom')
      return refundResult('succeeded')
    })

    await reconcile.sweepDeniedUnreleased()

    expect((await readSatellite(second)).settleState).toBe(
      P2pSmsSettleState.refunded,
    )
  })

  it('elects ONE owner under a concurrent double-run (refunds once)', async () => {
    retrieveSpy.mockResolvedValue(mockIntent({ status: 'succeeded' }))
    refundChargeSpy.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(refundResult('succeeded')), 50),
        ),
    )
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.captured,
      chargeIntentId: CHARGE_ID,
      deniedAt: new Date(),
    })
    await backdateUpdatedAt(outreachId, 20)

    await Promise.all([
      reconcile.sweepDeniedUnreleased(),
      reconcile.sweepDeniedUnreleased(),
    ])

    expect(refundChargeSpy).toHaveBeenCalledOnce()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.refunded,
    )
  })

  it('does NOT select a denied row that is not yet stale', async () => {
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.captured,
      chargeIntentId: CHARGE_ID,
      deniedAt: new Date(),
    })

    await reconcile.sweepDeniedUnreleased()

    expect(refundChargeSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.captured,
    )
  })

  it('does NOT select an UN-denied authorized row (deniedAt null)', async () => {
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.authorized,
    })
    await backdateUpdatedAt(outreachId, 20)

    await reconcile.sweepDeniedUnreleased()

    expect(voidSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.authorized,
    )
  })

  it('does NOT select a denied CAPTURING row (money mid-flight)', async () => {
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.capturing,
      chargeIntentId: CHARGE_ID,
      deniedAt: new Date(),
    })
    await backdateUpdatedAt(outreachId, 20)

    await reconcile.sweepDeniedUnreleased()

    expect(refundChargeSpy).not.toHaveBeenCalled()
    expect(voidSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.capturing,
    )
  })

  it('no-ops with the flag off', async () => {
    vi.stubEnv('WIN_SMS_HOLD_BILLING', 'false')
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.captured,
      chargeIntentId: CHARGE_ID,
      deniedAt: new Date(),
    })
    await backdateUpdatedAt(outreachId, 20)

    await reconcile.sweepDeniedUnreleased()

    expect(refundChargeSpy).not.toHaveBeenCalled()
  })

  it('no-ops off prod', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.captured,
      chargeIntentId: CHARGE_ID,
      deniedAt: new Date(),
    })
    await backdateUpdatedAt(outreachId, 20)

    await reconcile.sweepDeniedUnreleased()

    expect(refundChargeSpy).not.toHaveBeenCalled()
  })
})

describe('OutreachP2pSmsReconcileService.sweepStrandedAuthorized', () => {
  it('voids a past-due authorized draft that never submitted to Peerly', async () => {
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.authorized,
      projectId: null,
      sendInHours: -24,
    })
    await markOfferRedeemed(outreachId)

    await reconcile.sweepStrandedAuthorized()

    expect(voidSpy).toHaveBeenCalledWith(INTENT_ID)
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.voided,
    )
    // Free-texts offer handed back.
    const after = await readCampaign()
    expect(after.hasFreeTextsOffer).toBe(true)
    expect(after.freeTextsOfferRedeemedAt).toBeNull()
  })

  it('voids exactly once across a double-run (authorized → voided CAS)', async () => {
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.authorized,
      projectId: null,
    })

    await reconcile.sweepStrandedAuthorized()
    await reconcile.sweepStrandedAuthorized()

    expect(voidSpy).toHaveBeenCalledOnce()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.voided,
    )
  })

  it('reverts the void and leaves the row for capture if a projectId appears mid-claim', async () => {
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.authorized,
      projectId: null,
    })
    // Simulate a finalize that stamped projectId (submitted the send) between
    // candidate selection and the post-claim re-read fence.
    vi.spyOn(service.prisma.outreach, 'findUnique').mockResolvedValueOnce({
      projectId: 'peerly-raced-in',
    } as unknown as Awaited<
      ReturnType<typeof service.prisma.outreach.findUnique>
    >)

    await reconcile.sweepStrandedAuthorized()

    // The hold must NOT be voided on a send that is now submitted.
    expect(voidSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.authorized,
    )
  })

  it('does NOT select a draft already submitted to Peerly (projectId set)', async () => {
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.authorized,
      projectId: 'peerly-live-job',
    })

    await reconcile.sweepStrandedAuthorized()

    expect(voidSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.authorized,
    )
  })

  it('does NOT select a future-dated authorized draft', async () => {
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.authorized,
      projectId: null,
      sendInHours: 48,
    })

    await reconcile.sweepStrandedAuthorized()

    expect(voidSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.authorized,
    )
  })

  it('does NOT select a captured (already-paid) past-due row', async () => {
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.captured,
      chargeIntentId: CHARGE_ID,
      projectId: null,
    })

    await reconcile.sweepStrandedAuthorized()

    expect(voidSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.captured,
    )
  })

  it('does NOT select a completed (sent) row', async () => {
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.authorized,
      projectId: null,
      spineStatus: OutreachStatus.completed,
    })

    await reconcile.sweepStrandedAuthorized()

    expect(voidSpy).not.toHaveBeenCalled()
    expect((await readSpine(outreachId)).status).toBe(OutreachStatus.completed)
  })

  it('no-ops with the flag off', async () => {
    vi.stubEnv('WIN_SMS_HOLD_BILLING', 'false')
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.authorized,
      projectId: null,
    })

    await reconcile.sweepStrandedAuthorized()

    expect(voidSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.authorized,
    )
  })

  it('no-ops off prod', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    await createHold({
      settleState: P2pSmsSettleState.authorized,
      projectId: null,
    })

    await reconcile.sweepStrandedAuthorized()

    expect(voidSpy).not.toHaveBeenCalled()
  })
})
