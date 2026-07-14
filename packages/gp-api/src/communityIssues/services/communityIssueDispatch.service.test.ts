import { ExperimentRunStatus } from '../../generated/prisma'
import { subDays } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { CronLockService } from '@/cron/services/cronLock.service'
import { useTestService } from '@/test-service'
// Imported after useTestService: analytics.service sits on a circular import
// chain (analytics -> users -> campaigns -> analytics) and must not be the
// first app-graph module evaluated, or Nest sees an undefined DI token.
import { AnalyticsService } from '@/analytics/analytics.service'
import { DispatchRequestSchema } from '../schemas/communityIssues.schema'
import { CommunityIssueDispatchService } from './communityIssueDispatch.service'

const service = useTestService()

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
      isServeIcp: true,
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
      isServeIcp: true,
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
      isServeIcp: true,
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

  it('skips orgs that fail the serve-ICP gate', async () => {
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

    await service.app
      .get(CommunityIssueDispatchService)
      .dispatchForCohort([orgSlug])

    expect(dispatchSpy).not.toHaveBeenCalled()
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
      isServeIcp: true,
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
      isServeIcp: true,
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
      isServeIcp: true,
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
      isServeIcp: true,
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
      isServeIcp: true,
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

describe(
  'CommunityIssueDispatchService.dispatchWeeklyTrendingIssues' +
    ' — QUEUED guard',
  () => {
    beforeEach(() => {
      vi.stubEnv('MEETINGS_AUTOMATION_ENABLED', 'true')
      vi.useFakeTimers({ now: SUNDAY_UTC })
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
          isServeIcp: true,
        })
        const dispatchSpy = mockDispatchRun()

        const cronLock = service.app.get(CronLockService)
        vi.spyOn(cronLock, 'tryClaimDailyRun').mockResolvedValue(true)
        vi.spyOn(cronLock, 'markCompleted').mockResolvedValue(undefined)

        await service.app
          .get(CommunityIssueDispatchService)
          .dispatchWeeklyTrendingIssues()

        const trendingCalls = dispatchSpy.mock.calls.filter(
          (c) =>
            c[0].type === 'trending_issues' &&
            c[0].organizationSlug === CRON_BUCKET0_SLUG,
        )
        expect(trendingCalls).toHaveLength(0)
      },
    )
  },
)

describe('CommunityIssueDispatchService — activity-gated dispatch', () => {
  describe('cron path (dispatchWeeklyTrendingIssues)', () => {
    beforeEach(() => {
      vi.stubEnv('MEETINGS_AUTOMATION_ENABLED', 'true')
      vi.useFakeTimers({ now: SUNDAY_UTC })
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
        data: { userId: service.user.id, organizationSlug: CRON_BUCKET0_SLUG },
      })
      await service.prisma.user.update({
        where: { id: service.user.id },
        data: { metaData: { lastVisited: Date.now() } },
      })
      mockResolveServeContext({
        state: 'MN',
        positionName: 'City Council',
        isServeIcp: true,
      })
      const dispatchSpy = mockDispatchRun()
      const cronLock = service.app.get(CronLockService)
      vi.spyOn(cronLock, 'tryClaimDailyRun').mockResolvedValue(true)
      vi.spyOn(cronLock, 'markCompleted').mockResolvedValue(undefined)

      await service.app
        .get(CommunityIssueDispatchService)
        .dispatchWeeklyTrendingIssues()

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
        data: { userId: service.user.id, organizationSlug: CRON_BUCKET0_SLUG },
      })
      const staleLastVisited = subDays(new Date(), 91).getTime()
      await service.prisma.user.update({
        where: { id: service.user.id },
        data: { metaData: { lastVisited: staleLastVisited } },
      })
      mockResolveServeContext({
        state: 'MN',
        positionName: 'City Council',
        isServeIcp: true,
      })
      const dispatchSpy = mockDispatchRun()
      const trackSpy = vi
        .spyOn(service.app.get(AnalyticsService), 'track')
        .mockResolvedValue({ event: 'stub', userId: 'stub' })
      const cronLock = service.app.get(CronLockService)
      vi.spyOn(cronLock, 'tryClaimDailyRun').mockResolvedValue(true)
      vi.spyOn(cronLock, 'markCompleted').mockResolvedValue(undefined)

      await service.app
        .get(CommunityIssueDispatchService)
        .dispatchWeeklyTrendingIssues()

      const trendingCalls = dispatchSpy.mock.calls.filter(
        (c) => c[0].type === 'trending_issues',
      )
      expect(trendingCalls).toHaveLength(0)
      expect(trackSpy).toHaveBeenCalledWith(
        service.user.id,
        'Community Issues - Dispatch Skipped',
        {
          organizationSlug: CRON_BUCKET0_SLUG,
          experimentType: 'trending_issues',
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
        isServeIcp: true,
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
        isServeIcp: true,
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

    it('skips entirely when the org fails the serve-ICP gate', async () => {
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

      expect(dispatchSpy).not.toHaveBeenCalled()
      expect(result).toEqual({ dispatched: 0, skipped: 2 })
    })
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
