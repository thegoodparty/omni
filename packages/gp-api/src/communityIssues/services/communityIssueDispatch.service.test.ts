import { ExperimentRunStatus } from '../../generated/prisma'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { CronLockService } from '@/cron/services/cronLock.service'
import { useTestService } from '@/test-service'
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
