import { ExperimentRunStatus } from '../../generated/prisma'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { useTestService } from '@/test-service'
import { CommunityIssueFeedDispatchService } from './communityIssueFeedDispatch.service'

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

describe('CommunityIssueFeedDispatchService.onElectedOfficeCreated', () => {
  beforeEach(() => {
    vi.stubEnv('MEETINGS_AUTOMATION_ENABLED', 'true')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('dispatches one run of each type for a new elected office', async () => {
    const suffix = Date.now()
    const orgSlug = `cif-signup-${suffix}`
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
      .get(CommunityIssueFeedDispatchService)
      .onElectedOfficeCreated(electedOffice)

    const types = dispatchSpy.mock.calls.map((c) => c[0].type)
    expect(types).toContain('top_community_issues')
    expect(types).toContain('trending_issues')
    expect(dispatchSpy).toHaveBeenCalledTimes(2)
  })

  it('is idempotent — second call dispatches nothing when runs already exist', async () => {
    const suffix = Date.now()
    const orgSlug = `cif-idem-${suffix}`
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
      .get(CommunityIssueFeedDispatchService)
      .onElectedOfficeCreated(electedOffice)

    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('re-dispatches when only a FAILED prior run exists', async () => {
    const suffix = Date.now()
    const orgSlug = `cif-failed-${suffix}`
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
      .get(CommunityIssueFeedDispatchService)
      .onElectedOfficeCreated(electedOffice)

    expect(dispatchSpy).toHaveBeenCalledTimes(2)
  })

  it('skips dispatch when automation is disabled', async () => {
    vi.stubEnv('MEETINGS_AUTOMATION_ENABLED', '')
    const suffix = Date.now()
    const orgSlug = `cif-disabled-${suffix}`
    await seedOrg(orgSlug)
    const dispatchSpy = mockDispatchRun()

    const electedOffice = await service.prisma.electedOffice.create({
      data: {
        userId: service.user.id,
        organizationSlug: orgSlug,
      },
    })

    await service.app
      .get(CommunityIssueFeedDispatchService)
      .onElectedOfficeCreated(electedOffice)

    expect(dispatchSpy).not.toHaveBeenCalled()
  })
})

describe('CommunityIssueFeedDispatchService.dispatchForCohort', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('skips orgs that fail the serve-ICP gate', async () => {
    const suffix = Date.now()
    const orgSlug = `cif-cohort-icp-${suffix}`
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
      .get(CommunityIssueFeedDispatchService)
      .dispatchForCohort([orgSlug])

    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('skips orgs with an in-flight run of that type', async () => {
    const suffix = Date.now()
    const orgSlug = `cif-cohort-inflight-${suffix}`
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
      .get(CommunityIssueFeedDispatchService)
      .dispatchForCohort([orgSlug])

    // trending_issues should still be dispatched (no in-flight run for it)
    // but top_community_issues should be skipped
    const types = dispatchSpy.mock.calls.map((c) => c[0].type)
    expect(types).not.toContain('top_community_issues')
    expect(types).toContain('trending_issues')
  })

  it('dispatches both types for an eligible org with no in-flight runs', async () => {
    const suffix = Date.now()
    const orgSlug = `cif-cohort-ok-${suffix}`
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
      .get(CommunityIssueFeedDispatchService)
      .dispatchForCohort([orgSlug])

    const types = dispatchSpy.mock.calls.map((c) => c[0].type)
    expect(types).toContain('top_community_issues')
    expect(types).toContain('trending_issues')
    expect(result.dispatched).toBe(2)
    expect(result.skipped).toBe(0)
  })
})
