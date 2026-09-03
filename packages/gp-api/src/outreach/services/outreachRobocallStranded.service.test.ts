import { randomUUID } from 'node:crypto'
import { addDays } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PinoLogger } from 'nestjs-pino'
import { useTestService } from '@/test-service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { OutreachRobocallChargeService } from '@/outreach/services/outreachRobocallCharge.service'
import { OutreachRobocallHoldService } from '@/outreach/services/outreachRobocallHold.service'
import { OutreachRobocallStrandedService } from '@/outreach/services/outreachRobocallStranded.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { Campaign, RobocallSettleState } from '../../generated/prisma'

const service = useTestService()

let campaign: Campaign
let orgSlug: string
let filterId: number
let stranded: OutreachRobocallStrandedService
let failSendSpy: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  stranded = service.app.get(OutreachRobocallStrandedService)
  failSendSpy = vi
    .spyOn(service.app.get(OutreachRobocallHoldService), 'failSend')
    .mockResolvedValue(undefined)

  const campaignId = 994
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
  sendInDays = -1,
  settleState = RobocallSettleState.authorized,
  callhubCampaignPkStr,
}: {
  sendInDays?: number
  settleState?: RobocallSettleState
  callhubCampaignPkStr?: string
} = {}): Promise<number> => {
  const spine = await service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: orgSlug,
      outreachType: 'robocall',
      status: 'pending',
      date: addDays(new Date(), sendInDays),
      voterFileFilterId: filterId,
    },
  })
  await service.prisma.outreachRobocall.create({
    data: {
      outreachId: spine.id,
      audioKey: `robocall/994/${randomUUID()}.webm`,
      callbackNumber: '+15125550123',
      billableCount: 100,
      amountInCents: 450,
      settleState,
      authorizationIntentId: 'pi_hold_1',
      authorizedAmountInCents: 450,
      ...(callhubCampaignPkStr ? { callhubCampaignPkStr } : {}),
    },
  })
  return spine.id
}

describe('OutreachRobocallStrandedService.sweepStrandedAuthorized (prod)', () => {
  const originalEnv = process.env.OTEL_SERVICE_ENVIRONMENT
  const originalSend = process.env.ROBOCALL_SEND_ENABLED
  const originalCapture = process.env.ROBOCALL_CAPTURE_ENABLED

  beforeEach(() => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'prod'
    // The sweep is deliberately NOT kill-switch-gated: leave the send/capture
    // switches unset to prove it still runs.
    delete process.env.ROBOCALL_SEND_ENABLED
    delete process.env.ROBOCALL_CAPTURE_ENABLED
  })
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
    else process.env.OTEL_SERVICE_ENVIRONMENT = originalEnv
    if (originalSend === undefined) delete process.env.ROBOCALL_SEND_ENABLED
    else process.env.ROBOCALL_SEND_ENABLED = originalSend
    if (originalCapture === undefined) {
      delete process.env.ROBOCALL_CAPTURE_ENABLED
    } else {
      process.env.ROBOCALL_CAPTURE_ENABLED = originalCapture
    }
  })

  it('fails a past-due authorized draft that never staged', async () => {
    const outreachId = await createDraft({ sendInDays: -1 })

    await stranded.sweepStrandedAuthorized()

    expect(failSendSpy).toHaveBeenCalledTimes(1)
    expect(failSendSpy).toHaveBeenCalledWith(outreachId, 'expired_unstaged')
  })

  it('runs with the send/capture kill-switches unset (not gated)', async () => {
    await createDraft({ sendInDays: -1 })

    await stranded.sweepStrandedAuthorized()

    expect(failSendSpy).toHaveBeenCalledTimes(1)
  })

  it('skips a staged past-due authorized draft (send sweep owns it)', async () => {
    await createDraft({ sendInDays: -1, callhubCampaignPkStr: 'vb_staged' })

    await stranded.sweepStrandedAuthorized()

    expect(failSendSpy).not.toHaveBeenCalled()
  })

  it('skips a future-dated authorized draft', async () => {
    await createDraft({ sendInDays: 2 })

    await stranded.sweepStrandedAuthorized()

    expect(failSendSpy).not.toHaveBeenCalled()
  })

  it('skips past-due drafts in other settle states', async () => {
    await createDraft({
      sendInDays: -1,
      settleState: RobocallSettleState.staging,
    })
    await createDraft({
      sendInDays: -1,
      settleState: RobocallSettleState.pending_payment,
    })
    await createDraft({
      sendInDays: -1,
      settleState: RobocallSettleState.hold_failed,
    })

    await stranded.sweepStrandedAuthorized()

    expect(failSendSpy).not.toHaveBeenCalled()
  })

  it('continues past a failSend that throws for one record', async () => {
    const first = await createDraft({ sendInDays: -1 })
    const second = await createDraft({ sendInDays: -2 })
    failSendSpy.mockImplementation(async (outreachId: number) => {
      if (outreachId === first) throw new Error('void down')
    })

    await stranded.sweepStrandedAuthorized()

    expect(failSendSpy).toHaveBeenCalledWith(first, 'expired_unstaged')
    expect(failSendSpy).toHaveBeenCalledWith(second, 'expired_unstaged')
    expect(failSendSpy).toHaveBeenCalledTimes(2)
  })

  it('no-ops off prod', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    await createDraft({ sendInDays: -1 })

    await stranded.sweepStrandedAuthorized()

    expect(failSendSpy).not.toHaveBeenCalled()
  })
})

// A robocall whose ESTIMATE was charged up front (CONTINGENCY billing): `paid`
// with a committed chargeIntentId, no hold. Distinct from the hold-model draft
// createDraft builds above (authorized + authorizationIntentId).
const createPaidDraft = async ({
  sendInDays = -1,
  callhubCampaignPkStr,
  chargeIntentId = 'pi_charge_1',
}: {
  sendInDays?: number
  callhubCampaignPkStr?: string
  chargeIntentId?: string | null
} = {}): Promise<number> => {
  const spine = await service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: orgSlug,
      outreachType: 'robocall',
      status: 'pending',
      date: addDays(new Date(), sendInDays),
      voterFileFilterId: filterId,
    },
  })
  await service.prisma.outreachRobocall.create({
    data: {
      outreachId: spine.id,
      audioKey: `robocall/994/${randomUUID()}.webm`,
      callbackNumber: '+15125550123',
      billableCount: 100,
      amountInCents: 450,
      settleState: RobocallSettleState.paid,
      authorizedAmountInCents: 450,
      capturedAmountInCents: 450,
      ...(chargeIntentId ? { chargeIntentId } : {}),
      ...(callhubCampaignPkStr ? { callhubCampaignPkStr } : {}),
    },
  })
  return spine.id
}

describe('OutreachRobocallStrandedService.sweepStrandedPaid (estimate model)', () => {
  const originalFlag = process.env.ROBOCALL_ESTIMATE_BILLING_ENABLED
  let charge: OutreachRobocallChargeService
  let trackSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    process.env.ROBOCALL_ESTIMATE_BILLING_ENABLED = 'true'
    charge = service.app.get(OutreachRobocallChargeService)
    trackSpy = vi
      .spyOn(service.app.get(AnalyticsService), 'track')
      .mockResolvedValue(undefined as never)
  })
  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.ROBOCALL_ESTIMATE_BILLING_ENABLED
    } else {
      process.env.ROBOCALL_ESTIMATE_BILLING_ENABLED = originalFlag
    }
  })

  const readSatellite = (outreachId: number) =>
    service.prisma.outreachRobocall.findUniqueOrThrow({ where: { outreachId } })

  it('fails a past-due paid unstaged run → send_failed + spine failed + CRITICAL + SendFailed', async () => {
    const outreachId = await createPaidDraft({ sendInDays: -1 })
    const errorSpy = vi.spyOn(
      (charge as unknown as { logger: PinoLogger }).logger,
      'error',
    )

    await stranded.sweepStrandedPaid()

    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.send_failed,
    )
    const spine = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: outreachId },
    })
    expect(spine.status).toBe('failed')
    // The CRITICAL line pages ops for a manual refund (no auto-refund here).
    expect(errorSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('CRITICAL'),
    )
    expect(trackSpy).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Robocall.SendFailed,
      { outreachId },
      undefined,
      `${outreachId}:send_failed`,
    )
  })

  it('does not touch a paid run that is already staged (pk_str set)', async () => {
    const outreachId = await createPaidDraft({
      sendInDays: -1,
      callhubCampaignPkStr: 'vb_staged',
    })

    await stranded.sweepStrandedPaid()

    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.paid,
    )
    expect(trackSpy).not.toHaveBeenCalled()
  })

  it('does not touch a future-dated paid run', async () => {
    const outreachId = await createPaidDraft({ sendInDays: 2 })

    await stranded.sweepStrandedPaid()

    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.paid,
    )
    expect(trackSpy).not.toHaveBeenCalled()
  })

  it('is inert when the estimate-billing flag is OFF', async () => {
    delete process.env.ROBOCALL_ESTIMATE_BILLING_ENABLED
    const outreachId = await createPaidDraft({ sendInDays: -1 })

    await stranded.sweepStrandedPaid()

    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.paid,
    )
    expect(trackSpy).not.toHaveBeenCalled()
  })

  it('leaves a hold-model authorized draft to the stranded-authorized sweep', async () => {
    const outreachId = await createDraft({ sendInDays: -1 })

    await stranded.sweepStrandedPaid()

    // The paid sweep never touches an `authorized` row.
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.authorized,
    )
    expect(trackSpy).not.toHaveBeenCalled()
  })
})
