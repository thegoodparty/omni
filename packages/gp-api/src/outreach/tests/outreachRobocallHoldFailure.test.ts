import { randomUUID } from 'node:crypto'
import { addHours, format, subHours } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { OutreachRobocallHoldFailureService } from '@/outreach/services/outreachRobocallHoldFailure.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { Campaign, RobocallSettleState } from '../../generated/prisma'

const service = useTestService()

let holdFailure: OutreachRobocallHoldFailureService
let trackSpy: ReturnType<typeof vi.spyOn>

let campaign: Campaign
let orgSlug: string
let filterId: number

const originalEnv = process.env.OTEL_SERVICE_ENVIRONMENT

afterEach(() => {
  if (originalEnv === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
  else process.env.OTEL_SERVICE_ENVIRONMENT = originalEnv
})

beforeEach(async () => {
  holdFailure = service.app.get(OutreachRobocallHoldFailureService)
  // The sweeps are prod-only; default the suite to prod so the guarded path
  // runs, and the guard test overrides to dev.
  process.env.OTEL_SERVICE_ENVIRONMENT = 'prod'

  trackSpy = vi
    .spyOn(service.app.get(AnalyticsService), 'track')
    .mockResolvedValue(undefined as never)

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
  sendInHours = 24,
  settleState = RobocallSettleState.hold_failed,
  lastReminderSentAt,
}: {
  sendInHours?: number
  settleState?: RobocallSettleState
  lastReminderSentAt?: Date | null
} = {}): Promise<number> => {
  const spine = await service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: orgSlug,
      outreachType: 'robocall',
      status: 'pending_payment',
      date: addHours(new Date(), sendInHours),
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
      lastReminderSentAt: lastReminderSentAt ?? null,
    },
  })
  return spine.id
}

const readSatellite = (outreachId: number) =>
  service.prisma.outreachRobocall.findUniqueOrThrow({ where: { outreachId } })

describe('OutreachRobocallHoldFailureService reminders', () => {
  it('reminds a future-dated hold_failed draft once and stamps lastReminderSentAt', async () => {
    const outreachId = await createDraft()

    await holdFailure.sweepHoldFailureReminders()

    expect(trackSpy).toHaveBeenCalledTimes(1)
    const now = new Date()
    expect(trackSpy).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Robocall.Reminder,
      { outreachId },
      undefined,
      `${outreachId}:reminder:${format(now, 'yyyy-MM-dd')}`,
    )
    expect((await readSatellite(outreachId)).lastReminderSentAt).not.toBeNull()
  })

  it('does not re-remind on a second same-day sweep', async () => {
    await createDraft()

    await holdFailure.sweepHoldFailureReminders()
    await holdFailure.sweepHoldFailureReminders()

    expect(trackSpy).toHaveBeenCalledTimes(1)
  })

  it('re-reminds a draft last reminded more than a day ago', async () => {
    const outreachId = await createDraft({
      lastReminderSentAt: subHours(new Date(), 25),
    })

    await holdFailure.sweepHoldFailureReminders()

    expect(trackSpy).toHaveBeenCalledTimes(1)
    expect(trackSpy).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Robocall.Reminder,
      { outreachId },
      undefined,
      expect.stringContaining(`${outreachId}:reminder:`),
    )
  })

  it('does not remind a non-hold_failed draft', async () => {
    await createDraft({ settleState: RobocallSettleState.authorized })

    await holdFailure.sweepHoldFailureReminders()

    expect(trackSpy).not.toHaveBeenCalled()
  })

  it('does not remind a draft whose send deadline has passed', async () => {
    await createDraft({ sendInHours: -1 })

    await holdFailure.sweepHoldFailureReminders()

    expect(trackSpy).not.toHaveBeenCalled()
  })

  it('elects a single reminder under a concurrent double sweep', async () => {
    await createDraft()

    await Promise.all([
      holdFailure.sweepHoldFailureReminders(),
      holdFailure.sweepHoldFailureReminders(),
    ])

    expect(trackSpy).toHaveBeenCalledTimes(1)
  })
})

describe('OutreachRobocallHoldFailureService cancel-at-deadline', () => {
  it('cancels a past-deadline hold_failed draft and emits Canceled once', async () => {
    const outreachId = await createDraft({ sendInHours: -1 })

    await holdFailure.sweepHoldFailureCancellations()

    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.cancelled,
    )
    expect(trackSpy).toHaveBeenCalledTimes(1)
    expect(trackSpy).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Robocall.Canceled,
      { outreachId },
      undefined,
      `${outreachId}:canceled`,
    )
  })

  it('does not cancel a future-dated hold_failed draft', async () => {
    const outreachId = await createDraft({ sendInHours: 24 })

    await holdFailure.sweepHoldFailureCancellations()

    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.hold_failed,
    )
    expect(trackSpy).not.toHaveBeenCalled()
  })

  it('cancels once under a concurrent double run', async () => {
    const outreachId = await createDraft({ sendInHours: -1 })

    await Promise.all([
      holdFailure.cancelExpiredHoldFailure(outreachId),
      holdFailure.cancelExpiredHoldFailure(outreachId),
    ])

    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.cancelled,
    )
    expect(trackSpy).toHaveBeenCalledTimes(1)
  })
})

describe('OutreachRobocallHoldFailureService prod guard', () => {
  it('no-ops both sweeps off prod', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    const reminded = await createDraft({ sendInHours: 24 })
    const expired = await createDraft({ sendInHours: -1 })

    await holdFailure.sweepHoldFailureReminders()
    await holdFailure.sweepHoldFailureCancellations()

    expect(trackSpy).not.toHaveBeenCalled()
    expect((await readSatellite(reminded)).lastReminderSentAt).toBeNull()
    expect((await readSatellite(expired)).settleState).toBe(
      RobocallSettleState.hold_failed,
    )
  })
})
