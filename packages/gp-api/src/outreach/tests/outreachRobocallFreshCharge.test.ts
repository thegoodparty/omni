import { randomUUID } from 'node:crypto'
import { addHours, subMinutes } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { OutreachRobocallFreshChargeService } from '@/outreach/services/outreachRobocallFreshCharge.service'
import {
  StripeChargeDeclinedError,
  StripeService,
} from '@/vendors/stripe/services/stripe.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { Campaign, RobocallSettleState } from '../../generated/prisma'

const service = useTestService()

let freshCharge: OutreachRobocallFreshChargeService
let chargeSpy: ReturnType<typeof vi.spyOn>
let findChargeSpy: ReturnType<typeof vi.spyOn>
let trackSpy: ReturnType<typeof vi.spyOn>

let campaign: Campaign
let orgSlug: string
let filterId: number

beforeEach(async () => {
  freshCharge = service.app.get(OutreachRobocallFreshChargeService)

  chargeSpy = vi
    .spyOn(service.app.get(StripeService), 'createOffSessionCharge')
    .mockResolvedValue({ paymentIntentId: 'pi_charge_1' })
  // No prior succeeded charge by default; the search-first reconcile returns
  // null so the normal path proceeds to charge.
  findChargeSpy = vi
    .spyOn(service.app.get(StripeService), 'findSucceededChargeByOutreach')
    .mockResolvedValue(null)
  trackSpy = vi
    .spyOn(service.app.get(AnalyticsService), 'track')
    .mockResolvedValue(undefined as never)

  const campaignId = 998
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
})

const createDraft = async ({
  settleState = RobocallSettleState.uncollectable,
  completedCallCount = 100 as number | null,
  authorizedAmountInCents = 450 as number | null,
  paymentMethodId = 'pm_1' as string | null,
  stripeCustomerId = 'cus_1' as string | null,
  chargeIntentId = null as string | null,
}: {
  settleState?: RobocallSettleState
  completedCallCount?: number | null
  authorizedAmountInCents?: number | null
  paymentMethodId?: string | null
  stripeCustomerId?: string | null
  chargeIntentId?: string | null
} = {}): Promise<number> => {
  const spine = await service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: orgSlug,
      outreachType: 'robocall',
      status: 'pending_payment',
      date: addHours(new Date(), -8),
      voterFileFilterId: filterId,
    },
  })
  await service.prisma.outreachRobocall.create({
    data: {
      outreachId: spine.id,
      audioKey: `robocall/998/${randomUUID()}.mp3`,
      callbackNumber: '+15125550123',
      billableCount: 100,
      amountInCents: 450,
      settleState,
      completedCallCount,
      authorizedAmountInCents,
      paymentMethodId,
      stripeCustomerId,
      chargeIntentId,
    },
  })
  return spine.id
}

const readSatellite = (outreachId: number) =>
  service.prisma.outreachRobocall.findUniqueOrThrow({ where: { outreachId } })

const strand = async (outreachId: number, ageMinutes: number) => {
  const staleAt = subMinutes(new Date(), ageMinutes)
  await service.prisma
    .$executeRaw`UPDATE outreach_robocall SET updated_at = ${staleAt} WHERE outreach_id = ${outreachId}`
}

describe('OutreachRobocallFreshChargeService.chargeUncollectable', () => {
  it('charges the actual amount off-session and records the receipt once', async () => {
    const outreachId = await createDraft({ completedCallCount: 100 })

    await freshCharge.chargeUncollectable(outreachId)

    expect(chargeSpy).toHaveBeenCalledTimes(1)
    expect(chargeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        amountInCents: 450,
        robocallId: outreachId,
        paymentMethodId: 'pm_1',
        customerId: 'cus_1',
      }),
    )
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.charged)
    expect(satellite.chargeIntentId).toBe('pi_charge_1')
    expect(satellite.capturedAmountInCents).toBe(450)
    expect(trackSpy).toHaveBeenCalledTimes(1)
  })

  it('INV-1: clamps an actual over the authorized amount to the authorized', async () => {
    const outreachId = await createDraft({
      completedCallCount: 200,
      authorizedAmountInCents: 450,
    })

    await freshCharge.chargeUncollectable(outreachId)

    // 200 calls would be 900 cents, clamped to the 450 authorized.
    expect(chargeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ amountInCents: 450 }),
    )
    expect((await readSatellite(outreachId)).capturedAmountInCents).toBe(450)
  })

  it('undercharges a run with fewer calls than the estimate', async () => {
    const outreachId = await createDraft({
      completedCallCount: 50,
      authorizedAmountInCents: 450,
    })

    await freshCharge.chargeUncollectable(outreachId)

    // 50 calls = 225 cents, under the 450 authorized.
    expect(chargeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ amountInCents: 225 }),
    )
    expect((await readSatellite(outreachId)).capturedAmountInCents).toBe(225)
  })

  it('parks uncollectable with the declined PI id on a card decline (no receipt)', async () => {
    const outreachId = await createDraft()
    chargeSpy.mockRejectedValue(
      new StripeChargeDeclinedError('card_declined', 'pi_declined'),
    )

    await freshCharge.chargeUncollectable(outreachId)

    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.uncollectable)
    // chargeIntentId set → the run is not re-attempted next sweep.
    expect(satellite.chargeIntentId).toBe('pi_declined')
    expect(satellite.capturedAmountInCents).toBeNull()
    expect(trackSpy).not.toHaveBeenCalled()
  })

  it('reverts to uncollectable WITHOUT a chargeIntentId on a transient failure', async () => {
    const outreachId = await createDraft()
    chargeSpy.mockRejectedValue(new Error('stripe down'))

    await freshCharge.chargeUncollectable(outreachId)

    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.uncollectable)
    // No chargeIntentId → the next sweep retries under the stable key.
    expect(satellite.chargeIntentId).toBeNull()
  })

  it('NEVER-TWICE: a concurrent double-charge charges once via the claim CAS', async () => {
    const outreachId = await createDraft()

    await Promise.all([
      freshCharge.chargeUncollectable(outreachId),
      freshCharge.chargeUncollectable(outreachId),
    ])

    expect(chargeSpy).toHaveBeenCalledTimes(1)
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.charged,
    )
  })

  it('voids a zero-billable uncollectable run instead of re-sweeping it forever', async () => {
    const outreachId = await createDraft({ completedCallCount: 0 })

    await freshCharge.chargeUncollectable(outreachId)

    expect(chargeSpy).not.toHaveBeenCalled()
    // Sent to the zero terminal so it leaves the candidate set (no CRITICAL storm).
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.voided,
    )
  })

  it('voids (writes off) a run billing below the Stripe minimum charge', async () => {
    // 10 calls = 45 cents, under Stripe's $0.50 minimum — a fresh PaymentIntent
    // below it is rejected, and rounding up would overcharge, so it is written
    // off rather than failing-and-retrying forever.
    const outreachId = await createDraft({ completedCallCount: 10 })

    await freshCharge.chargeUncollectable(outreachId)

    expect(chargeSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.voided,
    )
  })

  it('reconciles a lost-commit charge via search without charging again', async () => {
    const outreachId = await createDraft()
    // The prior attempt charged successfully but lost its DB commit; the row is
    // still uncollectable. The search finds the succeeded PI → reconcile, never
    // a second charge.
    findChargeSpy.mockResolvedValue({
      paymentIntentId: 'pi_prior',
      amountReceived: 450,
    })

    await freshCharge.chargeUncollectable(outreachId)

    expect(chargeSpy).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.charged)
    expect(satellite.chargeIntentId).toBe('pi_prior')
  })

  it('does not charge a non-uncollectable draft', async () => {
    const outreachId = await createDraft({
      settleState: RobocallSettleState.captured,
    })

    await freshCharge.chargeUncollectable(outreachId)

    expect(chargeSpy).not.toHaveBeenCalled()
  })

  it('does not re-charge a row already charge-attempted (chargeIntentId set)', async () => {
    const outreachId = await createDraft({ chargeIntentId: 'pi_prev_declined' })

    await freshCharge.chargeUncollectable(outreachId)

    expect(chargeSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.uncollectable,
    )
  })
})

describe('OutreachRobocallFreshChargeService.sweepFreshCharges', () => {
  const originalEnv = process.env.OTEL_SERVICE_ENVIRONMENT
  const originalFlag = process.env.ROBOCALL_CAPTURE_ENABLED

  beforeEach(() => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'prod'
    process.env.ROBOCALL_CAPTURE_ENABLED = 'true'
  })
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
    else process.env.OTEL_SERVICE_ENVIRONMENT = originalEnv
    if (originalFlag === undefined) delete process.env.ROBOCALL_CAPTURE_ENABLED
    else process.env.ROBOCALL_CAPTURE_ENABLED = originalFlag
  })

  it('charges an arrived uncollectable run once across repeat sweeps', async () => {
    const outreachId = await createDraft()

    await freshCharge.sweepFreshCharges()
    await freshCharge.sweepFreshCharges()

    expect(chargeSpy).toHaveBeenCalledTimes(1)
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.charged,
    )
  })

  it('skips a run missing the card or the count', async () => {
    const noCard = await createDraft({ paymentMethodId: null })
    const noCount = await createDraft({ completedCallCount: null })

    await freshCharge.sweepFreshCharges()

    expect(chargeSpy).not.toHaveBeenCalled()
    expect((await readSatellite(noCard)).settleState).toBe(
      RobocallSettleState.uncollectable,
    )
    expect((await readSatellite(noCount)).settleState).toBe(
      RobocallSettleState.uncollectable,
    )
  })

  it('no-ops off prod', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    await createDraft()

    await freshCharge.sweepFreshCharges()

    expect(chargeSpy).not.toHaveBeenCalled()
  })

  it('no-ops with ROBOCALL_CAPTURE_ENABLED unset', async () => {
    delete process.env.ROBOCALL_CAPTURE_ENABLED
    await createDraft()

    await freshCharge.sweepFreshCharges()

    expect(chargeSpy).not.toHaveBeenCalled()
  })

  it('recovers a stranded charging row whose charge landed (reconciles via search, never re-charges)', async () => {
    const outreachId = await createDraft({
      settleState: RobocallSettleState.charging,
    })
    await strand(outreachId, 30)
    // A prior attempt's charge already succeeded at Stripe; the search-first
    // reconcile finds it and commits WITHOUT charging again — idempotent even
    // past Stripe's 24h idempotency-key window.
    findChargeSpy.mockResolvedValue({
      paymentIntentId: 'pi_landed',
      amountReceived: 450,
    })

    await freshCharge.sweepFreshCharges()

    expect(chargeSpy).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.charged)
    expect(satellite.chargeIntentId).toBe('pi_landed')
    expect(satellite.capturedAmountInCents).toBe(450)
  })

  it('recovers a stranded charging row whose charge declined (parks uncollectable)', async () => {
    const outreachId = await createDraft({
      settleState: RobocallSettleState.charging,
    })
    await strand(outreachId, 30)
    chargeSpy.mockRejectedValue(
      new StripeChargeDeclinedError('card_declined', 'pi_declined'),
    )

    await freshCharge.sweepFreshCharges()

    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.uncollectable)
    expect(satellite.chargeIntentId).toBe('pi_declined')
  })

  it('does NOT recover a fresh (not-yet-stale) charging row', async () => {
    const outreachId = await createDraft({
      settleState: RobocallSettleState.charging,
    })

    await freshCharge.sweepFreshCharges()

    expect(chargeSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.charging,
    )
  })

  it('elects a single recoverer for a stranded charging row under a double-sweep', async () => {
    const outreachId = await createDraft({
      settleState: RobocallSettleState.charging,
    })
    await strand(outreachId, 30)

    await Promise.all([
      freshCharge.sweepFreshCharges(),
      freshCharge.sweepFreshCharges(),
    ])

    expect(chargeSpy).toHaveBeenCalledTimes(1)
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.charged,
    )
  })
})
