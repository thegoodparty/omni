import { randomUUID } from 'node:crypto'
import { BadGatewayException } from '@nestjs/common'
import { addDays, addHours } from 'date-fns'
import { PinoLogger } from 'nestjs-pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'
import { useTestService } from '@/test-service'
import { OutreachRobocallCompletionService } from '@/outreach/services/outreachRobocallCompletion.service'
import { ROBOCALL_VENDOR } from '@/outreach/vendor/robocallVendor'
import { ROBOCALL_BROADCAST_STATUS } from '@/outreach/vendor/robocallVendor.types'
import { Campaign, RobocallSettleState } from '../../generated/prisma'

const service = useTestService()

let completion: OutreachRobocallCompletionService
let statusSpy: ReturnType<typeof vi.spyOn>
let countSpy: ReturnType<typeof vi.spyOn>

let campaign: Campaign
let orgSlug: string
let filterId: number

beforeEach(async () => {
  completion = service.app.get(OutreachRobocallCompletionService)

  statusSpy = vi
    .spyOn(service.app.get(ROBOCALL_VENDOR), 'getBroadcastStatus')
    .mockResolvedValue(ROBOCALL_BROADCAST_STATUS.COMPLETED)
  countSpy = vi
    .spyOn(service.app.get(ROBOCALL_VENDOR), 'getCompletedCount')
    .mockResolvedValue({ connectedCount: 100, billableSeconds: 4200 })

  const campaignId = 997
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
  settleState = RobocallSettleState.dialed,
  staged = true,
}: {
  settleState?: RobocallSettleState
  staged?: boolean
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
      audioKey: `robocall/997/${randomUUID()}.mp3`,
      callbackNumber: '+15125550123',
      billableCount: 100,
      amountInCents: 450,
      settleState,
      // Hold fields set so the tests can prove the completion slice never
      // touches them — it records a count and advances state, no money op.
      authorizationIntentId: 'pi_1',
      authorizedAmountInCents: 450,
      captureBefore: addDays(new Date(), 5),
      ...(staged ? { callhubCampaignPkStr: 'vb_1' } : {}),
    },
  })
  return spine.id
}

const readSatellite = (outreachId: number) =>
  service.prisma.outreachRobocall.findUniqueOrThrow({ where: { outreachId } })

describe('OutreachRobocallCompletionService.pollCompletion', () => {
  it('settles a completed run with a stable count and records it, no money op', async () => {
    const outreachId = await createDraft()

    // First poll (COMPLETED, count 100): no prior snapshot, so it records the
    // count and waits — a single pass never settles a still-moving count.
    await completion.pollCompletion(outreachId, 'vb_1')
    const afterFirst = await readSatellite(outreachId)
    expect(afterFirst.settleState).toBe(RobocallSettleState.dialed)
    expect(afterFirst.completedCallCount).toBe(100)
    expect(afterFirst.completionPolledAt).not.toBeNull()

    // Confirming poll reads the same 100 → settle.
    await completion.pollCompletion(outreachId, 'vb_1')

    // The campaign ref is carried as a STRING end-to-end, never coerced.
    const statusArg = statusSpy.mock.calls[0]?.[0]
    expect(statusArg).toBe('vb_1')
    expect(typeof statusArg).toBe('string')
    const countArg = countSpy.mock.calls[0]?.[0]
    expect(countArg).toBe('vb_1')
    expect(typeof countArg).toBe('string')

    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.settling)
    expect(satellite.completedCallCount).toBe(100)
    // No PaymentIntent captured/voided: the hold fields are untouched and no
    // captured amount was written. Capture is the next slice.
    expect(satellite.authorizationIntentId).toBe('pi_1')
    expect(satellite.authorizedAmountInCents).toBe(450)
    expect(satellite.captureBefore).not.toBeNull()
    expect(satellite.capturedAmountInCents).toBeNull()
    expect(satellite.chargeIntentId).toBeNull()
  })

  it('stays dialed and reads no count while the run is still dialing', async () => {
    const outreachId = await createDraft()
    statusSpy.mockResolvedValue(ROBOCALL_BROADCAST_STATUS.DIALING)

    await completion.pollCompletion(outreachId, 'vb_1')

    // Not finished: no count read (spare the rate-limited vendor a call), no
    // snapshot, no settle.
    expect(countSpy).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.dialed)
    expect(satellite.completedCallCount).toBeNull()
  })

  it('does not settle on the first terminal poll, only on the confirming one', async () => {
    const outreachId = await createDraft()

    await completion.pollCompletion(outreachId, 'vb_1')
    // First poll snapshots the count but leaves the row dialed.
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.dialed,
    )

    await completion.pollCompletion(outreachId, 'vb_1')
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.settling,
    )
  })

  it('waits while the count is still moving, then settles once it stabilizes', async () => {
    const outreachId = await createDraft()
    // The count climbs across polls (reporting lag), then holds steady.
    countSpy
      .mockResolvedValueOnce({ connectedCount: 40, billableSeconds: 1000 })
      .mockResolvedValue({ connectedCount: 100, billableSeconds: 4200 })

    await completion.pollCompletion(outreachId, 'vb_1')
    expect((await readSatellite(outreachId)).completedCallCount).toBe(40)

    // 100 !== the snapshotted 40 → still moving, record and wait, do not settle.
    await completion.pollCompletion(outreachId, 'vb_1')
    let satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.dialed)
    expect(satellite.completedCallCount).toBe(100)

    // 100 === 100 → stable, settle.
    await completion.pollCompletion(outreachId, 'vb_1')
    satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.settling)
    expect(satellite.completedCallCount).toBe(100)
  })

  it('parks a delivered run uncollectable + CRITICAL when the vendor reports no connected count (FINDING B)', async () => {
    const outreachId = await createDraft()
    // The vendor port returns a genuine number or throws — it never returns a
    // "not reported yet" null. A terminal broadcast with an ABSENT connected
    // count is a PERMANENT anomaly (FINDING B), not a transient wait: a silent
    // null-and-retry would re-poll forever. The run DIALED, so park it
    // `uncollectable` (never send_failed — never void a delivered run).
    countSpy.mockRejectedValue(
      new Error('CallFire stats missing callsLiveAnswer'),
    )
    const errorSpy = vi.spyOn(
      (completion as unknown as { logger: PinoLogger }).logger,
      'error',
    )

    await completion.pollCompletion(outreachId, 'vb_1')

    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.uncollectable,
    )
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ outreachId, campaignPkStr: 'vb_1' }),
      expect.stringContaining('CRITICAL'),
    )
  })

  it('settles at a genuine numeric 0 (a real all-suppressed run)', async () => {
    const outreachId = await createDraft()
    // A real 0 (every number suppressed) is a valid, stable count — distinct
    // from a permanent missing-count anomaly.
    countSpy.mockResolvedValue({ connectedCount: 0, billableSeconds: 0 })

    await completion.pollCompletion(outreachId, 'vb_1')
    expect((await readSatellite(outreachId)).completedCallCount).toBe(0)

    await completion.pollCompletion(outreachId, 'vb_1')
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.settling)
    expect(satellite.completedCallCount).toBe(0)
  })

  it('elects a single settler when two polls race the same stable run', async () => {
    const outreachId = await createDraft()
    // Prime the stability snapshot so one further poll is settle-eligible.
    await completion.pollCompletion(outreachId, 'vb_1')
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.dialed,
    )

    const infoSpy = vi.spyOn(
      (completion as unknown as { logger: PinoLogger }).logger,
      'info',
    )

    await Promise.all([
      completion.pollCompletion(outreachId, 'vb_1'),
      completion.pollCompletion(outreachId, 'vb_1'),
    ])

    // The dialed → settling CAS elects exactly one settler: a single transition,
    // logged once, even when two runners race the same draft in one slot.
    expect(infoSpy).toHaveBeenCalledTimes(1)
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.settling)
    expect(satellite.completedCallCount).toBe(100)
  })

  it('records an aborted run partial count and settles it, not discarded', async () => {
    const outreachId = await createDraft()
    // ABORTED = a manual/partial stop. The partially-dialed count must still be
    // recorded and settled, never discarded.
    statusSpy.mockResolvedValue(ROBOCALL_BROADCAST_STATUS.ABORTED)
    countSpy.mockResolvedValue({ connectedCount: 42, billableSeconds: 1800 })

    await completion.pollCompletion(outreachId, 'vb_1')
    await completion.pollCompletion(outreachId, 'vb_1')

    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.settling)
    expect(satellite.completedCallCount).toBe(42)
  })

  it('leaves the row dialed when the status read itself fails', async () => {
    const outreachId = await createDraft()
    statusSpy.mockRejectedValue(new BadGatewayException('status read down'))

    await completion.pollCompletion(outreachId, 'vb_1')

    expect(countSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.dialed,
    )
  })

  it('leaves the row dialed on a TRANSIENT count failure, logged as a retry (not CRITICAL)', async () => {
    const outreachId = await createDraft()
    countSpy.mockRejectedValue(new BadGatewayException('vendor down'))
    const errorSpy = vi.spyOn(
      (completion as unknown as { logger: PinoLogger }).logger,
      'error',
    )

    await completion.pollCompletion(outreachId, 'vb_1')

    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.dialed)
    expect(satellite.completedCallCount).toBeNull()
    // A transient 502 is a normal retry, never surfaced as CRITICAL.
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ outreachId, campaignPkStr: 'vb_1' }),
      expect.stringContaining('retry next sweep'),
    )
    const messages = errorSpy.mock.calls.map((call) => String(call[1]))
    expect(messages.some((m) => m.includes('CRITICAL'))).toBe(false)
  })

  it('parks a delivered run uncollectable + CRITICAL on a permanent schema mismatch', async () => {
    const outreachId = await createDraft()
    // A ZodError = the vendor stats response shape is wrong for real data. It is
    // PERMANENT — a silent null-and-retry would re-poll forever. The run has
    // DIALED, so it may owe money for connected calls we can no longer count:
    // park it `uncollectable` (fresh-charge / manual review settles it), NOT
    // send_failed (which voids the hold — never void a delivered run).
    countSpy.mockRejectedValue(new ZodError([]))
    const errorSpy = vi.spyOn(
      (completion as unknown as { logger: PinoLogger }).logger,
      'error',
    )

    await completion.pollCompletion(outreachId, 'vb_1')

    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.uncollectable,
    )
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ outreachId, campaignPkStr: 'vb_1' }),
      expect.stringContaining('CRITICAL'),
    )
  })

  it('emits CRITICAL even when the uncollectable park itself fails', async () => {
    const outreachId = await createDraft()
    countSpy.mockRejectedValue(new ZodError([]))
    const errorSpy = vi.spyOn(
      (completion as unknown as { logger: PinoLogger }).logger,
      'error',
    )
    // The park transition hits a transient DB error. The CRITICAL alert is the
    // only ops signal a delivered run was stranded, so it must fire regardless —
    // it is logged BEFORE the park, and the park failure is caught (retry next
    // sweep) rather than escaping and swallowing the alert. Restore the spy right
    // after the poll so the rejected updateMany can't leak into later tests.
    const updateManySpy = vi
      .spyOn(
        (
          completion as unknown as {
            model: { updateMany: () => Promise<unknown> }
          }
        ).model,
        'updateMany',
      )
      .mockRejectedValue(new Error('db down'))

    await completion.pollCompletion(outreachId, 'vb_1')
    updateManySpy.mockRestore()

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ outreachId, campaignPkStr: 'vb_1' }),
      expect.stringContaining('CRITICAL'),
    )
  })
})

describe('OutreachRobocallCompletionService.sweepRobocallCompletion', () => {
  const originalEnv = process.env.OTEL_SERVICE_ENVIRONMENT

  beforeEach(() => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'prod'
  })
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
    else process.env.OTEL_SERVICE_ENVIRONMENT = originalEnv
  })

  it('settles a completed dialed run across repeat sweeps, once', async () => {
    const outreachId = await createDraft()

    // Two sweeps: the first snapshots the count, the second confirms + settles.
    await completion.sweepRobocallCompletion()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.dialed,
    )

    await completion.sweepRobocallCompletion()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.settling)
    expect(satellite.completedCallCount).toBe(100)

    // A third sweep no longer finds it in `dialed`, so it is not re-polled.
    const callsBefore = statusSpy.mock.calls.length
    await completion.sweepRobocallCompletion()
    expect(statusSpy.mock.calls.length).toBe(callsBefore)
  })

  it('skips a draft that is not dialed', async () => {
    const outreachId = await createDraft({
      settleState: RobocallSettleState.authorized,
    })

    await completion.sweepRobocallCompletion()

    expect(statusSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.authorized,
    )
  })

  it('no-ops off prod', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    const outreachId = await createDraft()

    await completion.sweepRobocallCompletion()

    expect(statusSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.dialed,
    )
  })
})
