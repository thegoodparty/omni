import { randomUUID } from 'node:crypto'
import { addHours, subHours } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { OutreachRobocallBacklogAlertService } from '@/outreach/services/outreachRobocallBacklogAlert.service'
import { OutreachNotificationService } from '@/outreach/services/outreachNotification.service'
import {
  Campaign,
  OutreachStatus,
  RobocallSettleState,
} from '../../generated/prisma'

const service = useTestService()

let backlog: OutreachRobocallBacklogAlertService
let alertSpy: ReturnType<typeof vi.spyOn>

let campaign: Campaign
let orgSlug: string
let filterId: number

const originalEnv = process.env.OTEL_SERVICE_ENVIRONMENT

beforeEach(async () => {
  process.env.OTEL_SERVICE_ENVIRONMENT = 'prod'
  // The blocking-run fixture's audience is sized to spill a multi-day backlog at
  // a divisor of 2; pin it so these tests assert the projection BEHAVIOR, not the
  // shipping default (lowered to 1.1). The file-scope afterEach unstubs.
  vi.stubEnv('ROBOCALL_DIAL_SAFETY_RATE_DIVISOR', '2')
  backlog = service.app.get(OutreachRobocallBacklogAlertService)
  alertSpy = vi
    .spyOn(
      service.app.get(OutreachNotificationService),
      'notifyRobocallBacklogDelayed',
    )
    .mockResolvedValue()

  const campaignId = 995
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

const createRobocall = async ({
  sendInHours = 1,
  settleState = RobocallSettleState.authorized,
  staged = true,
  billableCount = 100,
  dialedAt = null,
  poolFreedAt = null,
  spineStatus = OutreachStatus.pending,
  backlogAlertedAt = null,
}: {
  sendInHours?: number
  settleState?: RobocallSettleState
  staged?: boolean
  billableCount?: number
  dialedAt?: Date | null
  poolFreedAt?: Date | null
  spineStatus?: OutreachStatus
  backlogAlertedAt?: Date | null
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
      audioKey: `robocall/995/${randomUUID()}.mp3`,
      callbackNumber: '+15125550123',
      billableCount,
      amountInCents: 450,
      settleState,
      compliancePassedAt: new Date(),
      authorizationIntentId: 'pi_1',
      ...(staged ? { callhubCampaignPkStr: 'vb_1' } : {}),
      ...(dialedAt ? { dialedAt } : {}),
      ...(poolFreedAt ? { poolFreedAt } : {}),
      ...(backlogAlertedAt ? { backlogAlertedAt } : {}),
    },
  })
  return spine.id
}

// A huge in-flight run holds the shared pool for many window-days, so any queued
// run projects a dial start well past its scheduled day — a deterministic
// backlog regardless of the wall-clock time the test runs at.
const createBlockingInFlightRun = () =>
  createRobocall({
    settleState: RobocallSettleState.dialed,
    billableCount: 50_000,
    dialedAt: subHours(new Date(), 1),
    poolFreedAt: null,
  })

const readSatellite = (outreachId: number) =>
  service.prisma.outreachRobocall.findUniqueOrThrow({ where: { outreachId } })

describe('OutreachRobocallBacklogAlertService.sweepBacklogAlerts (prod)', () => {
  it('alerts a future run the backlog pushes past its day and stamps backlogAlertedAt', async () => {
    await createBlockingInFlightRun()
    const outreachId = await createRobocall({ sendInHours: 1 })

    await backlog.sweepBacklogAlerts()

    expect(alertSpy).toHaveBeenCalledTimes(1)
    const [slug, id] = alertSpy.mock.calls[0] ?? []
    expect(slug).toBe('jane-doe')
    expect(id).toBe(outreachId)
    expect((await readSatellite(outreachId)).backlogAlertedAt).not.toBeNull()
  })

  it('projects a fractional divisor end-to-end (1.1 is read, not truncated)', async () => {
    // Proves the backlog service's envNumber accepts a fractional divisor: a
    // half-million-call blocking run spans many window-days even at ÷1.1's faster
    // safe rate, so the queued run is flagged. A truncation / NaN regression in the
    // shared parser would throw or mis-rate here rather than alert. (The boundary
    // case separating ÷1.1 from ÷1 can't be asserted non-flakily — the sweep reads
    // wall-clock now — so this only asserts the fractional path runs end-to-end.)
    vi.stubEnv('ROBOCALL_DIAL_SAFETY_RATE_DIVISOR', '1.1')
    await createRobocall({
      settleState: RobocallSettleState.dialed,
      billableCount: 500_000,
      dialedAt: subHours(new Date(), 1),
    })
    const outreachId = await createRobocall({ sendInHours: 1 })

    await backlog.sweepBacklogAlerts()

    expect(alertSpy).toHaveBeenCalledTimes(1)
    expect((await readSatellite(outreachId)).backlogAlertedAt).not.toBeNull()
  })

  it('does NOT alert when the pool is free before the run is due', async () => {
    // No in-flight run: the queued run starts at its own schedule, same day.
    const outreachId = await createRobocall({ sendInHours: 1 })

    await backlog.sweepBacklogAlerts()

    expect(alertSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).backlogAlertedAt).toBeNull()
  })

  it('does NOT alert an already-due run (the overdue sweep owns it)', async () => {
    // Past its send date and stuck behind a backlog: delayed, but not this
    // sweep's job — it only pages PROACTIVELY, before a run is late.
    await createBlockingInFlightRun()
    const outreachId = await createRobocall({ sendInHours: -2 })

    await backlog.sweepBacklogAlerts()

    expect(alertSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).backlogAlertedAt).toBeNull()
  })

  it('does NOT alert an authorized-but-UNSTAGED run', async () => {
    // The send sweep only launches staged runs, so an un-staged authorized run
    // is not in the queue the projection walks — counting it would risk burning
    // the one-shot dedupe stamp on a run that cannot yet dial.
    await createBlockingInFlightRun()
    const outreachId = await createRobocall({ sendInHours: 1, staged: false })

    await backlog.sweepBacklogAlerts()

    expect(alertSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).backlogAlertedAt).toBeNull()
  })

  it('does not re-alert on a second sweep (dedupe CAS)', async () => {
    await createBlockingInFlightRun()
    await createRobocall({ sendInHours: 1 })

    await backlog.sweepBacklogAlerts()
    await backlog.sweepBacklogAlerts()

    expect(alertSpy).toHaveBeenCalledTimes(1)
  })

  it('alerts once under a concurrent double-run (single-owner CAS)', async () => {
    await createBlockingInFlightRun()
    await createRobocall({ sendInHours: 1 })

    await Promise.all([
      backlog.sweepBacklogAlerts(),
      backlog.sweepBacklogAlerts(),
    ])

    expect(alertSpy).toHaveBeenCalledTimes(1)
  })

  it('does not alert a run already stamped (backlogAlertedAt set)', async () => {
    await createBlockingInFlightRun()
    await createRobocall({
      sendInHours: 1,
      backlogAlertedAt: subHours(new Date(), 1),
    })

    await backlog.sweepBacklogAlerts()

    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('does not alert a canceled run', async () => {
    await createBlockingInFlightRun()
    const outreachId = await createRobocall({
      sendInHours: 1,
      spineStatus: OutreachStatus.canceled,
    })

    await backlog.sweepBacklogAlerts()

    expect(alertSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).backlogAlertedAt).toBeNull()
  })

  it('does not alert a dialed run (not in the authorized queue)', async () => {
    // The in-flight blocker is itself `dialed`; it must never be alerted on.
    const blockerId = await createBlockingInFlightRun()

    await backlog.sweepBacklogAlerts()

    expect(alertSpy).not.toHaveBeenCalled()
    expect((await readSatellite(blockerId)).backlogAlertedAt).toBeNull()
  })

  it('no-ops off prod', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    await createBlockingInFlightRun()
    const outreachId = await createRobocall({ sendInHours: 1 })

    await backlog.sweepBacklogAlerts()

    expect(alertSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).backlogAlertedAt).toBeNull()
  })
})
