import { randomUUID } from 'node:crypto'
import { BadGatewayException } from '@nestjs/common'
import { addDays, addHours } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { OutreachRobocallCompletionService } from '@/outreach/services/outreachRobocallCompletion.service'
import { CallhubCampaignReportService } from '@/vendors/callhub/services/callhubCampaignReport.service'
import { CallhubCreditsService } from '@/vendors/callhub/services/callhubCredits.service'
import { CALLHUB_VB_STATUS } from '@/vendors/callhub/schemas/callhubCampaign.schema'
import { VoiceBroadcastCampaignStatus } from '@/vendors/callhub/schemas/callhubCampaignReport.schema'
import { Campaign, RobocallSettleState } from '../../generated/prisma'

const service = useTestService()

let completion: OutreachRobocallCompletionService
let statusSpy: ReturnType<typeof vi.spyOn>
let usageSpy: ReturnType<typeof vi.spyOn>

let campaign: Campaign
let orgSlug: string
let filterId: number

// getCampaignStatus returns the campaign plus a label; the poll reads `.status`.
const vbWith = (status: number) =>
  ({
    url: 'https://callhub/v1/voice_broadcasts/vb_1/',
    name: 'vb',
    status,
    statusLabel: 'x',
  }) as unknown as VoiceBroadcastCampaignStatus

beforeEach(async () => {
  completion = service.app.get(OutreachRobocallCompletionService)

  statusSpy = vi
    .spyOn(service.app.get(CallhubCampaignReportService), 'getCampaignStatus')
    .mockResolvedValue(vbWith(CALLHUB_VB_STATUS.END))
  usageSpy = vi
    .spyOn(service.app.get(CallhubCreditsService), 'getVoiceCampaignUsage')
    .mockResolvedValue({ voice_calls: 100, voice_billsec: 4200 })

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

    // First poll (END, count 100): no prior snapshot, so it records the count
    // and waits — a single pass never settles a still-moving count.
    await completion.pollCompletion(outreachId, 'vb_1')
    const afterFirst = await readSatellite(outreachId)
    expect(afterFirst.settleState).toBe(RobocallSettleState.dialed)
    expect(afterFirst.completedCallCount).toBe(100)
    expect(afterFirst.completionPolledAt).not.toBeNull()

    // Confirming poll reads the same 100 → settle.
    await completion.pollCompletion(outreachId, 'vb_1')

    // pk_str is carried as a STRING end-to-end, never coerced to a number.
    const statusArg = statusSpy.mock.calls[0]?.[0]
    expect(statusArg).toBe('vb_1')
    expect(typeof statusArg).toBe('string')
    const usageArg = usageSpy.mock.calls[0]?.[0]
    expect(usageArg).toBe('vb_1')
    expect(typeof usageArg).toBe('string')

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
    statusSpy.mockResolvedValue(vbWith(CALLHUB_VB_STATUS.START))

    await completion.pollCompletion(outreachId, 'vb_1')

    // Not finished: no count read (spare the rate-limited vendor a POST), no
    // snapshot, no settle.
    expect(usageSpy).not.toHaveBeenCalled()
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
    usageSpy
      .mockResolvedValueOnce({ voice_calls: 40, voice_billsec: 1000 })
      .mockResolvedValue({ voice_calls: 100, voice_billsec: 4200 })

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

  it('records an aborted run partial count and settles it, not discarded', async () => {
    const outreachId = await createDraft()
    // ABORT = a manual/partial stop. The partially-dialed count must still be
    // recorded and settled, never discarded.
    statusSpy.mockResolvedValue(vbWith(CALLHUB_VB_STATUS.ABORT))
    usageSpy.mockResolvedValue({ voice_calls: 42, voice_billsec: 1800 })

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

    expect(usageSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.dialed,
    )
  })

  it('leaves the row dialed when the credits read fails after a terminal status', async () => {
    const outreachId = await createDraft()
    usageSpy.mockRejectedValue(new BadGatewayException('credits down'))

    await completion.pollCompletion(outreachId, 'vb_1')

    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.dialed)
    expect(satellite.completedCallCount).toBeNull()
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
