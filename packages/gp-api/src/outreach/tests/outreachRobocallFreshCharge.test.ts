import { randomUUID } from 'node:crypto'
import { addHours, subMinutes } from 'date-fns'
import { PinoLogger } from 'nestjs-pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { OutreachRobocallFreshChargeService } from '@/outreach/services/outreachRobocallFreshCharge.service'
import {
  StripeChargeDeclinedError,
  StripeService,
} from '@/vendors/stripe/services/stripe.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { Campaign, RobocallSettleState } from '../../generated/prisma'
import { calcRobocallTotalInCents } from '@/shared/util/robocallPricing.util'

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
  authorizedAmountInCents = calcRobocallTotalInCents(100) as number | null,
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
      amountInCents: calcRobocallTotalInCents(100),
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
        amountInCents: calcRobocallTotalInCents(100),
        robocallId: outreachId,
        paymentMethodId: 'pm_1',
        customerId: 'cus_1',
      }),
    )
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.charged)
    expect(satellite.chargeIntentId).toBe('pi_charge_1')
    expect(satellite.capturedAmountInCents).toBe(calcRobocallTotalInCents(100))
    expect(trackSpy).toHaveBeenCalledTimes(1)
    const [, , properties] = trackSpy.mock.calls[0] ?? []
    // Receipt carries dollars (HubSpot stores it as-is): 650c → $6.50.
    expect(properties).toEqual({
      outreachId,
      capturedAmountInDollars: calcRobocallTotalInCents(100) / 100,
    })
  })

  it('INV-1: never charges more than the authorized amount', async () => {
    // A draft-time count whose calc (200 calls = 900c + 200c fee = 1100c) exceeds
    // the amount actually authorized (450c): the fresh charge is the authorized
    // amount directly, so it can never overbill above the estimate.
    const outreachId = await createDraft({
      completedCallCount: 200,
      authorizedAmountInCents: 450,
    })

    await freshCharge.chargeUncollectable(outreachId)

    expect(chargeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ amountInCents: 450 }),
    )
    expect((await readSatellite(outreachId)).capturedAmountInCents).toBe(450)
  })

  it('charges the FULL authorized estimate when the draft-time count is smaller than the authorize basis (audience grew)', async () => {
    // DRIFT: completedCallCount is the DRAFT-time billableCount snapshot, but
    // authorizedAmountInCents is re-derived at AUTHORIZE time (up to ~82 days
    // later, on the deferred path). If the landline audience grew in that gap,
    // calc(completedCallCount) is SMALLER than the amount held on the card and
    // quoted. This lapsed-hold recovery must charge the FULL authorized estimate,
    // never the smaller draft-count amount — a min(calc(count), authorized) clamp
    // would undercharge below the estimate on the riskiest run.
    const outreachId = await createDraft({
      completedCallCount: 60,
      authorizedAmountInCents: calcRobocallTotalInCents(100),
    })

    await freshCharge.chargeUncollectable(outreachId)

    // The full authorized estimate (650c) is charged, NOT the smaller calc(60).
    expect(chargeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        amountInCents: calcRobocallTotalInCents(100),
      }),
    )
    expect(chargeSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ amountInCents: calcRobocallTotalInCents(60) }),
    )
    expect((await readSatellite(outreachId)).capturedAmountInCents).toBe(
      calcRobocallTotalInCents(100),
    )
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

  it('charges a tiny run because the number fee clears the Stripe minimum', async () => {
    // A tiny authorized estimate (10 calls = 45c alone would be under Stripe's
    // $0.50 minimum) still charges, because the flat number fee lifts every run's
    // estimate above the minimum. (The sub-minimum write-off is now
    // defensive/unreachable — a zero-connected run is voided at capture and never
    // reaches fresh charge.)
    const outreachId = await createDraft({
      completedCallCount: 10,
      authorizedAmountInCents: calcRobocallTotalInCents(10),
    })

    await freshCharge.chargeUncollectable(outreachId)

    expect(chargeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ amountInCents: calcRobocallTotalInCents(10) }),
    )
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.charged,
    )
  })

  it('DEFENSE-IN-DEPTH: voids a zero-connected run without an off-session charge', async () => {
    // Unreachable today (capture voids every count-0 row before fresh charge is
    // ever reached), but guarded locally: a zero-connected run owes nothing, so
    // this must never fire the off-session charge.
    const outreachId = await createDraft({ completedCallCount: 0 })

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
      amountReceived: calcRobocallTotalInCents(100),
    })

    await freshCharge.chargeUncollectable(outreachId)

    expect(chargeSpy).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.charged)
    expect(satellite.chargeIntentId).toBe('pi_prior')
  })

  it('leaves the row charging when the succeeded-charge search fails (retries next sweep)', async () => {
    const outreachId = await createDraft()
    // The claim moves the row to charging, then the pre-charge reconcile search
    // throws → no charge is issued and the row strands in charging for the stale
    // sweep to recover.
    findChargeSpy.mockRejectedValue(new Error('stripe search down'))

    await expect(freshCharge.chargeUncollectable(outreachId)).rejects.toThrow(
      'stripe search down',
    )

    expect(chargeSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.charging,
    )
  })

  it('logs CRITICAL when the charge lands but the commit finds no charging row', async () => {
    const outreachId = await createDraft()
    const errorSpy = vi.spyOn(
      (freshCharge as unknown as { logger: PinoLogger }).logger,
      'error',
    )
    // The charge succeeds, but a concurrent settler moves the row out of
    // charging before our commit — the commit CAS matches 0. Money moved at
    // Stripe, so this must surface CRITICAL, never be silently swallowed.
    chargeSpy.mockImplementation(async () => {
      await service.prisma.outreachRobocall.updateMany({
        where: { outreachId },
        data: { settleState: RobocallSettleState.charged },
      })
      return { paymentIntentId: 'pi_race' }
    })

    await freshCharge.chargeUncollectable(outreachId)

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ outreachId }),
      expect.stringContaining('commit found no charging row'),
    )
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
      amountReceived: calcRobocallTotalInCents(100),
    })

    await freshCharge.sweepFreshCharges()

    expect(chargeSpy).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.charged)
    expect(satellite.chargeIntentId).toBe('pi_landed')
    expect(satellite.capturedAmountInCents).toBe(calcRobocallTotalInCents(100))
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

  it('parks a stale charging row with missing data uncollectable (never charges blind)', async () => {
    // The stale-charging reclaim bypasses the candidate filter, so settleClaimed
    // re-checks the required fields. A charging row missing completedCallCount
    // hits the guard → CRITICAL + uncollectable, never a blind charge.
    const outreachId = await createDraft({
      settleState: RobocallSettleState.charging,
      completedCallCount: null,
    })
    await strand(outreachId, 30)

    await freshCharge.sweepFreshCharges()

    expect(chargeSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.uncollectable,
    )
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
