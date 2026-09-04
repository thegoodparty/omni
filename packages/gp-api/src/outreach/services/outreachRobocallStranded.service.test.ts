import { randomUUID } from 'node:crypto'
import { addDays, addMinutes } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { OutreachRobocallHoldService } from '@/outreach/services/outreachRobocallHold.service'
import { OutreachRobocallStrandedService } from '@/outreach/services/outreachRobocallStranded.service'
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
  sendInMinutes,
  settleState = RobocallSettleState.authorized,
  callhubCampaignPkStr,
}: {
  sendInDays?: number
  sendInMinutes?: number
  settleState?: RobocallSettleState
  callhubCampaignPkStr?: string
} = {}): Promise<number> => {
  const spine = await service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: orgSlug,
      outreachType: 'robocall',
      status: 'pending',
      date:
        sendInMinutes !== undefined
          ? addMinutes(new Date(), sendInMinutes)
          : addDays(new Date(), sendInDays),
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

  beforeEach(() => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'prod'
  })
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
    else process.env.OTEL_SERVICE_ENVIRONMENT = originalEnv
  })

  it('fails a past-due authorized draft that never staged', async () => {
    const outreachId = await createDraft({ sendInDays: -1 })

    await stranded.sweepStrandedAuthorized()

    expect(failSendSpy).toHaveBeenCalledTimes(1)
    expect(failSendSpy).toHaveBeenCalledWith(outreachId, 'expired_unstaged')
  })

  it('fails a run past the grace period (beyond now - grace)', async () => {
    // Send passed 45 min ago — beyond ROBOCALL_STAGING_GRACE_MINUTES (30), so
    // staging can no longer rescue it and it is genuinely stranded.
    const outreachId = await createDraft({ sendInMinutes: -45 })

    await stranded.sweepStrandedAuthorized()

    expect(failSendSpy).toHaveBeenCalledTimes(1)
    expect(failSendSpy).toHaveBeenCalledWith(outreachId, 'expired_unstaged')
  })

  it('does NOT fail a run within the grace period (staging rescues it)', async () => {
    // Send passed only 10 min ago — inside the 30-min grace. This run is still
    // staging-eligible, so the stranded sweep must leave it `authorized` rather
    // than fail it. The shared `now - grace` boundary guarantees the two sweeps
    // never both act on one run.
    const outreachId = await createDraft({ sendInMinutes: -10 })

    await stranded.sweepStrandedAuthorized()

    expect(failSendSpy).not.toHaveBeenCalled()
    const row = await service.prisma.outreachRobocall.findUniqueOrThrow({
      where: { outreachId },
    })
    expect(row.settleState).toBe(RobocallSettleState.authorized)
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
