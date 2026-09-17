import { randomUUID } from 'node:crypto'
import { BadGatewayException } from '@nestjs/common'
import { addHours, subHours } from 'date-fns'
import { PinoLogger } from 'nestjs-pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { OutreachRobocallCompletionService } from '@/outreach/services/outreachRobocallCompletion.service'
import { CallhubCampaignService } from '@/vendors/callhub/services/callhubCampaign.service'
import { CallhubPermanentError } from '@/vendors/callhub/services/callhubErrorHandling.service'
import {
  ROBOCALL_RUN_HOURS,
  ROBOCALL_SETTLE_MARGIN_HOURS,
} from '@/shared/util/robocallHold.util'
import { Campaign, RobocallSettleState } from '../../generated/prisma'

const service = useTestService()

let completion: OutreachRobocallCompletionService
let abortSpy: ReturnType<typeof vi.spyOn>

let campaign: Campaign
let orgSlug: string
let filterId: number

beforeEach(async () => {
  completion = service.app.get(OutreachRobocallCompletionService)

  abortSpy = vi
    .spyOn(service.app.get(CallhubCampaignService), 'abortVoiceBroadcast')
    .mockResolvedValue(undefined)

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
  billableCount = 100,
  // Past the run window by default → eligible to settle.
  dialedHoursAgo = ROBOCALL_RUN_HOURS + 1,
  captureBeforeInHours = 24 * 5,
  authorizationIntentId = 'pi_1' as string | null,
}: {
  settleState?: RobocallSettleState
  staged?: boolean
  billableCount?: number
  dialedHoursAgo?: number
  captureBeforeInHours?: number
  authorizationIntentId?: string | null
} = {}): Promise<number> => {
  const spine = await service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: orgSlug,
      outreachType: 'robocall',
      status: 'in_progress',
      date: addHours(new Date(), -dialedHoursAgo),
      voterFileFilterId: filterId,
    },
  })
  await service.prisma.outreachRobocall.create({
    data: {
      outreachId: spine.id,
      audioKey: `robocall/997/${randomUUID()}.mp3`,
      callbackNumber: '+15125550123',
      billableCount,
      amountInCents: 450,
      settleState,
      dialedAt: subHours(new Date(), dialedHoursAgo),
      // Hold fields set so the tests can prove the completion slice never
      // touches them — it records a count and advances state, no money op.
      ...(authorizationIntentId ? { authorizationIntentId } : {}),
      authorizedAmountInCents: 450,
      captureBefore: addHours(new Date(), captureBeforeInHours),
      ...(staged ? { callhubCampaignPkStr: 'vb_1' } : {}),
    },
  })
  return spine.id
}

const readSatellite = (outreachId: number) =>
  service.prisma.outreachRobocall.findUniqueOrThrow({ where: { outreachId } })

describe('OutreachRobocallCompletionService.settle', () => {
  it('stops the CallHub campaign, records the full billable count, moves to settling, no money op', async () => {
    const outreachId = await createDraft({ billableCount: 100 })

    await completion.settle(outreachId, 'vb_1', 100)

    // Best-effort STOP: the pk_str is carried as a STRING end-to-end.
    const abortArg = abortSpy.mock.calls[0]?.[0]
    expect(abortArg).toBe('vb_1')
    expect(typeof abortArg).toBe('string')

    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.settling)
    // completedCallCount is the full billable count the estimate was based on,
    // so the capture slice bills the full authorized estimate.
    expect(satellite.completedCallCount).toBe(100)
    expect(satellite.completionPolledAt).not.toBeNull()
    // No PaymentIntent captured/voided: the hold fields are untouched and no
    // captured amount was written. Capture is the next slice.
    expect(satellite.authorizationIntentId).toBe('pi_1')
    expect(satellite.authorizedAmountInCents).toBe(450)
    expect(satellite.captureBefore).not.toBeNull()
    expect(satellite.capturedAmountInCents).toBeNull()
    expect(satellite.chargeIntentId).toBeNull()
  })

  it('settles anyway when the CallHub stop fails transiently (a 502)', async () => {
    const outreachId = await createDraft()
    abortSpy.mockRejectedValue(new BadGatewayException('stop down'))

    await completion.settle(outreachId, 'vb_1', 100)

    // A stop failure is cleanup-only — it must never block settlement or money.
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.settling,
    )
  })

  it('settles anyway when the CallHub stop fails permanently (the campaign is gone/retired)', async () => {
    const outreachId = await createDraft()
    abortSpy.mockRejectedValue(new CallhubPermanentError('gone'))

    await completion.settle(outreachId, 'vb_1', 100)

    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.settling,
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

  it('settles a dialed run past its run window, once, across repeat sweeps', async () => {
    const outreachId = await createDraft({
      dialedHoursAgo: ROBOCALL_RUN_HOURS + 1,
    })

    await completion.sweepRobocallCompletion()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.settling)
    expect(satellite.completedCallCount).toBe(100)
    expect(abortSpy).toHaveBeenCalledTimes(1)

    // A second sweep no longer finds it in `dialed`, so it is not re-stopped.
    await completion.sweepRobocallCompletion()
    expect(abortSpy).toHaveBeenCalledTimes(1)
  })

  it('does NOT settle a dialed run still inside the run window', async () => {
    const outreachId = await createDraft({
      dialedHoursAgo: 1,
      captureBeforeInHours: 24 * 5,
    })

    await completion.sweepRobocallCompletion()

    expect(abortSpy).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.dialed)
    expect(satellite.completedCallCount).toBeNull()
  })

  it('settles a run nearing its capture deadline even before the run window elapses', async () => {
    // Dialed recently (inside the run window) but the hold expires soon — settle
    // now so the hold never lapses uncaptured.
    const outreachId = await createDraft({
      dialedHoursAgo: 1,
      captureBeforeInHours: ROBOCALL_SETTLE_MARGIN_HOURS - 1,
    })

    await completion.sweepRobocallCompletion()

    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.settling,
    )
  })

  it('never settles an estimate-billed run (no authorization hold) even past its window', async () => {
    // A run charged upfront reaches `dialed` with NO authorizationIntentId; it is
    // already paid and must never enter settling/capturing (that would try to
    // capture a hold that does not exist and double-charge).
    const outreachId = await createDraft({ authorizationIntentId: null })

    await completion.sweepRobocallCompletion()

    expect(abortSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.dialed,
    )
  })

  it('skips a draft that is not dialed', async () => {
    const outreachId = await createDraft({
      settleState: RobocallSettleState.authorized,
    })

    await completion.sweepRobocallCompletion()

    expect(abortSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.authorized,
    )
  })

  it('elects a single settler when two sweeps race the same run', async () => {
    const outreachId = await createDraft()
    const infoSpy = vi.spyOn(
      (completion as unknown as { logger: PinoLogger }).logger,
      'info',
    )

    await Promise.all([
      completion.sweepRobocallCompletion(),
      completion.sweepRobocallCompletion(),
    ])

    // The dialed → settling CAS elects exactly one settler: a single transition,
    // logged once, even when two runners race the same draft in one slot.
    expect(infoSpy).toHaveBeenCalledTimes(1)
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.settling)
    expect(satellite.completedCallCount).toBe(100)
  })

  it('no-ops off prod', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    const outreachId = await createDraft()

    await completion.sweepRobocallCompletion()

    expect(abortSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.dialed,
    )
  })
})
