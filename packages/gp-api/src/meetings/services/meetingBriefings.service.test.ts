import {
  ExperimentRun,
  ExperimentRunStatus,
  MeetingResourceLocationType,
} from '../../generated/prisma'
import { subDays } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { CommunityIssueDispatchService } from '@/communityIssues/services/communityIssueDispatch.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { useTestService } from '@/test-service'
// Imported after useTestService: analytics.service sits on a circular import
// chain (analytics -> users -> campaigns -> analytics) and must not be the
// first app-graph module evaluated, or Nest sees an undefined DI token.
import { AnalyticsService } from '@/analytics/analytics.service'
import { MeetingBriefingsService } from './meetingBriefings.service'

const service = useTestService()

// Most suites below exercise dispatch paths that (as of the activity-gated
// dispatch feature) skip inactive users. Default the shared test user to
// "active" so those paths are unaffected — the dedicated activity-gate tests
// further down set an explicit stale/absent lastVisited instead.
beforeEach(async () => {
  await service.prisma.user.update({
    where: { id: service.user.id },
    data: { metaData: { lastVisited: Date.now() } },
  })
})

const seedOrgAndCampaign = async (
  orgSlug: string,
  options: {
    positionId?: string
    overrideDistrictId?: string
    customPositionName?: string
  } = {},
) => {
  await service.prisma.organization.create({
    data: {
      slug: orgSlug,
      ownerId: service.user.id,
      positionId: options.positionId ?? null,
      overrideDistrictId: options.overrideDistrictId ?? null,
      customPositionName: options.customPositionName ?? null,
    },
  })
  await service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: `test-campaign-${orgSlug}`,
      organizationSlug: orgSlug,
      details: {},
    },
  })
}

const mockS3 = (responses: Record<string, string | undefined>) => {
  vi.spyOn(service.app.get(S3Service), 'getFile').mockImplementation(
    async (_bucket, key) => responses[key],
  )
}

const mockResolveServeContext = (
  result: Awaited<ReturnType<OrganizationsService['resolveServeContext']>>,
) => {
  const spy = vi.spyOn(
    service.app.get(OrganizationsService),
    'resolveServeContext',
  )
  spy.mockResolvedValue(result)
  return spy
}

/**
 * Seed a meeting_schedule ExperimentRun and mock S3 to return its
 * artifact when the briefing service calls loadLatestScheduleForOrg.
 *
 * Defaults: FREQ=DAILY with time 23:59 in America/Chicago — guarantees
 * the schedule projects a meeting inside any reasonable test window so
 * the imminence gate passes. Tests that need a meeting OUTSIDE the
 * window can pass a long-interval RRULE explicitly.
 */
const seedScheduleForOrg = async (
  orgSlug: string,
  schedule: Partial<{
    status: 'found' | 'not_found'
    rrule: string
    time: string
    timezone: string
    duration_minutes: number
    meeting_name: string
    location: string
  }> = {},
) => {
  const artifactKey = `schedule-${orgSlug}.json`
  const body = {
    status: schedule.status ?? 'found',
    rrule: schedule.rrule ?? 'FREQ=DAILY',
    time: schedule.time ?? '23:59',
    timezone: schedule.timezone ?? 'America/Chicago',
    duration_minutes: schedule.duration_minutes ?? 120,
    meeting_name: schedule.meeting_name ?? 'City Council',
    location: schedule.location ?? 'Council Chambers',
    sources: [],
    generated_at: new Date().toISOString(),
    human: 'Daily test schedule',
  }
  await service.prisma.experimentRun.create({
    data: {
      organizationSlug: orgSlug,
      experimentType: 'meeting_schedule',
      status: ExperimentRunStatus.COMPLETED,
      artifactBucket: 'schedule-bucket',
      artifactKey,
    },
  })
  mockS3({ [artifactKey]: JSON.stringify(body) })
  return artifactKey
}

describe('POST /v1/elected-office dispatches schedule only (briefing chains via onExperimentRunCompleted)', () => {
  beforeEach(() => {
    vi.stubEnv('MEETINGS_AUTOMATION_ENABLED', 'true')
    mockResolveServeContext(null)
    vi.spyOn(
      service.app.get(CommunityIssueDispatchService),
      'onElectedOfficeCreated',
    ).mockResolvedValue(undefined)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('skips dispatch when MEETINGS_AUTOMATION_ENABLED is unset', async () => {
    vi.stubEnv('MEETINGS_AUTOMATION_ENABLED', '')
    const orgSlug = `eo-gate-${Date.now()}`
    await seedOrgAndCampaign(orgSlug, { positionId: 'br-pos-gate' })

    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)

    const res = await service.client.post(
      '/v1/elected-office',
      {},
      { headers: { 'x-organization-slug': orgSlug } },
    )

    expect(res.status).toBe(200)
    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('dispatches meeting_schedule only (briefing fires later after the schedule completes)', async () => {
    const orgSlug = `eo-create-${Date.now()}`
    await seedOrgAndCampaign(orgSlug, { positionId: 'br-pos-123' })

    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      isServeIcp: true,
    })
    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)

    const res = await service.client.post(
      '/v1/elected-office',
      {},
      { headers: { 'x-organization-slug': orgSlug } },
    )

    expect(res.status).toBe(200)
    // Only the schedule fires on creation. The briefing is chained later
    // in onExperimentRunCompleted once the schedule lands and the
    // imminence gate confirms a meeting inside the 3-day window.
    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'meeting_schedule',
      organizationSlug: expect.stringMatching(/^eo-/) as string,
      clerkUserId: service.user.clerkId!,
      priority: 'HIGH',
      params: {
        elected_office_id: res.data.id as string,
        state: 'MN',
        office: 'City Council',
      },
    })
  })

  it('does not dispatch when org has no position', async () => {
    const orgSlug = `eo-no-position-${Date.now()}`
    await seedOrgAndCampaign(orgSlug)

    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)

    const res = await service.client.post(
      '/v1/elected-office',
      {},
      { headers: { 'x-organization-slug': orgSlug } },
    )

    expect(res.status).toBe(200)
    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('skips schedule dispatch when a schedule run already exists for the org', async () => {
    const suffix = Date.now()
    const owner = await service.prisma.user.create({
      data: { email: `dedup-${suffix}@example.com` },
    })
    const orgSlug = `eo-dedup-${suffix}`
    await service.prisma.organization.create({
      data: { slug: orgSlug, ownerId: owner.id },
    })
    const electedOffice = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: owner.id },
    })
    await seedScheduleForOrg(orgSlug)

    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)

    await service.app
      .get(MeetingBriefingsService)
      .onElectedOfficeCreated(electedOffice)

    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('skips schedule dispatch when a QUEUED schedule run already exists for the org', async () => {
    const suffix = Date.now()
    const owner = await service.prisma.user.create({
      data: { email: `dedup-queued-${suffix}@example.com` },
    })
    const orgSlug = `eo-dedup-queued-${suffix}`
    await service.prisma.organization.create({
      data: { slug: orgSlug, ownerId: owner.id },
    })
    const electedOffice = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: owner.id },
    })
    await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'meeting_schedule',
        status: ExperimentRunStatus.QUEUED,
      },
    })

    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)

    await service.app
      .get(MeetingBriefingsService)
      .onElectedOfficeCreated(electedOffice)

    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('re-dispatches when the only existing schedule run failed', async () => {
    const suffix = Date.now()
    const owner = await service.prisma.user.create({
      data: {
        email: `failed-run-${suffix}@example.com`,
        clerkId: `clerk-${suffix}`,
        firstName: 'Test',
        lastName: 'Official',
      },
    })
    const orgSlug = `eo-failed-${suffix}`
    await service.prisma.organization.create({
      data: { slug: orgSlug, ownerId: owner.id, positionId: 'br-pos-failed' },
    })
    const electedOffice = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: owner.id },
    })
    await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'meeting_schedule',
        status: ExperimentRunStatus.FAILED,
      },
    })

    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      isServeIcp: true,
    })
    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)

    await service.app
      .get(MeetingBriefingsService)
      .onElectedOfficeCreated(electedOffice)

    expect(dispatchSpy).toHaveBeenCalledTimes(1)
  })
})

describe('MeetingBriefingsService.onExperimentRunCompleted', () => {
  beforeEach(() => {
    vi.stubEnv('MEETINGS_AUTOMATION_ENABLED', 'true')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('chains a briefing dispatch when schedule completion shows a meeting inside the 3-day window', async () => {
    const orgSlug = `eo-chain-imminent-${Date.now()}`
    await seedOrgAndCampaign(orgSlug, { positionId: 'br-pos-chain-imminent' })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      isServeIcp: true,
    })
    const artifactKey = await seedScheduleForOrg(orgSlug) // FREQ=DAILY → always inside window
    const scheduleRun = await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'meeting_schedule',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'schedule-bucket',
        artifactKey,
        params: { elected_office_id: eo.id },
      },
    })
    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)

    await service.app
      .get(MeetingBriefingsService)
      .onExperimentRunCompleted(scheduleRun)

    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'meeting_briefing',
        params: expect.objectContaining({
          meetingDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as string,
          meetingTime: '23:59',
          meetingTimezone: 'America/Chicago',
        }),
      }),
    )
  })

  it('chains a briefing even when the office user has never visited (activity gate skipped)', async () => {
    // This hook exists to guarantee a newly onboarded office gets its first
    // briefing. A sales-provisioned office's user may have no lastVisited at
    // all yet -- that must not be treated as "inactive" and silently drop
    // the very first briefing (see dispatchBriefingIfDue's identical
    // skipActivityGate reasoning: reaching this point already proves the
    // office is real and eligible, independent of the user's own activity).
    const orgSlug = `eo-chain-never-visited-${Date.now()}`
    await seedOrgAndCampaign(orgSlug, {
      positionId: 'br-pos-chain-never-visited',
    })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { metaData: {} },
    })
    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      isServeIcp: true,
    })
    const artifactKey = await seedScheduleForOrg(orgSlug) // FREQ=DAILY → always inside window
    const scheduleRun = await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'meeting_schedule',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'schedule-bucket',
        artifactKey,
        params: { elected_office_id: eo.id },
      },
    })
    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)

    await service.app
      .get(MeetingBriefingsService)
      .onExperimentRunCompleted(scheduleRun)

    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'meeting_briefing' }),
    )
  })

  it('does not chain a briefing when schedule completion shows no meeting inside the 3-day window', async () => {
    // Pin the clock to mid-year so Jan 1 (the next YEARLY occurrence) is
    // far outside the 3-day window. Without this, runs between roughly
    // Dec 27 and Jan 1 would see Jan 1 INSIDE the window and the test
    // would flake.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'))
    try {
      const orgSlug = `eo-chain-far-${Date.now()}`
      await seedOrgAndCampaign(orgSlug, { positionId: 'br-pos-chain-far' })
      const eo = await service.prisma.electedOffice.create({
        data: { organizationSlug: orgSlug, userId: service.user.id },
      })
      mockResolveServeContext({
        state: 'MN',
        positionName: 'City Council',
        isServeIcp: true,
      })
      const artifactKey = await seedScheduleForOrg(orgSlug, {
        rrule: 'FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1',
      })
      const scheduleRun = await service.prisma.experimentRun.create({
        data: {
          organizationSlug: orgSlug,
          experimentType: 'meeting_schedule',
          status: ExperimentRunStatus.COMPLETED,
          artifactBucket: 'schedule-bucket',
          artifactKey,
          params: { elected_office_id: eo.id },
        },
      })
      const dispatchSpy = vi
        .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
        .mockResolvedValue(undefined)

      await service.app
        .get(MeetingBriefingsService)
        .onExperimentRunCompleted(scheduleRun)

      expect(dispatchSpy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not chain a briefing when schedule completion has status not_found', async () => {
    const orgSlug = `eo-chain-not-found-${Date.now()}`
    await seedOrgAndCampaign(orgSlug, { positionId: 'br-pos-chain-not-found' })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      isServeIcp: true,
    })
    const artifactKey = await seedScheduleForOrg(orgSlug, {
      status: 'not_found',
    })
    const scheduleRun = await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'meeting_schedule',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'schedule-bucket',
        artifactKey,
        params: { elected_office_id: eo.id },
      },
    })
    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)

    await service.app
      .get(MeetingBriefingsService)
      .onExperimentRunCompleted(scheduleRun)

    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('upserts MeetingBriefing row on briefing completion (time + tz from artifact, no schedule needed)', async () => {
    const orgSlug = `eo-upsert-${Date.now()}`
    await service.prisma.organization.create({
      data: { slug: orgSlug, ownerId: service.user.id },
    })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    const briefingRun = await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'meeting_briefing',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'briefing-bucket',
        artifactKey: 'briefing.json',
        params: { elected_office_id: eo.id },
      },
    })
    mockS3({
      'briefing.json': JSON.stringify({
        briefing_status: 'briefing_ready',
        meeting_date: '2026-06-08',
        meeting_time: '19:00',
        meeting_timezone: 'America/Chicago',
        meeting_name: 'City Council',
        location: 'Council Chambers',
      }),
    })

    await service.app
      .get(MeetingBriefingsService)
      .onExperimentRunCompleted(briefingRun)

    const row = await service.prisma.meetingBriefing.findUnique({
      where: {
        electedOfficeId_meetingDate: {
          electedOfficeId: eo.id,
          meetingDate: new Date('2026-06-08'),
        },
      },
    })
    expect(row).not.toBeNull()
    expect(row?.meetingTime).toBe('19:00')
    expect(row?.meetingTimezone).toBe('America/Chicago')
    expect(row?.artifactBucket).toBe('briefing-bucket')
    expect(row?.artifactKey).toBe('briefing.json')
    expect(row?.experimentRunId).toBe(briefingRun.runId)
    expect(row?.artifact?.meeting_name).toBe('City Council')
    expect(row?.artifact?.location).toBe('Council Chambers')
  })

  it('does not write a row when meeting_time is missing or malformed', async () => {
    const orgSlug = `eo-bad-time-${Date.now()}`
    await service.prisma.organization.create({
      data: { slug: orgSlug, ownerId: service.user.id },
    })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    const briefingRun = await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'meeting_briefing',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'briefing-bucket',
        artifactKey: 'briefing.json',
        params: { elected_office_id: eo.id },
      },
    })
    mockS3({
      'briefing.json': JSON.stringify({
        briefing_status: 'briefing_ready',
        meeting_date: '2026-06-08',
        meeting_time: '7pm',
        meeting_timezone: 'America/Chicago',
      }),
    })

    await service.app
      .get(MeetingBriefingsService)
      .onExperimentRunCompleted(briefingRun)

    const row = await service.prisma.meetingBriefing.findUnique({
      where: {
        electedOfficeId_meetingDate: {
          electedOfficeId: eo.id,
          meetingDate: new Date('2026-06-08'),
        },
      },
    })
    expect(row).toBeNull()
  })

  it('does not write a row when meeting_timezone is missing', async () => {
    const orgSlug = `eo-no-tz-${Date.now()}`
    await service.prisma.organization.create({
      data: { slug: orgSlug, ownerId: service.user.id },
    })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    const briefingRun = await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'meeting_briefing',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'briefing-bucket',
        artifactKey: 'briefing.json',
        params: { elected_office_id: eo.id },
      },
    })
    mockS3({
      'briefing.json': JSON.stringify({
        briefing_status: 'briefing_ready',
        meeting_date: '2026-06-08',
        meeting_time: '19:00',
      }),
    })

    await service.app
      .get(MeetingBriefingsService)
      .onExperimentRunCompleted(briefingRun)

    const row = await service.prisma.meetingBriefing.findUnique({
      where: {
        electedOfficeId_meetingDate: {
          electedOfficeId: eo.id,
          meetingDate: new Date('2026-06-08'),
        },
      },
    })
    expect(row).toBeNull()
  })

  it('writes the row for agenda_provided_by_user even when meeting_time is empty', async () => {
    const orgSlug = `eo-user-agenda-${Date.now()}`
    await service.prisma.organization.create({
      data: { slug: orgSlug, ownerId: service.user.id },
    })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    const briefingRun = await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'meeting_briefing',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'briefing-bucket',
        artifactKey: 'briefing.json',
        params: { elected_office_id: eo.id },
      },
    })
    mockS3({
      'briefing.json': JSON.stringify({
        briefing_status: 'agenda_provided_by_user',
        meeting_date: '2026-06-08',
        meeting_time: '',
        meeting_timezone: '',
        meeting_name: 'Special Session',
      }),
    })

    await service.app
      .get(MeetingBriefingsService)
      .onExperimentRunCompleted(briefingRun)

    const row = await service.prisma.meetingBriefing.findUnique({
      where: {
        electedOfficeId_meetingDate: {
          electedOfficeId: eo.id,
          meetingDate: new Date('2026-06-08'),
        },
      },
    })
    expect(row).not.toBeNull()
    expect(row?.meetingTime).toBe('')
    expect(row?.meetingTimezone).toBe('')
    expect(row?.experimentRunId).toBe(briefingRun.runId)
    expect(row?.artifact?.meeting_name).toBe('Special Session')
  })

  it('does not write a MeetingBriefing row for placeholder briefing_status (awaiting_agenda)', async () => {
    const orgSlug = `eo-awaiting-${Date.now()}`
    await service.prisma.organization.create({
      data: { slug: orgSlug, ownerId: service.user.id },
    })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'meeting_schedule',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'schedule-bucket',
        artifactKey: 'schedule.json',
      },
    })
    const briefingRun = await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'meeting_briefing',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'briefing-bucket',
        artifactKey: 'briefing.json',
        params: { elected_office_id: eo.id },
      },
    })
    mockS3({
      'schedule.json': JSON.stringify({
        status: 'known',
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
        time: '19:00',
        timezone: 'America/Chicago',
        duration_minutes: 60,
      }),
      'briefing.json': JSON.stringify({
        briefing_status: 'awaiting_agenda',
        meeting_date: '2026-06-08',
        meeting_name: 'City Council',
        location: 'Council Chambers',
      }),
    })

    await service.app
      .get(MeetingBriefingsService)
      .onExperimentRunCompleted(briefingRun)

    const row = await service.prisma.meetingBriefing.findUnique({
      where: {
        electedOfficeId_meetingDate: {
          electedOfficeId: eo.id,
          meetingDate: new Date('2026-06-08'),
        },
      },
    })
    expect(row).toBeNull()
  })

  it('tracks Briefing Assistant - Agenda Not Created with daysUntilMeeting on a placeholder briefing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-06-05T12:00:00Z'))
    try {
      const orgSlug = `eo-track-awaiting-${Date.now()}`
      await service.prisma.organization.create({
        data: { slug: orgSlug, ownerId: service.user.id },
      })
      const eo = await service.prisma.electedOffice.create({
        data: { organizationSlug: orgSlug, userId: service.user.id },
      })
      const briefingRun = await service.prisma.experimentRun.create({
        data: {
          organizationSlug: orgSlug,
          experimentType: 'meeting_briefing',
          status: ExperimentRunStatus.COMPLETED,
          artifactBucket: 'briefing-bucket',
          artifactKey: 'briefing-track.json',
          params: { elected_office_id: eo.id, meetingDate: '2026-06-08' },
        },
      })
      mockS3({
        'briefing-track.json': JSON.stringify({
          briefing_status: 'awaiting_agenda',
          meeting_date: '2026-06-08',
          meeting_name: 'City Council',
        }),
      })
      const trackSpy = vi
        .spyOn(service.app.get(AnalyticsService), 'track')
        .mockResolvedValue({ event: 'stub', userId: 'stub' })

      await service.app
        .get(MeetingBriefingsService)
        .onExperimentRunCompleted(briefingRun)

      expect(trackSpy).toHaveBeenCalledWith(
        service.user.id,
        'Briefing Assistant - Agenda Not Created',
        {
          electedOfficeId: eo.id,
          experimentRunId: briefingRun.runId,
          briefingStatus: 'awaiting_agenda',
          meetingDate: new Date('2026-06-08').getTime(),
          daysUntilMeeting: 3,
        },
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('tracks Briefing Assistant - Agenda Not Created without date fields when no target date is known', async () => {
    const orgSlug = `eo-track-no-meeting-${Date.now()}`
    await service.prisma.organization.create({
      data: { slug: orgSlug, ownerId: service.user.id },
    })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    const briefingRun = await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'meeting_briefing',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'briefing-bucket',
        artifactKey: 'briefing-track-no-meeting.json',
        params: { elected_office_id: eo.id },
      },
    })
    mockS3({
      'briefing-track-no-meeting.json': JSON.stringify({
        briefing_status: 'no_meeting_found',
      }),
    })
    const trackSpy = vi
      .spyOn(service.app.get(AnalyticsService), 'track')
      .mockResolvedValue({ event: 'stub', userId: 'stub' })

    await service.app
      .get(MeetingBriefingsService)
      .onExperimentRunCompleted(briefingRun)

    expect(trackSpy).toHaveBeenCalledWith(
      service.user.id,
      'Briefing Assistant - Agenda Not Created',
      {
        electedOfficeId: eo.id,
        experimentRunId: briefingRun.runId,
        briefingStatus: 'no_meeting_found',
      },
    )
  })

  it('does not write a MeetingBriefing row when briefing_status is error', async () => {
    const orgSlug = `eo-error-${Date.now()}`
    await service.prisma.organization.create({
      data: { slug: orgSlug, ownerId: service.user.id },
    })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'meeting_schedule',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'schedule-bucket',
        artifactKey: 'schedule.json',
      },
    })
    const briefingRun = await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'meeting_briefing',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'briefing-bucket',
        artifactKey: 'briefing.json',
        params: { elected_office_id: eo.id },
      },
    })
    mockS3({
      'schedule.json': JSON.stringify({
        status: 'known',
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
        time: '19:00',
        timezone: 'America/Chicago',
        duration_minutes: 60,
      }),
      'briefing.json': JSON.stringify({
        briefing_status: 'error',
        meeting_date: '2026-06-08',
      }),
    })

    await service.app
      .get(MeetingBriefingsService)
      .onExperimentRunCompleted(briefingRun)

    const row = await service.prisma.meetingBriefing.findUnique({
      where: {
        electedOfficeId_meetingDate: {
          electedOfficeId: eo.id,
          meetingDate: new Date('2026-06-08'),
        },
      },
    })
    expect(row).toBeNull()
  })

  it('does not write a MeetingBriefing row when briefing_status is missing from the artifact', async () => {
    const orgSlug = `eo-missing-status-${Date.now()}`
    await service.prisma.organization.create({
      data: { slug: orgSlug, ownerId: service.user.id },
    })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'meeting_schedule',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'schedule-bucket',
        artifactKey: 'schedule.json',
      },
    })
    const briefingRun = await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'meeting_briefing',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'briefing-bucket',
        artifactKey: 'briefing.json',
        params: { elected_office_id: eo.id },
      },
    })
    mockS3({
      'schedule.json': JSON.stringify({
        status: 'known',
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
        time: '19:00',
        timezone: 'America/Chicago',
        duration_minutes: 60,
      }),
      'briefing.json': JSON.stringify({
        meeting_date: '2026-06-08',
        meeting_name: 'City Council',
        location: 'Council Chambers',
      }),
    })

    await service.app
      .get(MeetingBriefingsService)
      .onExperimentRunCompleted(briefingRun)

    const row = await service.prisma.meetingBriefing.findUnique({
      where: {
        electedOfficeId_meetingDate: {
          electedOfficeId: eo.id,
          meetingDate: new Date('2026-06-08'),
        },
      },
    })
    expect(row).toBeNull()
  })

  it('skips when run is not COMPLETED', async () => {
    const orgSlug = `eo-running-${Date.now()}`
    await service.prisma.organization.create({
      data: { slug: orgSlug, ownerId: service.user.id },
    })
    const runningRun = await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'meeting_schedule',
        status: ExperimentRunStatus.RUNNING,
      },
    })
    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)

    await service.app
      .get(MeetingBriefingsService)
      .onExperimentRunCompleted(runningRun)

    expect(dispatchSpy).not.toHaveBeenCalled()
  })
})

describe('MeetingBriefingsService.dispatchDailyBriefings', () => {
  beforeEach(async () => {
    vi.stubEnv('MEETINGS_AUTOMATION_ENABLED', 'true')
    mockResolveServeContext(null)
    // The cron claims a once-per-day lease; clear it so each test's first
    // invocation wins the claim (all tests run on the same UTC date).
    await service.prisma.cronRun.deleteMany({})
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('skips entirely when MEETINGS_AUTOMATION_ENABLED is unset', async () => {
    vi.stubEnv('MEETINGS_AUTOMATION_ENABLED', '')
    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)
    await service.app.get(MeetingBriefingsService).dispatchDailyBriefings()
    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('dispatches only for EOs without a future briefing (and only when schedule shows imminent meeting)', async () => {
    const orgSlugA = `eo-cron-a-${Date.now()}`
    await seedOrgAndCampaign(orgSlugA, { positionId: 'br-pos-cron-a' })
    const campaignA = await service.prisma.campaign.findFirst({
      where: { organizationSlug: orgSlugA },
    })
    const eoA = await service.prisma.electedOffice.create({
      data: {
        organizationSlug: orgSlugA,
        userId: service.user.id,
        campaignId: campaignA?.id,
      },
    })

    const otherUser = await service.prisma.user.create({
      data: {
        clerkId: 'user_clerk_cron_b',
        email: `cron-b-${Date.now()}@test.example`,
        firstName: 'A',
        lastName: 'B',
        metaData: { lastVisited: Date.now() },
      },
    })
    const orgSlugB = `eo-cron-b-${Date.now()}`
    await service.prisma.organization.create({
      data: {
        slug: orgSlugB,
        ownerId: otherUser.id,
        positionId: 'br-pos-cron-b',
      },
    })
    const campaignB = await service.prisma.campaign.create({
      data: {
        userId: otherUser.id,
        slug: `test-campaign-${orgSlugB}`,
        organizationSlug: orgSlugB,
        details: {},
      },
    })
    await service.prisma.electedOffice.create({
      data: {
        organizationSlug: orgSlugB,
        userId: otherUser.id,
        campaignId: campaignB.id,
      },
    })

    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      isServeIcp: true,
    })

    // Both orgs have schedules so the imminence gate passes. Org A also has
    // an existing future briefing → coverage dedupe skips it. Only B fires.
    await seedScheduleForOrg(orgSlugA)
    await seedScheduleForOrg(orgSlugB)

    const existingBriefingRun = await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlugA,
        experimentType: 'meeting_briefing',
        status: ExperimentRunStatus.COMPLETED,
      },
    })
    await service.prisma.meetingBriefing.create({
      data: {
        electedOfficeId: eoA.id,
        meetingDate: new Date('2099-12-31'),
        meetingTime: '19:00',
        meetingTimezone: 'America/Denver',
        experimentRunId: existingBriefingRun.runId,
        artifactBucket: 'b',
        artifactKey: 'existing.json',
      },
    })

    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)

    await service.app.get(MeetingBriefingsService).dispatchDailyBriefings()

    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'meeting_briefing',
        organizationSlug: orgSlugB,
        params: expect.objectContaining({
          positionName: 'City Council',
          meetingDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as string,
          meetingTime: '23:59',
          meetingTimezone: 'America/Chicago',
        }),
      }),
    )
  })

  it('skips an EO entirely when no meeting_schedule exists yet', async () => {
    const orgSlug = `eo-cron-no-schedule-${Date.now()}`
    await seedOrgAndCampaign(orgSlug, { positionId: 'br-pos-cron-no-sched' })
    const campaign = await service.prisma.campaign.findFirst({
      where: { organizationSlug: orgSlug },
    })
    await service.prisma.electedOffice.create({
      data: {
        organizationSlug: orgSlug,
        userId: service.user.id,
        campaignId: campaign?.id,
      },
    })
    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      isServeIcp: true,
    })
    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)

    await service.app.get(MeetingBriefingsService).dispatchDailyBriefings()

    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('skips an EO when the next meeting is outside the 3-day window', async () => {
    // Pin clock to mid-year so Jan 1 (the next YEARLY occurrence) is far
    // outside any 3-day window. Without pinning, runs near new year would
    // see Jan 1 inside the window and flake.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'))
    try {
      const orgSlug = `eo-cron-far-meeting-${Date.now()}`
      await seedOrgAndCampaign(orgSlug, { positionId: 'br-pos-cron-far' })
      const campaign = await service.prisma.campaign.findFirst({
        where: { organizationSlug: orgSlug },
      })
      await service.prisma.electedOffice.create({
        data: {
          organizationSlug: orgSlug,
          userId: service.user.id,
          campaignId: campaign?.id,
        },
      })
      mockResolveServeContext({
        state: 'MN',
        positionName: 'City Council',
        isServeIcp: true,
      })
      await seedScheduleForOrg(orgSlug, {
        rrule: 'FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1',
      })
      const dispatchSpy = vi
        .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
        .mockResolvedValue(undefined)

      await service.app.get(MeetingBriefingsService).dispatchDailyBriefings()

      expect(dispatchSpy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('runs the dispatch loop once when invoked twice the same day (multi-replica guard)', async () => {
    const orgSlug = `eo-cron-guard-${Date.now()}`
    await seedOrgAndCampaign(orgSlug, { positionId: 'br-pos-cron-guard' })
    const campaign = await service.prisma.campaign.findFirst({
      where: { organizationSlug: orgSlug },
    })
    await service.prisma.electedOffice.create({
      data: {
        organizationSlug: orgSlug,
        userId: service.user.id,
        campaignId: campaign?.id,
      },
    })

    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      isServeIcp: true,
    })
    await seedScheduleForOrg(orgSlug)

    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)

    const svc = service.app.get(MeetingBriefingsService)
    // Simulate both ECS replicas firing the cron on the same day. The second
    // invocation must lose the lease and skip the loop entirely.
    await svc.dispatchDailyBriefings()
    await svc.dispatchDailyBriefings()

    expect(dispatchSpy).toHaveBeenCalledTimes(1)
  })

  it('dispatches for EOs regardless of when they were created', async () => {
    const orgSlug = `eo-cron-old-${Date.now()}`
    await seedOrgAndCampaign(orgSlug, { positionId: 'br-pos-cron-old' })
    const campaign = await service.prisma.campaign.findFirst({
      where: { organizationSlug: orgSlug },
    })
    await service.prisma.electedOffice.create({
      data: {
        organizationSlug: orgSlug,
        userId: service.user.id,
        campaignId: campaign?.id,
        createdAt: new Date('2026-02-28T23:59:59.000Z'),
      },
    })

    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      isServeIcp: true,
    })
    await seedScheduleForOrg(orgSlug)

    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)

    await service.app.get(MeetingBriefingsService).dispatchDailyBriefings()

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'meeting_briefing',
        organizationSlug: orgSlug,
      }),
    )
  })

  it('skips an EO whose position is explicitly not serve-ICP', async () => {
    const orgSlug = `eo-cron-non-icp-${Date.now()}`
    await seedOrgAndCampaign(orgSlug, { positionId: 'br-pos-cron-non-icp' })
    const campaign = await service.prisma.campaign.findFirst({
      where: { organizationSlug: orgSlug },
    })
    await service.prisma.electedOffice.create({
      data: {
        organizationSlug: orgSlug,
        userId: service.user.id,
        campaignId: campaign?.id,
      },
    })

    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      isServeIcp: false,
    })
    await seedScheduleForOrg(orgSlug)

    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)

    await service.app.get(MeetingBriefingsService).dispatchDailyBriefings()

    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('skips an EO when serve-ICP is null (unknown fails closed)', async () => {
    const orgSlug = `eo-cron-null-icp-${Date.now()}`
    await seedOrgAndCampaign(orgSlug, { positionId: 'br-pos-cron-null-icp' })
    const campaign = await service.prisma.campaign.findFirst({
      where: { organizationSlug: orgSlug },
    })
    await service.prisma.electedOffice.create({
      data: {
        organizationSlug: orgSlug,
        userId: service.user.id,
        campaignId: campaign?.id,
      },
    })

    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      isServeIcp: null,
    })
    await seedScheduleForOrg(orgSlug)

    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)

    await service.app.get(MeetingBriefingsService).dispatchDailyBriefings()

    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  // Correctness of the DB-side pre-filter + bounded concurrency: with a mix of
  // offices in a single run, exactly the dispatch-eligible office fires. This
  // proves the pre-filter keeps every office that would have dispatched (A),
  // drops only offices that never could (B: no schedule, C: already covered by
  // a future briefing), and that an office which survives the pre-filter but is
  // skipped by a per-office guard (D) still does not dispatch — all while the
  // batch is processed concurrently.
  it('dispatches only the eligible office across a mixed population', async () => {
    const suffix = Date.now()

    const orgA = `eo-mix-a-${suffix}`
    await seedOrgAndCampaign(orgA, { positionId: `br-pos-${orgA}` })
    const eoA = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgA, userId: service.user.id },
    })

    const orgB = `eo-mix-b-${suffix}`
    await seedOrgAndCampaign(orgB, { positionId: `br-pos-${orgB}` })
    const eoB = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgB, userId: service.user.id },
    })

    const orgC = `eo-mix-c-${suffix}`
    await seedOrgAndCampaign(orgC, { positionId: `br-pos-${orgC}` })
    const eoC = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgC, userId: service.user.id },
    })

    const orgD = `eo-mix-d-${suffix}`
    await seedOrgAndCampaign(orgD, { positionId: `br-pos-${orgD}` })
    const eoD = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgD, userId: service.user.id },
    })

    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      isServeIcp: true,
    })

    const scheduleBody = (status: 'found' | 'not_found') =>
      JSON.stringify({
        status,
        rrule: 'FREQ=DAILY',
        time: '23:59',
        timezone: 'America/Chicago',
        duration_minutes: 120,
        meeting_name: 'City Council',
        location: 'Council Chambers',
        sources: [],
        generated_at: new Date().toISOString(),
        human: 'Daily test schedule',
      })

    // A + C + D have completed schedule runs (so they survive the pre-filter's
    // schedule predicate); B has none (excluded). C additionally has a future
    // briefing (excluded by the coverage predicate). D's schedule resolves to
    // not_found, so it survives the pre-filter but the per-office guard skips.
    const keyA = `sched-a-${suffix}.json`
    const keyC = `sched-c-${suffix}.json`
    const keyD = `sched-d-${suffix}.json`
    for (const [orgSlug, key] of [
      [orgA, keyA],
      [orgC, keyC],
      [orgD, keyD],
    ] as const) {
      await service.prisma.experimentRun.create({
        data: {
          organizationSlug: orgSlug,
          experimentType: 'meeting_schedule',
          status: ExperimentRunStatus.COMPLETED,
          artifactBucket: 'schedule-bucket',
          artifactKey: key,
        },
      })
    }

    const cBriefingRun = await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgC,
        experimentType: 'meeting_briefing',
        status: ExperimentRunStatus.COMPLETED,
      },
    })
    await service.prisma.meetingBriefing.create({
      data: {
        electedOfficeId: eoC.id,
        meetingDate: new Date('2099-12-31'),
        meetingTime: '19:00',
        meetingTimezone: 'America/Denver',
        experimentRunId: cBriefingRun.runId,
        artifactBucket: 'b',
        artifactKey: 'existing.json',
      },
    })

    mockS3({
      [keyA]: scheduleBody('found'),
      [keyC]: scheduleBody('found'),
      [keyD]: scheduleBody('not_found'),
    })

    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)
    // Spy (without mocking) on the cron's candidate query so we can assert the
    // pre-filter itself excludes C — not just the per-office coverage guard,
    // which would also skip C and make the outcome assertion tautological.
    const findManySpy = vi.spyOn(service.prisma.electedOffice, 'findMany')

    await service.app.get(MeetingBriefingsService).dispatchDailyBriefings()

    // The cron issues exactly one electedOffice.findMany, and its where clause
    // must carry BOTH pre-filter predicates. Deleting the coverage-dedupe
    // predicate (C's exclusion) or the schedule predicate (B's exclusion) fails
    // here, giving the DB-side optimization real coverage independent of the
    // per-office guard.
    expect(findManySpy).toHaveBeenCalledTimes(1)
    const cronQuery = findManySpy.mock.calls[0]?.[0]
    expect(cronQuery?.where?.meetingBriefings).toEqual({
      none: { meetingDate: { gte: expect.any(Date) as Date } },
    })
    expect(cronQuery?.where?.organization).toEqual({
      experimentRuns: {
        some: {
          experimentType: 'meeting_schedule',
          status: ExperimentRunStatus.COMPLETED,
          artifactBucket: { not: null },
          artifactKey: { not: null },
        },
      },
    })

    // And the pre-filtered candidate set the query returned excludes B (no
    // schedule) and C (future briefing) while keeping A and D.
    const returned: unknown = await findManySpy.mock.results[0]?.value
    const candidateIds = new Set<string>()
    if (Array.isArray(returned)) {
      for (const row of returned) {
        if (
          typeof row === 'object' &&
          row !== null &&
          'id' in row &&
          typeof row.id === 'string'
        ) {
          candidateIds.add(row.id)
        }
      }
    }
    expect(candidateIds.has(eoA.id)).toBe(true)
    expect(candidateIds.has(eoD.id)).toBe(true)
    expect(candidateIds.has(eoB.id)).toBe(false)
    expect(candidateIds.has(eoC.id)).toBe(false)

    // Only the eligible office (A) actually dispatches.
    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'meeting_briefing',
        organizationSlug: orgA,
      }),
    )
  })
})

describe('MeetingBriefingsService — activity-gated dispatch', () => {
  beforeEach(async () => {
    vi.stubEnv('MEETINGS_AUTOMATION_ENABLED', 'true')
    mockResolveServeContext(null)
    await service.prisma.cronRun.deleteMany({})
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const seedEligibleOffice = async (
    orgSlug: string,
    scheduleOverrides: Parameters<typeof seedScheduleForOrg>[1] = {},
  ) => {
    await seedOrgAndCampaign(orgSlug, { positionId: `br-pos-${orgSlug}` })
    const campaign = await service.prisma.campaign.findFirst({
      where: { organizationSlug: orgSlug },
    })
    const eo = await service.prisma.electedOffice.create({
      data: {
        organizationSlug: orgSlug,
        userId: service.user.id,
        campaignId: campaign?.id,
      },
    })
    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      isServeIcp: true,
    })
    await seedScheduleForOrg(orgSlug, scheduleOverrides)
    return eo
  }

  it('cron dispatches for a user active within the threshold', async () => {
    const orgSlug = `eo-active-${Date.now()}`
    await seedEligibleOffice(orgSlug)
    // Global beforeEach already sets service.user active; keep it explicit
    // here so the test doesn't rely on that default silently.
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { metaData: { lastVisited: Date.now() } },
    })
    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)

    await service.app.get(MeetingBriefingsService).dispatchDailyBriefings()

    expect(dispatchSpy).toHaveBeenCalledTimes(1)
  })

  it('cron skips and tracks a re-engagement event for a user inactive beyond the threshold', async () => {
    const orgSlug = `eo-inactive-${Date.now()}`
    // Distinct from the 'City Council' positionName set by mockResolveServeContext
    // inside seedEligibleOffice, so the meetingName assertion below only passes
    // if the code actually reads schedule.meeting_name.
    await seedEligibleOffice(orgSlug, { meeting_name: 'Planning Commission' })
    const staleLastVisited = subDays(new Date(), 91).getTime()
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { metaData: { lastVisited: staleLastVisited } },
    })
    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)
    const trackSpy = vi
      .spyOn(service.app.get(AnalyticsService), 'track')
      .mockResolvedValue({ event: 'stub', userId: 'stub' })

    await service.app.get(MeetingBriefingsService).dispatchDailyBriefings()

    expect(dispatchSpy).not.toHaveBeenCalled()
    expect(trackSpy).toHaveBeenCalledWith(
      service.user.id,
      'Briefing Assistant - Dispatch Skipped',
      expect.objectContaining({
        electedOfficeId: expect.any(String) as string,
        meetingDate: expect.any(Number) as number,
        meetingName: 'Planning Commission',
        daysUntilMeeting: expect.any(Number) as number,
        lastVisitedAt: staleLastVisited,
        daysSinceLastVisit: expect.any(Number) as number,
      }),
    )
  })

  it('on-demand path dispatches for an inactive user (activity gate skipped)', async () => {
    const orgSlug = `eo-ondemand-${Date.now()}`
    const eo = await seedEligibleOffice(orgSlug)
    const staleLastVisited = subDays(new Date(), 200).getTime()
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { metaData: { lastVisited: staleLastVisited } },
    })
    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)

    const result = await service.app
      .get(MeetingBriefingsService)
      .dispatchBriefingIfDue(eo)

    expect(result.dispatched).toBe(true)
    expect(dispatchSpy).toHaveBeenCalledTimes(1)
  })

  it('does not double-dispatch when a briefing run is already in flight (cron path)', async () => {
    const orgSlug = `eo-inflight-cron-${Date.now()}`
    await seedEligibleOffice(orgSlug)
    await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'meeting_briefing',
        status: ExperimentRunStatus.QUEUED,
        params: { meetingDate: '2099-01-01' },
      },
    })
    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)

    await service.app.get(MeetingBriefingsService).dispatchDailyBriefings()

    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('does not double-dispatch when a briefing run is already in flight (on-demand path)', async () => {
    const orgSlug = `eo-inflight-ondemand-${Date.now()}`
    const eo = await seedEligibleOffice(orgSlug)
    await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'meeting_briefing',
        status: ExperimentRunStatus.RUNNING,
        params: { meetingDate: '2099-01-01' },
      },
    })
    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)

    const result = await service.app
      .get(MeetingBriefingsService)
      .dispatchBriefingIfDue(eo)

    expect(result.dispatched).toBe(false)
    expect(result.inFlight).toBe(true)
    expect(result.meetingDate).toBe('2099-01-01')
    expect(dispatchSpy).not.toHaveBeenCalled()
  })
})

describe('MeetingBriefingsService.dispatchManual', () => {
  beforeEach(() => {
    mockResolveServeContext(null)
  })

  it('dispatches a schedule run regardless of the env gate', async () => {
    vi.stubEnv('MEETINGS_AUTOMATION_ENABLED', '')
    const orgSlug = `eo-manual-schedule-${Date.now()}`
    await seedOrgAndCampaign(orgSlug, { positionId: 'br-pos-manual-s' })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      isServeIcp: true,
    })
    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)

    const result = await service.app
      .get(MeetingBriefingsService)
      .dispatchManual(eo.id, 'schedule')

    expect(result.dispatched).toBe(true)
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'meeting_schedule' }),
    )
    vi.unstubAllEnvs()
  })

  it('dispatches a briefing run when kind is briefing (with meetingDate from schedule)', async () => {
    const orgSlug = `eo-manual-briefing-${Date.now()}`
    await seedOrgAndCampaign(orgSlug, { positionId: 'br-pos-manual-b' })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      isServeIcp: true,
    })
    await seedScheduleForOrg(orgSlug)
    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'manual-dispatch-run' } as ExperimentRun)

    const result = await service.app
      .get(MeetingBriefingsService)
      .dispatchManual(eo.id, 'briefing')

    expect(result.dispatched).toBe(true)
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'meeting_briefing',
        params: expect.objectContaining({
          meetingDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as string,
          meetingTime: '23:59',
          meetingTimezone: 'America/Chicago',
        }),
      }),
    )
  })

  it('dispatches a manual briefing at HIGH priority', async () => {
    const orgSlug = `eo-manual-briefing-high-${Date.now()}`
    await seedOrgAndCampaign(orgSlug, { positionId: 'br-pos-manual-b-high' })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      isServeIcp: true,
    })
    await seedScheduleForOrg(orgSlug)
    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'manual-dispatch-run' } as ExperimentRun)

    await service.app
      .get(MeetingBriefingsService)
      .dispatchManual(eo.id, 'briefing', false)

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 'HIGH' }),
    )
  })

  it('dispatches a manual schedule at HIGH priority', async () => {
    const orgSlug = `eo-manual-schedule-high-${Date.now()}`
    await seedOrgAndCampaign(orgSlug, { positionId: 'br-pos-manual-s-high' })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      isServeIcp: true,
    })
    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)

    await service.app
      .get(MeetingBriefingsService)
      .dispatchManual(eo.id, 'schedule')

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 'HIGH' }),
    )
  })

  it('does not dispatch a briefing manually when no schedule exists', async () => {
    const orgSlug = `eo-manual-no-sched-${Date.now()}`
    await seedOrgAndCampaign(orgSlug, { positionId: 'br-pos-manual-no-sched' })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      isServeIcp: true,
    })
    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)

    const result = await service.app
      .get(MeetingBriefingsService)
      .dispatchManual(eo.id, 'briefing')

    expect(result.dispatched).toBe(false)
    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('gated briefing dispatch proceeds for a serve-ICP position', async () => {
    const orgSlug = `eo-manual-gate-icp-${Date.now()}`
    await seedOrgAndCampaign(orgSlug, { positionId: 'br-pos-gate-icp' })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      isServeIcp: true,
    })
    await seedScheduleForOrg(orgSlug)
    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'manual-dispatch-run' } as ExperimentRun)

    const result = await service.app
      .get(MeetingBriefingsService)
      .dispatchManual(eo.id, 'briefing', true)

    expect(result.dispatched).toBe(true)
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'meeting_briefing' }),
    )
  })

  it('gated briefing dispatch skips a position that is not serve-ICP', async () => {
    const orgSlug = `eo-manual-gate-non-icp-${Date.now()}`
    await seedOrgAndCampaign(orgSlug, { positionId: 'br-pos-gate-non-icp' })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      isServeIcp: false,
    })
    await seedScheduleForOrg(orgSlug)
    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'manual-dispatch-run' } as ExperimentRun)

    const result = await service.app
      .get(MeetingBriefingsService)
      .dispatchManual(eo.id, 'briefing', true)

    expect(result.dispatched).toBe(false)
    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('gated briefing dispatch fails closed when serve-ICP is null', async () => {
    const orgSlug = `eo-manual-gate-null-icp-${Date.now()}`
    await seedOrgAndCampaign(orgSlug, { positionId: 'br-pos-gate-null-icp' })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      isServeIcp: null,
    })
    await seedScheduleForOrg(orgSlug)
    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'manual-dispatch-run' } as ExperimentRun)

    const result = await service.app
      .get(MeetingBriefingsService)
      .dispatchManual(eo.id, 'briefing', true)

    expect(result.dispatched).toBe(false)
    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('ungated briefing dispatch ignores serve-ICP', async () => {
    const orgSlug = `eo-manual-ungated-icp-${Date.now()}`
    await seedOrgAndCampaign(orgSlug, { positionId: 'br-pos-ungated-icp' })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      isServeIcp: false,
    })
    await seedScheduleForOrg(orgSlug)
    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'manual-dispatch-run' } as ExperimentRun)

    const result = await service.app
      .get(MeetingBriefingsService)
      .dispatchManual(eo.id, 'briefing')

    expect(result.dispatched).toBe(true)
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'meeting_briefing' }),
    )
  })

  it('returns dispatched:false for unknown electedOfficeId', async () => {
    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)
    const result = await service.app
      .get(MeetingBriefingsService)
      .dispatchManual('not-a-real-id', 'schedule')
    expect(result.dispatched).toBe(false)
    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('dispatches for override-only org (no positionId, overrideDistrictId + customPositionName set)', async () => {
    const orgSlug = `eo-override-${Date.now()}`
    await seedOrgAndCampaign(orgSlug, {
      overrideDistrictId: 'district-override-id',
      customPositionName: 'City Council Member',
    })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council Member',
      l2DistrictType: 'City',
      l2DistrictName: 'Minneapolis',
      isServeIcp: true,
    })
    await seedScheduleForOrg(orgSlug)
    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'manual-dispatch-run' } as ExperimentRun)

    const result = await service.app
      .get(MeetingBriefingsService)
      .dispatchManual(eo.id, 'briefing')

    expect(result.dispatched).toBe(true)
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'meeting_briefing',
      organizationSlug: orgSlug,
      clerkUserId: service.user.clerkId!,
      priority: 'HIGH',
      params: {
        officialName: `${service.user.firstName} ${service.user.lastName}`,
        state: 'MN',
        positionName: 'City Council Member',
        meetingDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as string,
        meetingTime: '23:59',
        meetingTimezone: 'America/Chicago',
        l2DistrictType: 'City',
        l2DistrictName: 'Minneapolis',
      },
    })
  })

  it('dispatches for position-based org (existing behavior: state + l2 from position)', async () => {
    const orgSlug = `eo-position-based-${Date.now()}`
    await seedOrgAndCampaign(orgSlug, { positionId: 'br-pos-based' })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    mockResolveServeContext({
      state: 'CA',
      positionName: 'School Board',
      l2DistrictType: 'SchoolDistrict',
      l2DistrictName: 'LAUSD',
      isServeIcp: true,
    })
    await seedScheduleForOrg(orgSlug)
    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'manual-dispatch-run' } as ExperimentRun)

    const result = await service.app
      .get(MeetingBriefingsService)
      .dispatchManual(eo.id, 'briefing')

    expect(result.dispatched).toBe(true)
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'meeting_briefing',
        params: expect.objectContaining({
          state: 'CA',
          positionName: 'School Board',
          l2DistrictType: 'SchoolDistrict',
          l2DistrictName: 'LAUSD',
          meetingDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as string,
        }),
      }),
    )
  })

  it('skips dispatch when resolveServeContext returns null (neither position nor override)', async () => {
    const orgSlug = `eo-no-ctx-${Date.now()}`
    await seedOrgAndCampaign(orgSlug)
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    mockResolveServeContext(null)
    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)

    const result = await service.app
      .get(MeetingBriefingsService)
      .dispatchManual(eo.id, 'briefing')

    expect(result.dispatched).toBe(false)
    expect(dispatchSpy).not.toHaveBeenCalled()
  })
})

describe('MeetingBriefingsService location hints', () => {
  beforeEach(() => {
    mockResolveServeContext(null)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('passes known_schedule_location into the schedule dispatch when a row exists', async () => {
    const orgSlug = `loc-sched-hint-${Date.now()}`
    await seedOrgAndCampaign(orgSlug, { positionId: 'br-pos-sched-hint' })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    await service.prisma.meetingResourceLocation.create({
      data: {
        electedOfficeId: eo.id,
        type: MeetingResourceLocationType.SCHEDULE,
        description: 'https://example.gov/city-council/meetings',
      },
    })
    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      isServeIcp: true,
    })
    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)

    await service.app
      .get(MeetingBriefingsService)
      .dispatchManual(eo.id, 'schedule')

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'meeting_schedule',
        params: expect.objectContaining({
          known_schedule_location: 'https://example.gov/city-council/meetings',
        }),
      }),
    )
  })

  it('omits known_schedule_location when no row exists', async () => {
    const orgSlug = `loc-sched-no-hint-${Date.now()}`
    await seedOrgAndCampaign(orgSlug, { positionId: 'br-pos-sched-no-hint' })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      isServeIcp: true,
    })
    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)

    await service.app
      .get(MeetingBriefingsService)
      .dispatchManual(eo.id, 'schedule')

    const params = dispatchSpy.mock.calls[0]?.[0]?.params as
      | Record<string, unknown>
      | undefined
    expect(params).toBeDefined()
    expect(params).not.toHaveProperty('known_schedule_location')
  })

  it('passes knownAgendaLocation and electedOfficeId into the briefing dispatch when a row exists', async () => {
    const orgSlug = `loc-agenda-hint-${Date.now()}`
    await seedOrgAndCampaign(orgSlug, { positionId: 'br-pos-agenda-hint' })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    await service.prisma.meetingResourceLocation.create({
      data: {
        electedOfficeId: eo.id,
        type: MeetingResourceLocationType.AGENDA,
        description: 'https://city.granicus.com/ViewPublisher.php?view_id=5',
      },
    })
    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      isServeIcp: true,
    })
    await seedScheduleForOrg(orgSlug)
    const dispatchSpy = vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue({ runId: 'manual-dispatch-run' } as ExperimentRun)

    await service.app
      .get(MeetingBriefingsService)
      .dispatchManual(eo.id, 'briefing')

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'meeting_briefing',
        params: expect.objectContaining({
          knownAgendaLocation:
            'https://city.granicus.com/ViewPublisher.php?view_id=5',
        }),
      }),
    )
  })

  it('upserts a SCHEDULE location row when the schedule artifact carries discovered_schedule_location', async () => {
    const orgSlug = `loc-sched-persist-${Date.now()}`
    await seedOrgAndCampaign(orgSlug, { positionId: 'br-pos-sched-persist' })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      isServeIcp: true,
    })
    const artifactKey = `schedule-loc-${orgSlug}.json`
    await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'meeting_schedule',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'schedule-bucket',
        artifactKey,
        params: { elected_office_id: eo.id },
      },
    })
    mockS3({
      [artifactKey]: JSON.stringify({
        status: 'found',
        rrule: 'FREQ=DAILY',
        time: '19:00',
        timezone: 'America/Chicago',
        duration_minutes: 120,
        meeting_name: 'City Council',
        location: 'Council Chambers',
        sources: [],
        generated_at: new Date().toISOString(),
        human: 'Daily',
        discovered_schedule_location:
          'https://example.gov/government/city-council/',
      }),
    })
    const scheduleRun = await service.prisma.experimentRun.findFirstOrThrow({
      where: { artifactKey },
    })
    vi.spyOn(
      service.app.get(ExperimentRunsService),
      'dispatchRun',
    ).mockResolvedValue(undefined)

    await service.app
      .get(MeetingBriefingsService)
      .onExperimentRunCompleted(scheduleRun)

    const row = await service.prisma.meetingResourceLocation.findUnique({
      where: {
        electedOfficeId_type: {
          electedOfficeId: eo.id,
          type: MeetingResourceLocationType.SCHEDULE,
        },
      },
    })
    expect(row).not.toBeNull()
    expect(row?.description).toBe(
      'https://example.gov/government/city-council/',
    )
    expect(row?.experimentRunId).toBe(scheduleRun.runId)
  })

  it('upserts an AGENDA location row on a placeholder briefing when discovered_agenda_location is set', async () => {
    const orgSlug = `loc-agenda-placeholder-${Date.now()}`
    await seedOrgAndCampaign(orgSlug, {
      positionId: 'br-pos-agenda-placeholder',
    })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    const briefingRun = await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'meeting_briefing',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'briefing-bucket',
        artifactKey: 'briefing-placeholder.json',
        params: {},
      },
    })
    mockS3({
      'briefing-placeholder.json': JSON.stringify({
        briefing_status: 'awaiting_agenda',
        meeting_date: '2026-06-10',
        run_metadata: {
          agenda_packet_url: null,
          discovered_agenda_location:
            'https://city.granicus.com/ViewPublisher.php?view_id=5',
        },
      }),
    })

    await service.app
      .get(MeetingBriefingsService)
      .onExperimentRunCompleted(briefingRun)

    // No briefing row written for placeholder status (existing behavior),
    // but the location hint persists so the next run can use it.
    const briefingRow = await service.prisma.meetingBriefing.findUnique({
      where: {
        electedOfficeId_meetingDate: {
          electedOfficeId: eo.id,
          meetingDate: new Date('2026-06-10'),
        },
      },
    })
    expect(briefingRow).toBeNull()

    const locationRow = await service.prisma.meetingResourceLocation.findUnique(
      {
        where: {
          electedOfficeId_type: {
            electedOfficeId: eo.id,
            type: MeetingResourceLocationType.AGENDA,
          },
        },
      },
    )
    expect(locationRow).not.toBeNull()
    expect(locationRow?.description).toBe(
      'https://city.granicus.com/ViewPublisher.php?view_id=5',
    )
    expect(locationRow?.experimentRunId).toBe(briefingRun.runId)
  })

  it('overwrites an existing location row on the next run', async () => {
    const orgSlug = `loc-overwrite-${Date.now()}`
    await seedOrgAndCampaign(orgSlug, { positionId: 'br-pos-overwrite' })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    await service.prisma.meetingResourceLocation.create({
      data: {
        electedOfficeId: eo.id,
        type: MeetingResourceLocationType.AGENDA,
        description: 'https://old.example.gov/meetings',
      },
    })
    const briefingRun = await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'meeting_briefing',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'briefing-bucket',
        artifactKey: 'briefing-overwrite.json',
        params: {},
      },
    })
    mockS3({
      'briefing-overwrite.json': JSON.stringify({
        briefing_status: 'briefing_ready',
        meeting_date: '2026-06-10',
        meeting_time: '19:00',
        meeting_timezone: 'America/Chicago',
        meeting_name: 'City Council',
        location: 'Council Chambers',
        run_metadata: {
          agenda_packet_url:
            'https://new.example.gov/meetings/2026-06-10/packet.pdf',
          discovered_agenda_location: 'https://new.example.gov/meetings',
        },
      }),
    })

    await service.app
      .get(MeetingBriefingsService)
      .onExperimentRunCompleted(briefingRun)

    const row = await service.prisma.meetingResourceLocation.findUnique({
      where: {
        electedOfficeId_type: {
          electedOfficeId: eo.id,
          type: MeetingResourceLocationType.AGENDA,
        },
      },
    })
    expect(row?.description).toBe('https://new.example.gov/meetings')
    expect(row?.experimentRunId).toBe(briefingRun.runId)
  })

  it('does not write a location row when discovered_agenda_location is absent', async () => {
    const orgSlug = `loc-absent-${Date.now()}`
    await seedOrgAndCampaign(orgSlug, { positionId: 'br-pos-absent' })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: orgSlug, userId: service.user.id },
    })
    const briefingRun = await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'meeting_briefing',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'briefing-bucket',
        artifactKey: 'briefing-no-loc.json',
        params: {},
      },
    })
    mockS3({
      'briefing-no-loc.json': JSON.stringify({
        briefing_status: 'briefing_ready',
        meeting_date: '2026-06-10',
        meeting_time: '19:00',
        meeting_timezone: 'America/Chicago',
        meeting_name: 'City Council',
        location: 'Council Chambers',
      }),
    })

    await service.app
      .get(MeetingBriefingsService)
      .onExperimentRunCompleted(briefingRun)

    const row = await service.prisma.meetingResourceLocation.findUnique({
      where: {
        electedOfficeId_type: {
          electedOfficeId: eo.id,
          type: MeetingResourceLocationType.AGENDA,
        },
      },
    })
    expect(row).toBeNull()
  })
})
