import { randomUUID } from 'node:crypto'
import { addHours, subMinutes } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { OutreachRobocallHoldRecoveryService } from '@/outreach/services/outreachRobocallHoldRecovery.service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { Campaign, RobocallSettleState } from '../../generated/prisma'

const service = useTestService()

let recovery: OutreachRobocallHoldRecoveryService
let findHoldsSpy: ReturnType<typeof vi.spyOn>
let voidSpy: ReturnType<typeof vi.spyOn>

let campaign: Campaign
let orgSlug: string
let filterId: number

beforeEach(async () => {
  recovery = service.app.get(OutreachRobocallHoldRecoveryService)

  findHoldsSpy = vi
    .spyOn(service.app.get(StripeService), 'findLiveManualHoldsByOutreach')
    .mockResolvedValue([])
  voidSpy = vi
    .spyOn(service.app.get(StripeService), 'voidHold')
    .mockResolvedValue(undefined)

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
  settleState = RobocallSettleState.hold_pending,
  payAttempt = 0,
  authorizationIntentId = null as string | null,
  authorizedAmountInCents = null as number | null,
}: {
  settleState?: RobocallSettleState
  payAttempt?: number
  authorizationIntentId?: string | null
  authorizedAmountInCents?: number | null
} = {}): Promise<number> => {
  const spine = await service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: orgSlug,
      outreachType: 'robocall',
      status: 'pending_payment',
      date: addHours(new Date(), 24),
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
      payAttempt,
      authorizationIntentId,
      authorizedAmountInCents,
    },
  })
  return spine.id
}

const readSatellite = (outreachId: number) =>
  service.prisma.outreachRobocall.findUniqueOrThrow({ where: { outreachId } })

// Backdates updated_at to simulate a row stranded in hold_pending past the stale
// window (a placement that crashed before its commit / decline / revert).
const strand = async (outreachId: number, ageMinutes: number) => {
  const staleAt = subMinutes(new Date(), ageMinutes)
  await service.prisma
    .$executeRaw`UPDATE outreach_robocall SET updated_at = ${staleAt} WHERE outreach_id = ${outreachId}`
}

describe('OutreachRobocallHoldRecoveryService.sweepStaleHoldPending', () => {
  const originalEnv = process.env.OTEL_SERVICE_ENVIRONMENT

  beforeEach(() => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'prod'
  })
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
    else process.env.OTEL_SERVICE_ENVIRONMENT = originalEnv
  })

  it('voids a live orphan hold and reverts a stranded row to pending_payment', async () => {
    const outreachId = await createDraft({ payAttempt: 0 })
    await strand(outreachId, 30)
    // A hold was placed just before the crash; its intent id was never persisted
    // (commit did not run), so recovery locates it by metadata and voids it.
    findHoldsSpy.mockResolvedValue(['pi_orphan'])

    await recovery.sweepStaleHoldPending()

    expect(findHoldsSpy).toHaveBeenCalledWith(outreachId)
    expect(voidSpy).toHaveBeenCalledWith('pi_orphan')
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.pending_payment)
    // Bumped so a re-authorize derives a fresh idempotency key rather than
    // replaying the just-voided PI.
    expect(satellite.payAttempt).toBe(1)
  })

  it('reverts a stranded row with no live hold (crash before the hold create)', async () => {
    const outreachId = await createDraft({ payAttempt: 2 })
    await strand(outreachId, 30)
    // No PI was ever created; search finds nothing to void.

    await recovery.sweepStaleHoldPending()

    expect(voidSpy).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.pending_payment)
    expect(satellite.payAttempt).toBe(3)
  })

  it('clears any stale authorization fields on revert', async () => {
    const outreachId = await createDraft({
      authorizationIntentId: 'pi_stale',
      authorizedAmountInCents: 450,
    })
    await strand(outreachId, 30)

    await recovery.sweepStaleHoldPending()

    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.pending_payment)
    expect(satellite.authorizationIntentId).toBeNull()
    expect(satellite.authorizedAmountInCents).toBeNull()
    expect(satellite.captureBefore).toBeNull()
  })

  it('voids every hold when a search anomaly returns more than one', async () => {
    const outreachId = await createDraft()
    await strand(outreachId, 30)
    findHoldsSpy.mockResolvedValue(['pi_a', 'pi_b'])

    await recovery.sweepStaleHoldPending()

    expect(voidSpy).toHaveBeenCalledWith('pi_a')
    expect(voidSpy).toHaveBeenCalledWith('pi_b')
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.pending_payment,
    )
  })

  it('does NOT recover a fresh (not-yet-stale) hold_pending row', async () => {
    // A healthy in-flight placement (updatedAt = now) must never be reclaimed
    // and reverted underneath itself.
    const outreachId = await createDraft()

    await recovery.sweepStaleHoldPending()

    expect(findHoldsSpy).not.toHaveBeenCalled()
    expect(voidSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.hold_pending,
    )
  })

  it('leaves the row hold_pending when the Stripe search fails (retries next sweep)', async () => {
    const outreachId = await createDraft()
    await strand(outreachId, 30)
    // A found-but-not-voided hold would strand the money, so a search failure
    // must NOT revert with a possibly-live orphan — the row stays hold_pending.
    findHoldsSpy.mockRejectedValue(new Error('stripe search down'))

    await recovery.sweepStaleHoldPending()

    expect(voidSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.hold_pending,
    )
  })

  it('elects a single recoverer when two sweeps race the same stranded row', async () => {
    const outreachId = await createDraft()
    await strand(outreachId, 30)
    findHoldsSpy.mockResolvedValue(['pi_orphan'])

    await Promise.all([
      recovery.sweepStaleHoldPending(),
      recovery.sweepStaleHoldPending(),
    ])

    // The stale-guarded reclaim CAS elects exactly one recoverer.
    expect(voidSpy).toHaveBeenCalledTimes(1)
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.pending_payment,
    )
  })

  it('recovers even with ROBOCALL_DEFERRED_HOLD_ENABLED unset (not kill-switch-gated)', async () => {
    const originalFlag = process.env.ROBOCALL_DEFERRED_HOLD_ENABLED
    delete process.env.ROBOCALL_DEFERRED_HOLD_ENABLED
    const outreachId = await createDraft()
    await strand(outreachId, 30)
    findHoldsSpy.mockResolvedValue(['pi_orphan'])

    await recovery.sweepStaleHoldPending()

    expect(voidSpy).toHaveBeenCalledWith('pi_orphan')
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.pending_payment,
    )
    if (originalFlag === undefined)
      delete process.env.ROBOCALL_DEFERRED_HOLD_ENABLED
    else process.env.ROBOCALL_DEFERRED_HOLD_ENABLED = originalFlag
  })

  it('no-ops off prod', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    const outreachId = await createDraft()
    await strand(outreachId, 30)

    await recovery.sweepStaleHoldPending()

    expect(findHoldsSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.hold_pending,
    )
  })

  it('does not touch a non-hold_pending draft', async () => {
    const outreachId = await createDraft({
      settleState: RobocallSettleState.authorized,
      authorizationIntentId: 'pi_live',
      authorizedAmountInCents: 450,
    })
    await strand(outreachId, 30)

    await recovery.sweepStaleHoldPending()

    expect(findHoldsSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.authorized,
    )
  })
})
