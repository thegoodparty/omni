import { randomUUID } from 'node:crypto'
import { addHours, subHours, subMinutes } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { OutreachRobocallOverdueAlertService } from '@/outreach/services/outreachRobocallOverdueAlert.service'
import { OutreachNotificationService } from '@/outreach/services/outreachNotification.service'
import {
  Campaign,
  OutreachStatus,
  RobocallSettleState,
} from '../../generated/prisma'

const service = useTestService()

let overdue: OutreachRobocallOverdueAlertService
let alertSpy: ReturnType<typeof vi.spyOn>

let campaign: Campaign
let orgSlug: string
let filterId: number

const originalEnv = process.env.OTEL_SERVICE_ENVIRONMENT

beforeEach(async () => {
  process.env.OTEL_SERVICE_ENVIRONMENT = 'prod'
  overdue = service.app.get(OutreachRobocallOverdueAlertService)
  alertSpy = vi
    .spyOn(
      service.app.get(OutreachNotificationService),
      'notifyRobocallOverdue',
    )
    .mockResolvedValue()

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

afterEach(() => {
  if (originalEnv === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
  else process.env.OTEL_SERVICE_ENVIRONMENT = originalEnv
})

const createDraft = async ({
  sendInHours = -3,
  settleState = RobocallSettleState.authorized,
  staged = true,
  dialedAt = null,
  spineStatus = OutreachStatus.pending,
  overdueAlertedAt = null,
}: {
  sendInHours?: number
  settleState?: RobocallSettleState
  staged?: boolean
  dialedAt?: Date | null
  spineStatus?: OutreachStatus
  overdueAlertedAt?: Date | null
} = {}): Promise<number> => {
  const spine = await service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: orgSlug,
      outreachType: 'robocall',
      status: spineStatus,
      date: addHours(new Date(), sendInHours),
      voterFileFilterId: filterId,
    },
  })
  await service.prisma.outreachRobocall.create({
    data: {
      outreachId: spine.id,
      audioKey: `robocall/994/${randomUUID()}.mp3`,
      callbackNumber: '+15125550123',
      billableCount: 100,
      amountInCents: 450,
      settleState,
      compliancePassedAt: new Date(),
      authorizationIntentId: 'pi_1',
      ...(staged ? { callhubCampaignPkStr: 'vb_1' } : {}),
      ...(dialedAt ? { dialedAt } : {}),
      ...(overdueAlertedAt ? { overdueAlertedAt } : {}),
    },
  })
  return spine.id
}

const readSatellite = (outreachId: number) =>
  service.prisma.outreachRobocall.findUniqueOrThrow({ where: { outreachId } })

describe('OutreachRobocallOverdueAlertService.sweepOverdueAlerts (prod)', () => {
  it('alerts once for a STAGED past-due undialed run and stamps overdueAlertedAt', async () => {
    // The exact silent-tail gap the stranded sweep SKIPS: authorized AND staged
    // (callhubCampaignPkStr set), past its send date, never dialed.
    const outreachId = await createDraft({ staged: true })

    await overdue.sweepOverdueAlerts()

    expect(alertSpy).toHaveBeenCalledTimes(1)
    const [slug, id, , , state] = alertSpy.mock.calls[0] ?? []
    expect(slug).toBe('jane-doe')
    expect(id).toBe(outreachId)
    expect(state).toBe(RobocallSettleState.authorized)
    expect((await readSatellite(outreachId)).overdueAlertedAt).not.toBeNull()
  })

  it('alerts for a run stuck in `staging` too', async () => {
    const outreachId = await createDraft({
      settleState: RobocallSettleState.staging,
    })

    await overdue.sweepOverdueAlerts()

    expect(alertSpy).toHaveBeenCalledTimes(1)
    expect((await readSatellite(outreachId)).overdueAlertedAt).not.toBeNull()
  })

  it('alerts for a never-staged authorized run (callhubCampaignPkStr null)', async () => {
    const outreachId = await createDraft({ staged: false })

    await overdue.sweepOverdueAlerts()

    expect(alertSpy).toHaveBeenCalledTimes(1)
    expect((await readSatellite(outreachId)).overdueAlertedAt).not.toBeNull()
  })

  it('does NOT re-alert on a second sweep (dedupe CAS)', async () => {
    await createDraft({ staged: true })

    await overdue.sweepOverdueAlerts()
    await overdue.sweepOverdueAlerts()

    expect(alertSpy).toHaveBeenCalledTimes(1)
  })

  it('alerts once under a concurrent double-run (single-owner CAS)', async () => {
    await createDraft({ staged: true })

    await Promise.all([
      overdue.sweepOverdueAlerts(),
      overdue.sweepOverdueAlerts(),
    ])

    expect(alertSpy).toHaveBeenCalledTimes(1)
  })

  it('does not alert a run already stamped (overdueAlertedAt set)', async () => {
    await createDraft({
      staged: true,
      overdueAlertedAt: subHours(new Date(), 1),
    })

    await overdue.sweepOverdueAlerts()

    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('does not alert a dialed run', async () => {
    await createDraft({
      settleState: RobocallSettleState.dialed,
      dialedAt: subHours(new Date(), 1),
    })

    await overdue.sweepOverdueAlerts()

    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('does not alert a canceled run', async () => {
    await createDraft({ spineStatus: OutreachStatus.canceled })

    await overdue.sweepOverdueAlerts()

    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('does not alert a failed run', async () => {
    await createDraft({
      settleState: RobocallSettleState.send_failed,
      spineStatus: OutreachStatus.failed,
    })

    await overdue.sweepOverdueAlerts()

    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('does not alert a future (not yet due) run', async () => {
    await createDraft({ sendInHours: 2 })

    await overdue.sweepOverdueAlerts()

    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('does not alert a run overdue by less than the grace', async () => {
    // Past its send time but only by 10 minutes: the next send-sweep pass is
    // about to dial it, so paging now would be a false alarm.
    const spine = await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        organizationSlug: orgSlug,
        outreachType: 'robocall',
        status: OutreachStatus.pending,
        date: subMinutes(new Date(), 10),
        voterFileFilterId: filterId,
      },
    })
    await service.prisma.outreachRobocall.create({
      data: {
        outreachId: spine.id,
        audioKey: `robocall/994/${randomUUID()}.mp3`,
        callbackNumber: '+15125550123',
        billableCount: 100,
        amountInCents: 450,
        settleState: RobocallSettleState.authorized,
        compliancePassedAt: new Date(),
        callhubCampaignPkStr: 'vb_1',
        authorizationIntentId: 'pi_1',
      },
    })

    await overdue.sweepOverdueAlerts()

    expect(alertSpy).not.toHaveBeenCalled()
    expect((await readSatellite(spine.id)).overdueAlertedAt).toBeNull()
  })

  it('no-ops off prod', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    const outreachId = await createDraft({ staged: true })

    await overdue.sweepOverdueAlerts()

    expect(alertSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).overdueAlertedAt).toBeNull()
  })
})
