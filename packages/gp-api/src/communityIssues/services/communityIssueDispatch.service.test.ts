import {
  AgentRunStatus,
  CommunityIssueCategory,
  CommunityIssueList,
  CommunityIssuePriority,
  ExperimentRunStatus,
} from '../../generated/prisma'
import { subDays } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { AgentsService } from '@/agents/agents.service'
import { useTestService } from '@/test-service'
// Imported after useTestService: analytics.service sits on a circular import
// chain (analytics -> users -> campaigns -> analytics) and must not be the
// first app-graph module evaluated, or Nest sees an undefined DI token.
import { AnalyticsService } from '@/analytics/analytics.service'
import { DispatchRequestSchema } from '../schemas/communityIssues.schema'
import { CommunityIssueDispatchService } from './communityIssueDispatch.service'
import { INACTIVITY_THRESHOLD_DAYS } from '@/shared/util/userActivity.util'

const service = useTestService({ jobs: true })

// ── helpers ──────────────────────────────────────────────────────────────────

const seedOrg = async (slug: string) => {
  await service.prisma.organization.upsert({
    where: { slug },
    create: { slug, ownerId: service.user.id },
    update: {},
  })
}

const mockResolveServeContext = (
  result: Awaited<
    ReturnType<OrganizationsService['resolveServeContext']>
  > | null,
) => {
  vi.spyOn(
    service.app.get(OrganizationsService),
    'resolveServeContext',
  ).mockResolvedValue(result)
}

const mockDispatchRun = () =>
  vi
    .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
    .mockResolvedValue(undefined)

const mockAgentsRun = () =>
  vi
    .spyOn(service.app.get(AgentsService), 'run')
    .mockResolvedValue({ runId: 'stub-run' })

const seedAgentRun = async (organizationSlug: string, status: AgentRunStatus) =>
  service.prisma.agentRun.create({
    data: {
      agentName: 'trending_issues',
      organizationSlug,
      status,
      manifest: {},
      shapeHash: 'a-shape',
      input: { organizationSlug },
    },
  })

// ── tests ─────────────────────────────────────────────────────────────────────

describe('CommunityIssueDispatchService.onElectedOfficeCreated', () => {
  beforeEach(() => {
    vi.stubEnv('MEETINGS_AUTOMATION_ENABLED', 'true')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('dispatches one run of each type for a new elected office', async () => {
    const suffix = Date.now()
    const orgSlug = `ci-signup-${suffix}`
    await seedOrg(orgSlug)
    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
    })
    const dispatchSpy = mockDispatchRun()

    const electedOffice = await service.prisma.electedOffice.create({
      data: {
        userId: service.user.id,
        organizationSlug: orgSlug,
      },
    })

    await service.app
      .get(CommunityIssueDispatchService)
      .onElectedOfficeCreated(electedOffice)

    const types = dispatchSpy.mock.calls.map((c) => c[0].type)
    expect(types).toContain('top_community_issues')
    expect(types).toContain('trending_issues')
    expect(dispatchSpy).toHaveBeenCalledTimes(2)
  })

  it('is idempotent — second call dispatches nothing when runs already exist', async () => {
    const suffix = Date.now()
    const orgSlug = `ci-idem-${suffix}`
    await seedOrg(orgSlug)
    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
    })
    const dispatchSpy = mockDispatchRun()

    const electedOffice = await service.prisma.electedOffice.create({
      data: {
        userId: service.user.id,
        organizationSlug: orgSlug,
      },
    })

    // Seed existing runs for both types to simulate a prior dispatch
    for (const experimentType of [
      'top_community_issues',
      'trending_issues',
    ] as const) {
      await service.prisma.experimentRun.create({
        data: {
          organizationSlug: orgSlug,
          experimentType,
          status: ExperimentRunStatus.QUEUED,
        },
      })
    }

    // Call with pre-existing runs — should dispatch nothing
    await service.app
      .get(CommunityIssueDispatchService)
      .onElectedOfficeCreated(electedOffice)

    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('re-dispatches when only a FAILED prior run exists', async () => {
    const suffix = Date.now()
    const orgSlug = `ci-failed-${suffix}`
    await seedOrg(orgSlug)
    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
    })
    const dispatchSpy = mockDispatchRun()

    const electedOffice = await service.prisma.electedOffice.create({
      data: {
        userId: service.user.id,
        organizationSlug: orgSlug,
      },
    })

    // A failed prior attempt must not permanently block the signup hook
    for (const experimentType of [
      'top_community_issues',
      'trending_issues',
    ] as const) {
      await service.prisma.experimentRun.create({
        data: {
          organizationSlug: orgSlug,
          experimentType,
          status: ExperimentRunStatus.FAILED,
        },
      })
    }

    await service.app
      .get(CommunityIssueDispatchService)
      .onElectedOfficeCreated(electedOffice)

    expect(dispatchSpy).toHaveBeenCalledTimes(2)
  })

  it('skips dispatch when automation is disabled', async () => {
    vi.stubEnv('MEETINGS_AUTOMATION_ENABLED', '')
    const suffix = Date.now()
    const orgSlug = `ci-disabled-${suffix}`
    await seedOrg(orgSlug)
    const dispatchSpy = mockDispatchRun()

    const electedOffice = await service.prisma.electedOffice.create({
      data: {
        userId: service.user.id,
        organizationSlug: orgSlug,
      },
    })

    await service.app
      .get(CommunityIssueDispatchService)
      .onElectedOfficeCreated(electedOffice)

    expect(dispatchSpy).not.toHaveBeenCalled()
  })
})

describe('CommunityIssueDispatchService.dispatchForCohort', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('dispatches for an office whose position is not serve-ICP', async () => {
    const suffix = Date.now()
    const orgSlug = `ci-cohort-icp-${suffix}`
    await service.prisma.organization.upsert({
      where: { slug: orgSlug },
      create: { slug: orgSlug, ownerId: service.user.id },
      update: {},
    })
    await service.prisma.electedOffice.create({
      data: {
        userId: service.user.id,
        organizationSlug: orgSlug,
      },
    })
    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      isServeIcp: false,
    })
    const dispatchSpy = mockDispatchRun()

    const result = await service.app
      .get(CommunityIssueDispatchService)
      .dispatchForCohort([orgSlug])

    const types = dispatchSpy.mock.calls.map((c) => c[0].type)
    expect(types).toContain('top_community_issues')
    expect(types).toContain('trending_issues')
    expect(result).toEqual({ dispatched: 2, skipped: 0 })
  })

  it('skips orgs with an in-flight run of that type', async () => {
    const suffix = Date.now()
    const orgSlug = `ci-cohort-inflight-${suffix}`
    await service.prisma.organization.upsert({
      where: { slug: orgSlug },
      create: { slug: orgSlug, ownerId: service.user.id },
      update: {},
    })
    await service.prisma.electedOffice.create({
      data: {
        userId: service.user.id,
        organizationSlug: orgSlug,
      },
    })
    // Seed an in-flight run for top_community_issues
    await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'top_community_issues',
        status: ExperimentRunStatus.RUNNING,
      },
    })
    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
    })
    const dispatchSpy = mockDispatchRun()

    await service.app
      .get(CommunityIssueDispatchService)
      .dispatchForCohort([orgSlug])

    // trending_issues should still be dispatched (no in-flight run for it)
    // but top_community_issues should be skipped
    const types = dispatchSpy.mock.calls.map((c) => c[0].type)
    expect(types).not.toContain('top_community_issues')
    expect(types).toContain('trending_issues')
  })

  it('skips orgs with a QUEUED run of that type', async () => {
    const suffix = Date.now()
    const orgSlug = `ci-cohort-queued-${suffix}`
    await service.prisma.organization.upsert({
      where: { slug: orgSlug },
      create: { slug: orgSlug, ownerId: service.user.id },
      update: {},
    })
    await service.prisma.electedOffice.create({
      data: {
        userId: service.user.id,
        organizationSlug: orgSlug,
      },
    })
    await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'top_community_issues',
        status: ExperimentRunStatus.QUEUED,
      },
    })
    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
    })
    const dispatchSpy = mockDispatchRun()

    await service.app
      .get(CommunityIssueDispatchService)
      .dispatchForCohort([orgSlug])

    const types = dispatchSpy.mock.calls.map((c) => c[0].type)
    expect(types).not.toContain('top_community_issues')
    expect(types).toContain('trending_issues')
  })

  it('re-dispatches when the only prior run of that type is COMPLETED', async () => {
    const suffix = Date.now()
    const orgSlug = `ci-cohort-completed-${suffix}`
    await service.prisma.organization.upsert({
      where: { slug: orgSlug },
      create: { slug: orgSlug, ownerId: service.user.id },
      update: {},
    })
    await service.prisma.electedOffice.create({
      data: {
        userId: service.user.id,
        organizationSlug: orgSlug,
      },
    })
    for (const experimentType of [
      'top_community_issues',
      'trending_issues',
    ] as const) {
      await service.prisma.experimentRun.create({
        data: {
          organizationSlug: orgSlug,
          experimentType,
          status: ExperimentRunStatus.COMPLETED,
        },
      })
    }
    mockResolveServeContext({
      state: 'TX',
      positionName: 'Mayor',
    })
    const dispatchSpy = mockDispatchRun()

    await service.app
      .get(CommunityIssueDispatchService)
      .dispatchForCohort([orgSlug])

    const types = dispatchSpy.mock.calls.map((c) => c[0].type)
    expect(types).toContain('top_community_issues')
    expect(types).toContain('trending_issues')
    expect(dispatchSpy).toHaveBeenCalledTimes(2)
  })

  it('dispatches both types for an eligible org with no in-flight runs', async () => {
    const suffix = Date.now()
    const orgSlug = `ci-cohort-ok-${suffix}`
    await service.prisma.organization.upsert({
      where: { slug: orgSlug },
      create: { slug: orgSlug, ownerId: service.user.id },
      update: {},
    })
    await service.prisma.electedOffice.create({
      data: {
        userId: service.user.id,
        organizationSlug: orgSlug,
      },
    })
    mockResolveServeContext({
      state: 'CA',
      positionName: 'Mayor',
    })
    const dispatchSpy = mockDispatchRun()

    const result = await service.app
      .get(CommunityIssueDispatchService)
      .dispatchForCohort([orgSlug])

    const types = dispatchSpy.mock.calls.map((c) => c[0].type)
    expect(types).toContain('top_community_issues')
    expect(types).toContain('trending_issues')
    expect(result.dispatched).toBe(2)
    expect(result.skipped).toBe(0)
  })

  it('passes l2 district params to top_community_issues only', async () => {
    const suffix = Date.now()
    const orgSlug = `ci-cohort-l2-${suffix}`
    await service.prisma.organization.upsert({
      where: { slug: orgSlug },
      create: { slug: orgSlug, ownerId: service.user.id },
      update: {},
    })
    await service.prisma.electedOffice.create({
      data: { userId: service.user.id, organizationSlug: orgSlug },
    })
    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      l2DistrictType: 'City_Ward',
      l2DistrictName: 'MINNEAPOLIS WARD 3',
    })
    const dispatchSpy = mockDispatchRun()

    await service.app
      .get(CommunityIssueDispatchService)
      .dispatchForCohort([orgSlug])

    const paramsByType = Object.fromEntries(
      dispatchSpy.mock.calls.map((c) => [c[0].type, c[0].params]),
    )
    // top_community_issues carries the district key (scopes the Haystaq query)
    expect(paramsByType.top_community_issues).toMatchObject({
      l2_district_type: 'City_Ward',
      l2_district_name: 'MINNEAPOLIS WARD 3',
    })
    // trending_issues' manifest is additionalProperties:false — must NOT carry it
    expect(paramsByType.trending_issues).not.toHaveProperty('l2_district_type')
    expect(paramsByType.trending_issues).not.toHaveProperty('l2_district_name')
  })
})

// 'cif-cron-2' hashes to bucket 0 (mod 7) via FNV-1a — Sunday (UTC day 0).
// Freeze time to 2026-06-21 (Sunday) so the cron selects bucket 0.
const CRON_BUCKET0_SLUG = 'cif-cron-2'
const SUNDAY_UTC = new Date('2026-06-21T08:00:00.000Z')
// 'cif-cron-top-31' hashes to bucket 17 (mod 28) via FNV-1a, matching
// topIssuesBucketForDate(SUNDAY_UTC) — so the monthly top-issues cron
// selects it on the same frozen date as the weekly trending tests above.
const CRON_TOP_BUCKET_SLUG = 'cif-cron-top-31'

describe('the trendingIssuesDaily schedule — QUEUED guard', () => {
  beforeEach(() => {
    vi.stubEnv('MEETINGS_AUTOMATION_ENABLED', 'true')
    vi.useFakeTimers({ toFake: ['Date'], now: SUNDAY_UTC })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it(
    'skips an org with a QUEUED trending_issues run' +
      ' (cron in-flight check includes QUEUED)',
    async () => {
      await service.prisma.organization.upsert({
        where: { slug: CRON_BUCKET0_SLUG },
        create: { slug: CRON_BUCKET0_SLUG, ownerId: service.user.id },
        update: {},
      })
      await service.prisma.electedOffice.create({
        data: {
          userId: service.user.id,
          organizationSlug: CRON_BUCKET0_SLUG,
          onboardingCompletedAt: new Date(),
        },
      })
      await service.prisma.experimentRun.create({
        data: {
          organizationSlug: CRON_BUCKET0_SLUG,
          experimentType: 'trending_issues',
          status: ExperimentRunStatus.QUEUED,
        },
      })

      mockResolveServeContext({
        state: 'MN',
        positionName: 'City Council',
      })
      const dispatchSpy = mockDispatchRun()

      await service.jobs.runSchedule('trendingIssuesDaily')

      const trendingCalls = dispatchSpy.mock.calls.filter(
        (c) =>
          c[0].type === 'trending_issues' &&
          c[0].organizationSlug === CRON_BUCKET0_SLUG,
      )
      expect(trendingCalls).toHaveLength(0)
    },
  )
})

describe('the community-issue schedules — Serve onboarding gate', () => {
  beforeEach(() => {
    vi.stubEnv('MEETINGS_AUTOMATION_ENABLED', 'true')
    vi.useFakeTimers({ toFake: ['Date'], now: SUNDAY_UTC })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  const seedOffice = async (
    slug: string,
    onboardingCompletedAt: Date | null,
  ) => {
    await seedOrg(slug)
    await service.prisma.electedOffice.create({
      data: {
        userId: service.user.id,
        organizationSlug: slug,
        onboardingCompletedAt,
      },
    })
  }

  const runCron = async (
    schedule: 'trendingIssuesDaily' | 'topCommunityIssuesDaily',
  ) => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { metaData: { lastVisited: Date.now() } },
    })
    mockResolveServeContext({ state: 'MN', positionName: 'City Council' })
    const dispatchSpy = mockDispatchRun().mockClear()
    await service.jobs.runSchedule(schedule)
    return dispatchSpy.mock.calls.map((c) => c[0].organizationSlug)
  }

  it('skips an office that has not finished Serve onboarding', async () => {
    await seedOffice(CRON_BUCKET0_SLUG, null)
    await seedOffice(CRON_TOP_BUCKET_SLUG, null)

    expect(await runCron('trendingIssuesDaily')).toEqual([])
    expect(await runCron('topCommunityIssuesDaily')).toEqual([])
  })

  it('dispatches for an office that finished Serve onboarding', async () => {
    await seedOffice(CRON_BUCKET0_SLUG, new Date())
    await seedOffice(CRON_TOP_BUCKET_SLUG, new Date())

    expect(await runCron('trendingIssuesDaily')).toEqual([CRON_BUCKET0_SLUG])
    expect(await runCron('topCommunityIssuesDaily')).toEqual([
      CRON_TOP_BUCKET_SLUG,
    ])
  })
})

describe('CommunityIssueDispatchService — activity-gated dispatch', () => {
  describe('cron path (trendingIssuesDaily)', () => {
    beforeEach(() => {
      vi.stubEnv('MEETINGS_AUTOMATION_ENABLED', 'true')
      vi.useFakeTimers({ toFake: ['Date'], now: SUNDAY_UTC })
    })
    afterEach(() => {
      vi.useRealTimers()
      vi.unstubAllEnvs()
      vi.restoreAllMocks()
    })

    it('dispatches for a user active within the threshold', async () => {
      await service.prisma.organization.upsert({
        where: { slug: CRON_BUCKET0_SLUG },
        create: { slug: CRON_BUCKET0_SLUG, ownerId: service.user.id },
        update: {},
      })
      await service.prisma.electedOffice.create({
        data: {
          userId: service.user.id,
          organizationSlug: CRON_BUCKET0_SLUG,
          onboardingCompletedAt: new Date(),
        },
      })
      await service.prisma.user.update({
        where: { id: service.user.id },
        data: { metaData: { lastVisited: Date.now() } },
      })
      mockResolveServeContext({
        state: 'MN',
        positionName: 'City Council',
      })
      const dispatchSpy = mockDispatchRun()

      await service.jobs.runSchedule('trendingIssuesDaily')

      const trendingCalls = dispatchSpy.mock.calls.filter(
        (c) => c[0].type === 'trending_issues',
      )
      expect(trendingCalls).toHaveLength(1)
    })

    it('skips and tracks a re-engagement event for a user inactive beyond the threshold', async () => {
      await service.prisma.organization.upsert({
        where: { slug: CRON_BUCKET0_SLUG },
        create: { slug: CRON_BUCKET0_SLUG, ownerId: service.user.id },
        update: {},
      })
      await service.prisma.electedOffice.create({
        data: {
          userId: service.user.id,
          organizationSlug: CRON_BUCKET0_SLUG,
          onboardingCompletedAt: new Date(),
        },
      })
      const staleLastVisited = subDays(new Date(), 91).getTime()
      await service.prisma.user.update({
        where: { id: service.user.id },
        data: { metaData: { lastVisited: staleLastVisited } },
      })
      mockResolveServeContext({
        state: 'MN',
        positionName: 'City Council',
      })
      const dispatchSpy = mockDispatchRun()
      const trackSpy = vi
        .spyOn(service.app.get(AnalyticsService), 'track')
        .mockResolvedValue({ event: 'stub', userId: 'stub' })

      await service.jobs.runSchedule('trendingIssuesDaily')

      const trendingCalls = dispatchSpy.mock.calls.filter(
        (c) => c[0].type === 'trending_issues',
      )
      expect(trendingCalls).toHaveLength(0)
      expect(trackSpy).toHaveBeenCalledWith(
        service.user.id,
        'Community Issues - Trending Issues Dispatch Skipped',
        {
          lastVisitedAt: staleLastVisited,
          daysSinceLastVisit: expect.any(Number) as number,
        },
      )
    })
  })

  describe('cron path (topCommunityIssuesDaily)', () => {
    beforeEach(() => {
      vi.stubEnv('MEETINGS_AUTOMATION_ENABLED', 'true')
      vi.useFakeTimers({ toFake: ['Date'], now: SUNDAY_UTC })
    })
    afterEach(() => {
      vi.useRealTimers()
      vi.unstubAllEnvs()
      vi.restoreAllMocks()
    })

    it('dispatches for a user active within the threshold', async () => {
      await service.prisma.organization.upsert({
        where: { slug: CRON_TOP_BUCKET_SLUG },
        create: { slug: CRON_TOP_BUCKET_SLUG, ownerId: service.user.id },
        update: {},
      })
      await service.prisma.electedOffice.create({
        data: {
          userId: service.user.id,
          organizationSlug: CRON_TOP_BUCKET_SLUG,
          onboardingCompletedAt: new Date(),
        },
      })
      await service.prisma.user.update({
        where: { id: service.user.id },
        data: { metaData: { lastVisited: Date.now() } },
      })
      mockResolveServeContext({
        state: 'MN',
        positionName: 'City Council',
      })
      const dispatchSpy = mockDispatchRun()

      await service.jobs.runSchedule('topCommunityIssuesDaily')

      const topCalls = dispatchSpy.mock.calls.filter(
        (c) => c[0].type === 'top_community_issues',
      )
      expect(topCalls).toHaveLength(1)
    })

    it('skips and tracks a re-engagement event for a user inactive beyond the threshold', async () => {
      await service.prisma.organization.upsert({
        where: { slug: CRON_TOP_BUCKET_SLUG },
        create: { slug: CRON_TOP_BUCKET_SLUG, ownerId: service.user.id },
        update: {},
      })
      await service.prisma.electedOffice.create({
        data: {
          userId: service.user.id,
          organizationSlug: CRON_TOP_BUCKET_SLUG,
          onboardingCompletedAt: new Date(),
        },
      })
      const staleLastVisited = subDays(new Date(), 91).getTime()
      await service.prisma.user.update({
        where: { id: service.user.id },
        data: { metaData: { lastVisited: staleLastVisited } },
      })
      mockResolveServeContext({
        state: 'MN',
        positionName: 'City Council',
      })
      const dispatchSpy = mockDispatchRun()
      const trackSpy = vi
        .spyOn(service.app.get(AnalyticsService), 'track')
        .mockResolvedValue({ event: 'stub', userId: 'stub' })

      await service.jobs.runSchedule('topCommunityIssuesDaily')

      const topCalls = dispatchSpy.mock.calls.filter(
        (c) => c[0].type === 'top_community_issues',
      )
      expect(topCalls).toHaveLength(0)
      expect(trackSpy).toHaveBeenCalledWith(
        service.user.id,
        'Community Issues - Top Issues Dispatch Skipped',
        {
          lastVisitedAt: staleLastVisited,
          daysSinceLastVisit: expect.any(Number) as number,
        },
      )
    })
  })

  describe('on-demand path (dispatchIfNeeded)', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('dispatches both types for an inactive user (activity gate skipped)', async () => {
      const orgSlug = `ci-ondemand-${Date.now()}`
      await seedOrg(orgSlug)
      await service.prisma.electedOffice.create({
        data: { userId: service.user.id, organizationSlug: orgSlug },
      })
      await service.prisma.user.update({
        where: { id: service.user.id },
        data: {
          metaData: { lastVisited: subDays(new Date(), 200).getTime() },
        },
      })
      mockResolveServeContext({
        state: 'MN',
        positionName: 'City Council',
      })
      const dispatchSpy = mockDispatchRun()

      const result = await service.app
        .get(CommunityIssueDispatchService)
        .dispatchIfNeeded(orgSlug)

      expect(result).toEqual({ dispatched: 2, skipped: 0 })
      expect(dispatchSpy).toHaveBeenCalledTimes(2)
    })

    it('does not double-dispatch a type with an in-flight run', async () => {
      const orgSlug = `ci-ondemand-inflight-${Date.now()}`
      await seedOrg(orgSlug)
      await service.prisma.electedOffice.create({
        data: { userId: service.user.id, organizationSlug: orgSlug },
      })
      await service.prisma.experimentRun.create({
        data: {
          organizationSlug: orgSlug,
          experimentType: 'top_community_issues',
          status: ExperimentRunStatus.RUNNING,
        },
      })
      mockResolveServeContext({
        state: 'MN',
        positionName: 'City Council',
      })
      const dispatchSpy = mockDispatchRun()

      const result = await service.app
        .get(CommunityIssueDispatchService)
        .dispatchIfNeeded(orgSlug)

      const types = dispatchSpy.mock.calls.map((c) => c[0].type)
      expect(types).not.toContain('top_community_issues')
      expect(types).toContain('trending_issues')
      expect(result).toEqual({ dispatched: 1, skipped: 1 })
    })

    it('skips a type whose last completed run is inside the freshness window', async () => {
      const orgSlug = `ci-ondemand-fresh-${Date.now()}`
      await seedOrg(orgSlug)
      await service.prisma.electedOffice.create({
        data: { userId: service.user.id, organizationSlug: orgSlug },
      })
      const run = await service.prisma.experimentRun.create({
        data: {
          organizationSlug: orgSlug,
          experimentType: 'top_community_issues',
          status: ExperimentRunStatus.COMPLETED,
        },
      })
      // @updatedAt is Prisma-managed, so backdate the completion via raw SQL.
      await service.prisma.$executeRaw`
        UPDATE experiment_run
        SET updated_at = ${subDays(new Date(), INACTIVITY_THRESHOLD_DAYS - 1)}
        WHERE run_id = ${run.runId}
      `
      mockResolveServeContext({
        state: 'MN',
        positionName: 'City Council',
      })
      const dispatchSpy = mockDispatchRun()

      const result = await service.app
        .get(CommunityIssueDispatchService)
        .dispatchIfNeeded(orgSlug)

      const types = dispatchSpy.mock.calls.map((c) => c[0].type)
      expect(types).not.toContain('top_community_issues')
      expect(types).toContain('trending_issues')
      expect(result).toEqual({ dispatched: 1, skipped: 1 })
    })

    it('re-dispatches a type whose last completed run is older than the window', async () => {
      const orgSlug = `ci-ondemand-stale-${Date.now()}`
      await seedOrg(orgSlug)
      await service.prisma.electedOffice.create({
        data: { userId: service.user.id, organizationSlug: orgSlug },
      })
      const run = await service.prisma.experimentRun.create({
        data: {
          organizationSlug: orgSlug,
          experimentType: 'top_community_issues',
          status: ExperimentRunStatus.COMPLETED,
        },
      })
      await service.prisma.$executeRaw`
        UPDATE experiment_run
        SET updated_at = ${subDays(new Date(), INACTIVITY_THRESHOLD_DAYS + 10)}
        WHERE run_id = ${run.runId}
      `
      mockResolveServeContext({
        state: 'MN',
        positionName: 'City Council',
      })
      const dispatchSpy = mockDispatchRun()

      const result = await service.app
        .get(CommunityIssueDispatchService)
        .dispatchIfNeeded(orgSlug)

      expect(result).toEqual({ dispatched: 2, skipped: 0 })
      expect(dispatchSpy.mock.calls.map((c) => c[0].type)).toContain(
        'top_community_issues',
      )
    })

    it('dispatches for an office whose position is not serve-ICP', async () => {
      const orgSlug = `ci-ondemand-icp-${Date.now()}`
      await seedOrg(orgSlug)
      await service.prisma.electedOffice.create({
        data: { userId: service.user.id, organizationSlug: orgSlug },
      })
      mockResolveServeContext({
        state: 'MN',
        positionName: 'City Council',
        isServeIcp: false,
      })
      const dispatchSpy = mockDispatchRun()

      const result = await service.app
        .get(CommunityIssueDispatchService)
        .dispatchIfNeeded(orgSlug)

      expect(dispatchSpy).toHaveBeenCalledTimes(2)
      expect(result).toEqual({ dispatched: 2, skipped: 0 })
    })
  })
})

describe('the engine switch — gates read the runs of the engine that will run them', () => {
  beforeEach(() => {
    vi.stubEnv('AGENTS_ON_GP_API', 'trending_issues')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('the signup check skips a type whose completed AgentRun exists', async () => {
    vi.stubEnv('MEETINGS_AUTOMATION_ENABLED', 'true')
    const orgSlug = `ci-gpapi-signup-${Date.now()}`
    await seedOrg(orgSlug)
    await seedAgentRun(orgSlug, AgentRunStatus.completed)
    mockResolveServeContext({ state: 'MN', positionName: 'City Council' })
    const dispatchSpy = mockDispatchRun()
    const agentsSpy = mockAgentsRun()

    const electedOffice = await service.prisma.electedOffice.create({
      data: { userId: service.user.id, organizationSlug: orgSlug },
    })
    await service.app
      .get(CommunityIssueDispatchService)
      .onElectedOfficeCreated(electedOffice)

    expect(agentsSpy).not.toHaveBeenCalled()
    // top_community_issues stays on the PMF Engine and still dispatches.
    expect(dispatchSpy.mock.calls.map((c) => c[0].type)).toEqual([
      'top_community_issues',
    ])
  })

  it('the in-flight check skips a type with a QUEUED AgentRun', async () => {
    const orgSlug = `ci-gpapi-inflight-${Date.now()}`
    await seedOrg(orgSlug)
    await service.prisma.electedOffice.create({
      data: { userId: service.user.id, organizationSlug: orgSlug },
    })
    await seedAgentRun(orgSlug, AgentRunStatus.queued)
    mockResolveServeContext({ state: 'MN', positionName: 'City Council' })
    const dispatchSpy = mockDispatchRun()
    const agentsSpy = mockAgentsRun()

    const result = await service.app
      .get(CommunityIssueDispatchService)
      .dispatchForCohort([orgSlug])

    expect(agentsSpy).not.toHaveBeenCalled()
    expect(dispatchSpy.mock.calls.map((c) => c[0].type)).toEqual([
      'top_community_issues',
    ])
    expect(result).toEqual({ dispatched: 1, skipped: 1 })
  })

  it('the in-flight check skips a type with a RUNNING AgentRun', async () => {
    const orgSlug = `ci-gpapi-running-${Date.now()}`
    await seedOrg(orgSlug)
    await service.prisma.electedOffice.create({
      data: { userId: service.user.id, organizationSlug: orgSlug },
    })
    await seedAgentRun(orgSlug, AgentRunStatus.running)
    mockResolveServeContext({ state: 'MN', positionName: 'City Council' })
    const dispatchSpy = mockDispatchRun()
    const agentsSpy = mockAgentsRun()

    await service.app
      .get(CommunityIssueDispatchService)
      .dispatchForCohort([orgSlug])

    expect(agentsSpy).not.toHaveBeenCalled()
    expect(dispatchSpy.mock.calls.map((c) => c[0].type)).toEqual([
      'top_community_issues',
    ])
  })

  it('the freshness check skips a type whose AgentRun completed inside the window', async () => {
    const orgSlug = `ci-gpapi-fresh-${Date.now()}`
    await seedOrg(orgSlug)
    await service.prisma.electedOffice.create({
      data: { userId: service.user.id, organizationSlug: orgSlug },
    })
    const run = await seedAgentRun(orgSlug, AgentRunStatus.completed)
    // @updatedAt is Prisma-managed, so backdate the completion via raw SQL.
    await service.prisma.$executeRaw`
      UPDATE agent_run
      SET updated_at = ${subDays(new Date(), INACTIVITY_THRESHOLD_DAYS - 1)}
      WHERE id = ${run.id}
    `
    mockResolveServeContext({ state: 'MN', positionName: 'City Council' })
    const dispatchSpy = mockDispatchRun()
    const agentsSpy = mockAgentsRun()

    const result = await service.app
      .get(CommunityIssueDispatchService)
      .dispatchIfNeeded(orgSlug)

    expect(agentsSpy).not.toHaveBeenCalled()
    expect(dispatchSpy.mock.calls.map((c) => c[0].type)).toEqual([
      'top_community_issues',
    ])
    expect(result).toEqual({ dispatched: 1, skipped: 1 })
  })
})

describe('the CommunityIssue cutover while trending_issues has no AgentRun', () => {
  beforeEach(() => {
    vi.stubEnv('AGENTS_ON_GP_API', 'trending_issues')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  const seedTrendingRows = async (
    organizationSlug: string,
    daysAgo: number,
  ) => {
    const row = await service.prisma.communityIssue.create({
      data: {
        organizationSlug,
        list: CommunityIssueList.trending,
        category: CommunityIssueCategory.public_safety,
        priority: CommunityIssuePriority.high,
        title: 'Road Maintenance',
        summary: 'Roads need fixing.',
        rank: 1,
      },
    })
    // @updatedAt is Prisma-managed, so backdate the ingest via raw SQL.
    await service.prisma.$executeRaw`
      UPDATE community_issue
      SET updated_at = ${subDays(new Date(), daysAgo)}
      WHERE id = ${row.id}
    `
    return service.prisma.communityIssue.findFirstOrThrow({
      where: { id: row.id },
    })
  }

  const seedOrgWithOffice = async (orgSlug: string) => {
    await seedOrg(orgSlug)
    await service.prisma.electedOffice.create({
      data: { userId: service.user.id, organizationSlug: orgSlug },
    })
    mockResolveServeContext({ state: 'MN', positionName: 'City Council' })
  }

  it('does not re-dispatch an org whose trending rows were refreshed yesterday', async () => {
    const orgSlug = `ci-cutover-fresh-${Date.now()}`
    await seedOrgWithOffice(orgSlug)
    await seedTrendingRows(orgSlug, 1)
    const dispatchSpy = mockDispatchRun()
    const agentsSpy = mockAgentsRun()

    const result = await service.app
      .get(CommunityIssueDispatchService)
      .dispatchIfNeeded(orgSlug)

    expect(agentsSpy).not.toHaveBeenCalled()
    expect(dispatchSpy.mock.calls.map((c) => c[0].type)).toEqual([
      'top_community_issues',
    ])
    expect(result).toEqual({ dispatched: 1, skipped: 1 })
  })

  it('re-dispatches an org whose trending rows are older than the window', async () => {
    const orgSlug = `ci-cutover-stale-${Date.now()}`
    await seedOrgWithOffice(orgSlug)
    await seedTrendingRows(orgSlug, INACTIVITY_THRESHOLD_DAYS + 10)
    mockDispatchRun()
    const agentsSpy = mockAgentsRun()

    const result = await service.app
      .get(CommunityIssueDispatchService)
      .dispatchIfNeeded(orgSlug)

    expect(agentsSpy).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ dispatched: 2, skipped: 0 })
  })

  it('dispatches an org with no trending rows at all', async () => {
    const orgSlug = `ci-cutover-norows-${Date.now()}`
    await seedOrgWithOffice(orgSlug)
    mockDispatchRun()
    const agentsSpy = mockAgentsRun()

    const result = await service.app
      .get(CommunityIssueDispatchService)
      .dispatchIfNeeded(orgSlug)

    expect(agentsSpy).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ dispatched: 2, skipped: 0 })
  })

  it('lets a completed AgentRun decide once the org has one, ignoring stale rows', async () => {
    const orgSlug = `ci-cutover-agentrun-${Date.now()}`
    await seedOrgWithOffice(orgSlug)
    await seedTrendingRows(orgSlug, INACTIVITY_THRESHOLD_DAYS + 10)
    const run = await seedAgentRun(orgSlug, AgentRunStatus.completed)
    await service.prisma.$executeRaw`
      UPDATE agent_run
      SET updated_at = ${subDays(new Date(), 1)}
      WHERE id = ${run.id}
    `
    const dispatchSpy = mockDispatchRun()
    const agentsSpy = mockAgentsRun()

    const result = await service.app
      .get(CommunityIssueDispatchService)
      .dispatchIfNeeded(orgSlug)

    expect(agentsSpy).not.toHaveBeenCalled()
    expect(dispatchSpy.mock.calls.map((c) => c[0].type)).toEqual([
      'top_community_issues',
    ])
    expect(result).toEqual({ dispatched: 1, skipped: 1 })
  })
})

describe('top_community_issues on the gp-api engine', () => {
  beforeEach(() => {
    vi.stubEnv('AGENTS_ON_GP_API', 'top_community_issues')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  const L2_CONTEXT = {
    state: 'NC',
    positionName: 'City Council Member',
    l2DistrictType: 'City_Ward',
    l2DistrictName: 'FAYETTEVILLE CITY WARD 2',
  }

  const seedTopAgentRun = (organizationSlug: string, status: AgentRunStatus) =>
    service.prisma.agentRun.create({
      data: {
        agentName: 'top_community_issues',
        organizationSlug,
        status,
        manifest: {},
        shapeHash: 'a-shape',
        input: { organizationSlug },
      },
    })

  const seedOrgWithOffice = async (orgSlug: string) => {
    await seedOrg(orgSlug)
    await service.prisma.electedOffice.create({
      data: { userId: service.user.id, organizationSlug: orgSlug },
    })
    mockResolveServeContext(L2_CONTEXT)
  }

  const seedTopRow = async (organizationSlug: string, daysAgo: number) => {
    const row = await service.prisma.communityIssue.create({
      data: {
        organizationSlug,
        list: CommunityIssueList.top_community,
        category: CommunityIssueCategory.public_safety,
        priority: CommunityIssuePriority.high,
        title: 'Road Maintenance',
        summary: 'Roads need fixing.',
        rank: 1,
      },
    })
    await service.prisma.$executeRaw`
      UPDATE community_issue
      SET updated_at = ${subDays(new Date(), daysAgo)}
      WHERE id = ${row.id}
    `
  }

  it('starts an AgentRun with the L2 pair, and trending stays on the PMF Engine', async () => {
    const orgSlug = `ci-top-start-${Date.now()}`
    await seedOrgWithOffice(orgSlug)
    const dispatchSpy = mockDispatchRun()
    const agentsSpy = mockAgentsRun()

    const result = await service.app
      .get(CommunityIssueDispatchService)
      .dispatchForCohort([orgSlug])

    expect(result).toEqual({ dispatched: 2, skipped: 0 })
    expect(dispatchSpy.mock.calls.map((c) => c[0].type)).toEqual([
      'trending_issues',
    ])
    expect(agentsSpy).toHaveBeenCalledWith('top_community_issues', {
      organizationSlug: orgSlug,
      state: 'NC',
      office: 'City Council Member',
      districtDescriptor: 'FAYETTEVILLE CITY WARD 2, NC',
      l2DistrictType: 'City_Ward',
      l2DistrictName: 'FAYETTEVILLE CITY WARD 2',
      today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })
  })

  it('the signup check skips top_community_issues when its completed AgentRun exists', async () => {
    vi.stubEnv('MEETINGS_AUTOMATION_ENABLED', 'true')
    const orgSlug = `ci-top-signup-${Date.now()}`
    await seedOrg(orgSlug)
    await seedTopAgentRun(orgSlug, AgentRunStatus.completed)
    mockResolveServeContext(L2_CONTEXT)
    const dispatchSpy = mockDispatchRun()
    const agentsSpy = mockAgentsRun()

    const electedOffice = await service.prisma.electedOffice.create({
      data: { userId: service.user.id, organizationSlug: orgSlug },
    })
    await service.app
      .get(CommunityIssueDispatchService)
      .onElectedOfficeCreated(electedOffice)

    expect(agentsSpy).not.toHaveBeenCalled()
    expect(dispatchSpy.mock.calls.map((c) => c[0].type)).toEqual([
      'trending_issues',
    ])
  })

  it('the in-flight check skips top_community_issues with a queued AgentRun', async () => {
    const orgSlug = `ci-top-inflight-${Date.now()}`
    await seedOrgWithOffice(orgSlug)
    await seedTopAgentRun(orgSlug, AgentRunStatus.queued)
    mockDispatchRun()
    const agentsSpy = mockAgentsRun()

    const result = await service.app
      .get(CommunityIssueDispatchService)
      .dispatchForCohort([orgSlug])

    expect(agentsSpy).not.toHaveBeenCalled()
    expect(result).toEqual({ dispatched: 1, skipped: 1 })
  })

  it('the freshness check skips top_community_issues whose AgentRun completed inside the window', async () => {
    const orgSlug = `ci-top-fresh-${Date.now()}`
    await seedOrgWithOffice(orgSlug)
    const run = await seedTopAgentRun(orgSlug, AgentRunStatus.completed)
    await service.prisma.$executeRaw`
      UPDATE agent_run
      SET updated_at = ${subDays(new Date(), INACTIVITY_THRESHOLD_DAYS - 1)}
      WHERE id = ${run.id}
    `
    mockDispatchRun()
    const agentsSpy = mockAgentsRun()

    const result = await service.app
      .get(CommunityIssueDispatchService)
      .dispatchIfNeeded(orgSlug)

    expect(agentsSpy).not.toHaveBeenCalled()
    expect(result).toEqual({ dispatched: 1, skipped: 1 })
  })

  it("the cutover reads the org's own top_community rows when it has no AgentRun", async () => {
    const orgSlug = `ci-top-cutover-${Date.now()}`
    await seedOrgWithOffice(orgSlug)
    await seedTopRow(orgSlug, 1)
    mockDispatchRun()
    const agentsSpy = mockAgentsRun()

    const result = await service.app
      .get(CommunityIssueDispatchService)
      .dispatchIfNeeded(orgSlug)

    expect(agentsSpy).not.toHaveBeenCalled()
    expect(result).toEqual({ dispatched: 1, skipped: 1 })
  })

  it('the cutover re-dispatches when the top_community rows are older than the window', async () => {
    const orgSlug = `ci-top-cutover-stale-${Date.now()}`
    await seedOrgWithOffice(orgSlug)
    await seedTopRow(orgSlug, INACTIVITY_THRESHOLD_DAYS + 10)
    mockDispatchRun()
    const agentsSpy = mockAgentsRun()

    const result = await service.app
      .get(CommunityIssueDispatchService)
      .dispatchIfNeeded(orgSlug)

    expect(agentsSpy).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ dispatched: 2, skipped: 0 })
  })

  it('the topCommunityIssuesDaily bucket starts an AgentRun', async () => {
    vi.stubEnv('MEETINGS_AUTOMATION_ENABLED', 'true')
    vi.useFakeTimers({ toFake: ['Date'], now: SUNDAY_UTC })
    await seedOrg(CRON_TOP_BUCKET_SLUG)
    await service.prisma.electedOffice.create({
      data: {
        userId: service.user.id,
        organizationSlug: CRON_TOP_BUCKET_SLUG,
        onboardingCompletedAt: new Date(),
      },
    })
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { metaData: { lastVisited: Date.now() } },
    })
    mockResolveServeContext(L2_CONTEXT)
    const dispatchSpy = mockDispatchRun()
    const agentsSpy = mockAgentsRun()

    await service.jobs.runSchedule('topCommunityIssuesDaily')

    expect(dispatchSpy).not.toHaveBeenCalled()
    expect(agentsSpy.mock.calls.map((c) => c[0])).toEqual([
      'top_community_issues',
    ])
  })
})

describe('DispatchRequestSchema — orgSlugs cap', () => {
  it('rejects an orgSlugs array longer than 200', () => {
    const result = DispatchRequestSchema.safeParse({
      orgSlugs: Array.from({ length: 201 }, (_, i) => `org-${i}`),
    })
    expect(result.success).toBe(false)
  })

  it('accepts an orgSlugs array of exactly 200', () => {
    const result = DispatchRequestSchema.safeParse({
      orgSlugs: Array.from({ length: 200 }, (_, i) => `org-${i}`),
    })
    expect(result.success).toBe(true)
  })

  it('rejects an empty orgSlugs array', () => {
    const result = DispatchRequestSchema.safeParse({ orgSlugs: [] })
    expect(result.success).toBe(false)
  })
})
