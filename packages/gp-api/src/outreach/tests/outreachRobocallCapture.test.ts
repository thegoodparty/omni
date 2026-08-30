import { randomUUID } from 'node:crypto'
import { BadGatewayException } from '@nestjs/common'
import { addDays, addHours, subMinutes } from 'date-fns'
import Stripe from 'stripe'
import { PinoLogger } from 'nestjs-pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { OutreachRobocallCaptureService } from '@/outreach/services/outreachRobocallCapture.service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { Campaign, RobocallSettleState } from '../../generated/prisma'

const service = useTestService()

let capture: OutreachRobocallCaptureService
let retrieveSpy: ReturnType<typeof vi.spyOn>
let captureSpy: ReturnType<typeof vi.spyOn>
let voidSpy: ReturnType<typeof vi.spyOn>
let trackSpy: ReturnType<typeof vi.spyOn>

let campaign: Campaign
let orgSlug: string
let filterId: number

// retrievePaymentIntent returns the full Stripe.Response<PaymentIntent>; capture
// branches on `.status` and, when succeeded, `.amount_received`.
const piWith = (status: string, amountReceived?: number) =>
  ({
    id: 'pi_1',
    status,
    amount_received: amountReceived,
  }) as unknown as Stripe.Response<Stripe.PaymentIntent>

beforeEach(async () => {
  capture = service.app.get(OutreachRobocallCaptureService)

  retrieveSpy = vi
    .spyOn(service.app.get(StripeService), 'retrievePaymentIntent')
    .mockResolvedValue(piWith('requires_capture'))
  captureSpy = vi
    .spyOn(service.app.get(StripeService), 'capturePaymentIntent')
    .mockResolvedValue({ id: 'pi_1' } as unknown as Stripe.PaymentIntent)
  voidSpy = vi
    .spyOn(service.app.get(StripeService), 'voidHold')
    .mockResolvedValue(undefined)
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
  settleState = RobocallSettleState.settling,
  completedCallCount = 100,
  authorizedAmountInCents = 450,
  authorizationIntentId = 'pi_1' as string | null,
  captureBefore = addDays(new Date(), 3),
}: {
  settleState?: RobocallSettleState
  completedCallCount?: number | null
  authorizedAmountInCents?: number | null
  authorizationIntentId?: string | null
  captureBefore?: Date | null
} = {}): Promise<number> => {
  const spine = await service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: orgSlug,
      outreachType: 'robocall',
      status: 'pending_payment',
      date: addHours(new Date(), -4),
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
      authorizationIntentId,
      authorizedAmountInCents,
      captureBefore,
      callhubCampaignPkStr: 'vb_1',
    },
  })
  return spine.id
}

const readSatellite = (outreachId: number) =>
  service.prisma.outreachRobocall.findUniqueOrThrow({ where: { outreachId } })

describe('OutreachRobocallCaptureService.captureDraft', () => {
  it('captures the actual amount off a live hold and records the receipt once', async () => {
    const outreachId = await createDraft({ completedCallCount: 100 })

    await capture.captureDraft(outreachId)

    // 100 calls * 45 tenth-cents = 450 cents, within the 450 hold.
    expect(captureSpy).toHaveBeenCalledTimes(1)
    expect(captureSpy).toHaveBeenCalledWith(
      'pi_1',
      450,
      `robocall-capture-${outreachId}`,
    )
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.captured)
    expect(satellite.capturedAmountInCents).toBe(450)

    // Receipt emitted once with the deterministic messageId for dedup.
    expect(trackSpy).toHaveBeenCalledTimes(1)
    const [, , , , messageId] = trackSpy.mock.calls[0] ?? []
    expect(messageId).toBe(`${outreachId}:receipt`)
  })

  it('undercharges when fewer calls completed than the hold estimate', async () => {
    // Hold was for 100 (450c); only 60 dialed → 270c captured, remainder freed.
    const outreachId = await createDraft({ completedCallCount: 60 })

    await capture.captureDraft(outreachId)

    expect(captureSpy).toHaveBeenCalledWith('pi_1', 270, expect.any(String))
    expect((await readSatellite(outreachId)).capturedAmountInCents).toBe(270)
  })

  it('INV-1: never captures more than the authorized hold', async () => {
    // Actual dialed count (100 → 450c) exceeds a hold placed for only 60 (270c):
    // the capture must clamp to the 270c hold, never overbill.
    const outreachId = await createDraft({
      completedCallCount: 100,
      authorizedAmountInCents: 270,
    })

    await capture.captureDraft(outreachId)

    expect(captureSpy).toHaveBeenCalledWith('pi_1', 270, expect.any(String))
    expect((await readSatellite(outreachId)).capturedAmountInCents).toBe(270)
  })

  it('voids the hold and charges nothing on a zero-billable run', async () => {
    const outreachId = await createDraft({ completedCallCount: 0 })

    await capture.captureDraft(outreachId)

    expect(voidSpy).toHaveBeenCalledWith('pi_1')
    expect(captureSpy).not.toHaveBeenCalled()
    expect(trackSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.voided,
    )
    // The best-effort void is recorded so the reconcile sweep re-voids it if it
    // did not land.
    const orphan = await service.prisma.robocallOrphanedHold.findUnique({
      where: { paymentIntentId: 'pi_1' },
    })
    expect(orphan?.reason).toBe('zero_billable')
  })

  it('reconciles idempotently when the hold already succeeded (lost commit)', async () => {
    const outreachId = await createDraft({ completedCallCount: 100 })
    retrieveSpy.mockResolvedValue(piWith('succeeded', 450))

    await capture.captureDraft(outreachId)

    // Already captured at Stripe: do NOT capture again, record the real amount.
    expect(captureSpy).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.captured)
    expect(satellite.capturedAmountInCents).toBe(450)
    expect(trackSpy).toHaveBeenCalledTimes(1)
  })

  it('parks uncollectable + CRITICAL when the hold lapsed before capture', async () => {
    const outreachId = await createDraft({ completedCallCount: 100 })
    retrieveSpy.mockResolvedValue(piWith('canceled'))
    const errorSpy = vi.spyOn(
      (capture as unknown as { logger: PinoLogger }).logger,
      'error',
    )

    await capture.captureDraft(outreachId)

    // Delivered run we could not capture: never blind-charge, surface CRITICAL.
    expect(captureSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.uncollectable,
    )
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ outreachId }),
      expect.stringContaining('CRITICAL'),
    )
  })

  it('voids (not uncollectable) a zero-billable run whose hold is already gone', async () => {
    // A zero-billable settle that voided the hold then crashed before its voided
    // commit is recovered here with the hold already canceled. It owes nothing,
    // so it must go to voided — NOT uncollectable + a false CRITICAL.
    const outreachId = await createDraft({ completedCallCount: 0 })
    retrieveSpy.mockResolvedValue(piWith('canceled'))
    const errorSpy = vi.spyOn(
      (capture as unknown as { logger: PinoLogger }).logger,
      'error',
    )

    await capture.captureDraft(outreachId)

    expect(captureSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.voided,
    )
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('elects a single capturer when two runs race the same settling draft', async () => {
    const outreachId = await createDraft({ completedCallCount: 100 })

    await Promise.all([
      capture.captureDraft(outreachId),
      capture.captureDraft(outreachId),
    ])

    // The settling → capturing claim elects exactly one capturer.
    expect(captureSpy).toHaveBeenCalledTimes(1)
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.captured,
    )
  })

  it('reverts to settling (no charge) on a transient PI read failure', async () => {
    const outreachId = await createDraft({ completedCallCount: 100 })
    retrieveSpy.mockRejectedValue(new BadGatewayException('stripe down'))

    await capture.captureDraft(outreachId)

    expect(captureSpy).not.toHaveBeenCalled()
    // Released back to settling so a later sweep retries it.
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.settling,
    )
  })

  it('reverts to settling when the capture call itself fails', async () => {
    const outreachId = await createDraft({ completedCallCount: 100 })
    captureSpy.mockRejectedValue(new BadGatewayException('capture failed'))

    await capture.captureDraft(outreachId)

    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.settling,
    )
    expect((await readSatellite(outreachId)).capturedAmountInCents).toBeNull()
  })

  it('parks uncollectable + CRITICAL on a data anomaly (missing intent)', async () => {
    // A settling row must carry the authorization; a null is a data bug, never a
    // reason to charge blind.
    const outreachId = await createDraft({ authorizationIntentId: null })
    const errorSpy = vi.spyOn(
      (capture as unknown as { logger: PinoLogger }).logger,
      'error',
    )

    await capture.captureDraft(outreachId)

    expect(captureSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.uncollectable,
    )
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ outreachId }),
      expect.stringContaining('CRITICAL'),
    )
  })

  it('does nothing to a non-settling draft', async () => {
    const outreachId = await createDraft({
      settleState: RobocallSettleState.authorized,
    })

    await capture.captureDraft(outreachId)

    expect(retrieveSpy).not.toHaveBeenCalled()
    expect(captureSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.authorized,
    )
  })
})

describe('OutreachRobocallCaptureService.sweepCaptures', () => {
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

  it('captures an arrived settling run, once across repeat sweeps', async () => {
    const outreachId = await createDraft({ completedCallCount: 100 })

    await capture.sweepCaptures()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.captured,
    )

    // A second sweep no longer finds it in settling, so no second capture.
    await capture.sweepCaptures()
    expect(captureSpy).toHaveBeenCalledTimes(1)
  })

  it('captures nearest-expiry holds first (expiry-priority, not FIFO)', async () => {
    // Two settling runs with DISTINCT intent ids; the one with the SOONER
    // captureBefore must capture FIRST so a backlog never lets a hold lapse
    // uncaptured. The `later` row is inserted first, so a FIFO ordering would
    // capture 'pi_later' first — asserting 'pi_sooner' first proves the order.
    const later = await createDraft({
      captureBefore: addDays(new Date(), 5),
      authorizationIntentId: 'pi_later',
    })
    const sooner = await createDraft({
      captureBefore: addDays(new Date(), 1),
      authorizationIntentId: 'pi_sooner',
    })

    await capture.sweepCaptures()

    expect(captureSpy.mock.calls[0]?.[0]).toBe('pi_sooner')
    expect(captureSpy.mock.calls[1]?.[0]).toBe('pi_later')
    expect((await readSatellite(sooner)).settleState).toBe(
      RobocallSettleState.captured,
    )
    expect((await readSatellite(later)).settleState).toBe(
      RobocallSettleState.captured,
    )
  })

  it('skips a draft that is not settling', async () => {
    const outreachId = await createDraft({
      settleState: RobocallSettleState.dialed,
    })

    await capture.sweepCaptures()

    expect(captureSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.dialed,
    )
  })

  it('no-ops off prod', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    const outreachId = await createDraft({ completedCallCount: 100 })

    await capture.sweepCaptures()

    expect(captureSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.settling,
    )
  })

  it('no-ops when the capture kill-switch is unset even on prod', async () => {
    delete process.env.ROBOCALL_CAPTURE_ENABLED
    const outreachId = await createDraft({ completedCallCount: 100 })

    await capture.sweepCaptures()

    expect(captureSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.settling,
    )
  })

  // Backdates updated_at to simulate a row stranded in `capturing` past the
  // stale window (a crash between the Stripe capture and the DB commit).
  const strand = async (outreachId: number, ageMinutes: number) => {
    const staleAt = subMinutes(new Date(), ageMinutes)
    await service.prisma
      .$executeRaw`UPDATE outreach_robocall SET updated_at = ${staleAt} WHERE outreach_id = ${outreachId}`
  }

  it('recovers a stranded capturing row whose capture never landed (re-captures)', async () => {
    const outreachId = await createDraft({
      settleState: RobocallSettleState.capturing,
      completedCallCount: 100,
    })
    // Stranded 30 min → past the 15-min stale window. The PI still reads
    // requires_capture (the pre-crash capture never landed), so recovery
    // re-captures under the stable key and commits.
    await strand(outreachId, 30)

    await capture.sweepCaptures()

    expect(captureSpy).toHaveBeenCalledWith(
      'pi_1',
      450,
      `robocall-capture-${outreachId}`,
    )
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.captured)
    expect(satellite.capturedAmountInCents).toBe(450)
  })

  it('recovers a stranded capturing row whose capture DID land (reconciles, no re-capture)', async () => {
    const outreachId = await createDraft({
      settleState: RobocallSettleState.capturing,
      completedCallCount: 100,
    })
    await strand(outreachId, 30)
    // The pre-crash capture succeeded at Stripe; recovery must reconcile off
    // amount_received, NOT capture again.
    retrieveSpy.mockResolvedValue(piWith('succeeded', 450))

    await capture.sweepCaptures()

    expect(captureSpy).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.captured)
    expect(satellite.capturedAmountInCents).toBe(450)
  })

  it('does NOT recover a fresh (not-yet-stale) capturing row', async () => {
    // A healthy in-flight capture (updatedAt = now) must never be reclaimed and
    // reconciled underneath itself.
    const outreachId = await createDraft({
      settleState: RobocallSettleState.capturing,
      completedCallCount: 100,
    })

    await capture.sweepCaptures()

    expect(retrieveSpy).not.toHaveBeenCalled()
    expect(captureSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.capturing,
    )
  })

  it('elects a single recoverer when two sweeps race the same stranded row', async () => {
    const outreachId = await createDraft({
      settleState: RobocallSettleState.capturing,
      completedCallCount: 100,
    })
    await strand(outreachId, 30)

    await Promise.all([capture.sweepCaptures(), capture.sweepCaptures()])

    // The stale-guarded reclaim CAS elects exactly one recoverer.
    expect(captureSpy).toHaveBeenCalledTimes(1)
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.captured,
    )
  })
})
