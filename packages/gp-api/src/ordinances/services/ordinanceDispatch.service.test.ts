import { subDays } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ExperimentRunStatus,
  OrdinanceConfidence,
  OrdinanceDataQuality,
} from '../../generated/prisma'
import { CronLockService } from '@/cron/services/cronLock.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { TEST_CLERK_ID, useTestService } from '@/test-service'
import { FIND_EXISTING_ORDINANCES } from '../ordinances.constants'
import { OrdinanceDispatchService } from './ordinanceDispatch.service'

const service = useTestService()

const seedOrgWithOffice = async (slug: string) => {
  await service.prisma.organization.upsert({
    where: { slug },
    create: { slug, ownerId: service.user.id },
    update: {},
  })
  return service.prisma.electedOffice.create({
    data: { userId: service.user.id, organizationSlug: slug },
  })
}

const mockResolveServeContext = (
  result: Awaited<ReturnType<OrganizationsService['resolveServeContext']>>,
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

describe('OrdinanceDispatchService.onElectedOfficeCreated', () => {
  beforeEach(() => {
    vi.stubEnv('ORDINANCES_AUTOMATION_ENABLED', 'true')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('dispatches find_existing_ordinances with exactly the manifest params', async () => {
    const orgSlug = `ord-happy-${Date.now()}`
    const office = await seedOrgWithOffice(orgSlug)
    mockResolveServeContext({
      state: 'MN',
      positionName: 'Ramsey City Council',
      isServeIcp: true,
    })
    const dispatchSpy = mockDispatchRun()

    await service.app
      .get(OrdinanceDispatchService)
      .onElectedOfficeCreated(office)

    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: FIND_EXISTING_ORDINANCES,
      organizationSlug: orgSlug,
      clerkUserId: TEST_CLERK_ID,
      priority: 'HIGH',
      params: {
        organization_slug: orgSlug,
        state: 'MN',
        office: 'Ramsey City Council',
      },
    })
  })

  it('normalizes a padded lowercase state to a 2-letter code', async () => {
    const orgSlug = `ord-norm-${Date.now()}`
    const office = await seedOrgWithOffice(orgSlug)
    mockResolveServeContext({
      state: ' mn ',
      positionName: 'City Council',
      isServeIcp: true,
    })
    const dispatchSpy = mockDispatchRun()

    await service.app
      .get(OrdinanceDispatchService)
      .onElectedOfficeCreated(office)

    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ state: 'MN' }),
      }),
    )
  })

  it('skips when the stored state is not a 2-letter code', async () => {
    const orgSlug = `ord-badstate-${Date.now()}`
    const office = await seedOrgWithOffice(orgSlug)
    mockResolveServeContext({
      state: 'Minnesota',
      positionName: 'City Council',
      isServeIcp: true,
    })
    const dispatchSpy = mockDispatchRun()

    await service.app
      .get(OrdinanceDispatchService)
      .onElectedOfficeCreated(office)

    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('truncates an unbounded position name to the manifest max of 256', async () => {
    const orgSlug = `ord-trunc-${Date.now()}`
    const office = await seedOrgWithOffice(orgSlug)
    const longPositionName = `Ramsey City Council ${'x'.repeat(300)}`
    mockResolveServeContext({
      state: 'MN',
      positionName: longPositionName,
      isServeIcp: true,
    })
    const dispatchSpy = mockDispatchRun()

    await service.app
      .get(OrdinanceDispatchService)
      .onElectedOfficeCreated(office)

    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          office: longPositionName.slice(0, 256),
        }),
      }),
    )
  })

  it('skips an org that is not serve-ICP', async () => {
    const orgSlug = `ord-notidp-${Date.now()}`
    const office = await seedOrgWithOffice(orgSlug)
    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      isServeIcp: false,
    })
    const dispatchSpy = mockDispatchRun()

    await service.app
      .get(OrdinanceDispatchService)
      .onElectedOfficeCreated(office)

    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('fails closed when isServeIcp is absent', async () => {
    const orgSlug = `ord-nullicp-${Date.now()}`
    const office = await seedOrgWithOffice(orgSlug)
    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
    })
    const dispatchSpy = mockDispatchRun()

    await service.app
      .get(OrdinanceDispatchService)
      .onElectedOfficeCreated(office)

    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('skips when a live or completed run already exists (one-time semantic)', async () => {
    const orgSlug = `ord-exists-${Date.now()}`
    const office = await seedOrgWithOffice(orgSlug)
    await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: FIND_EXISTING_ORDINANCES,
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
      .get(OrdinanceDispatchService)
      .onElectedOfficeCreated(office)

    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('re-dispatches when the only prior run is FAILED', async () => {
    const orgSlug = `ord-failed-${Date.now()}`
    const office = await seedOrgWithOffice(orgSlug)
    await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: FIND_EXISTING_ORDINANCES,
        status: ExperimentRunStatus.FAILED,
      },
    })
    mockResolveServeContext({
      state: 'MN',
      positionName: 'City Council',
      isServeIcp: true,
    })
    const dispatchSpy = mockDispatchRun()

    await service.app
      .get(OrdinanceDispatchService)
      .onElectedOfficeCreated(office)

    expect(dispatchSpy).toHaveBeenCalledTimes(1)
  })

  it('skips when automation is disabled', async () => {
    vi.stubEnv('ORDINANCES_AUTOMATION_ENABLED', '')
    const orgSlug = `ord-disabled-${Date.now()}`
    const office = await seedOrgWithOffice(orgSlug)
    const dispatchSpy = mockDispatchRun()

    await service.app
      .get(OrdinanceDispatchService)
      .onElectedOfficeCreated(office)

    expect(dispatchSpy).not.toHaveBeenCalled()
  })
})

const seedRecord = (
  slug: string,
  data: {
    verifiedAt: Date
    confidence?: OrdinanceConfidence
    codeFound?: boolean
  },
) =>
  service.prisma.ordinanceCodeRecord.create({
    data: {
      organizationSlug: slug,
      codeFound: data.codeFound ?? true,
      dataQuality: OrdinanceDataQuality.OK,
      confidence: data.confidence ?? OrdinanceConfidence.HIGH,
      place: 'Ramsey',
      state: 'MN',
      verifiedEvidence: 'evidence',
      artifactBucket: 'bucket',
      artifactKey: 'key',
      verifiedAt: data.verifiedAt,
    },
  })

const mockCronLock = (claimed: boolean) => {
  const cronLock = service.app.get(CronLockService)
  return {
    claimSpy: vi.spyOn(cronLock, 'tryClaimDailyRun').mockResolvedValue(claimed),
    completeSpy: vi
      .spyOn(cronLock, 'markCompleted')
      .mockResolvedValue(undefined),
  }
}

describe('OrdinanceDispatchService.dispatchDailyRefresh', () => {
  beforeEach(() => {
    vi.stubEnv('ORDINANCES_AUTOMATION_ENABLED', 'true')
    mockResolveServeContext({
      state: 'MN',
      positionName: 'Ramsey City Council',
      isServeIcp: true,
    })
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('does nothing when automation is disabled', async () => {
    vi.stubEnv('ORDINANCES_AUTOMATION_ENABLED', '')
    const orgSlug = `ord-cron-off-${Date.now()}`
    await seedOrgWithOffice(orgSlug)
    await seedRecord(orgSlug, { verifiedAt: subDays(new Date(), 61) })
    const dispatchSpy = mockDispatchRun()
    const { claimSpy } = mockCronLock(true)

    await service.app.get(OrdinanceDispatchService).dispatchDailyRefresh()

    expect(dispatchSpy).not.toHaveBeenCalled()
    expect(claimSpy).not.toHaveBeenCalled()
  })

  it('does no work when another replica holds the daily lease', async () => {
    const orgSlug = `ord-cron-lease-${Date.now()}`
    await seedOrgWithOffice(orgSlug)
    await seedRecord(orgSlug, { verifiedAt: subDays(new Date(), 61) })
    const dispatchSpy = mockDispatchRun()
    const { completeSpy } = mockCronLock(false)

    await service.app.get(OrdinanceDispatchService).dispatchDailyRefresh()

    expect(dispatchSpy).not.toHaveBeenCalled()
    expect(completeSpy).not.toHaveBeenCalled()
  })

  it('skips an org whose record is fresh', async () => {
    const orgSlug = `ord-cron-fresh-${Date.now()}`
    await seedOrgWithOffice(orgSlug)
    await seedRecord(orgSlug, { verifiedAt: subDays(new Date(), 5) })
    const dispatchSpy = mockDispatchRun()
    mockCronLock(true)

    await service.app.get(OrdinanceDispatchService).dispatchDailyRefresh()

    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('dispatches a refresh for a record older than 60 days', async () => {
    const orgSlug = `ord-cron-stale-${Date.now()}`
    await seedOrgWithOffice(orgSlug)
    await seedRecord(orgSlug, { verifiedAt: subDays(new Date(), 61) })
    const dispatchSpy = mockDispatchRun()
    const { completeSpy } = mockCronLock(true)

    await service.app.get(OrdinanceDispatchService).dispatchDailyRefresh()

    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: FIND_EXISTING_ORDINANCES,
      organizationSlug: orgSlug,
      clerkUserId: TEST_CLERK_ID,
      params: {
        organization_slug: orgSlug,
        state: 'MN',
        office: 'Ramsey City Council',
      },
    })
    expect(completeSpy).toHaveBeenCalledTimes(1)
  })

  it('re-checks a low-confidence not-found record after 14 days', async () => {
    const orgSlug = `ord-cron-leash-${Date.now()}`
    await seedOrgWithOffice(orgSlug)
    await seedRecord(orgSlug, {
      verifiedAt: subDays(new Date(), 15),
      confidence: OrdinanceConfidence.LOW,
      codeFound: false,
    })
    const dispatchSpy = mockDispatchRun()
    mockCronLock(true)

    await service.app.get(OrdinanceDispatchService).dispatchDailyRefresh()

    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ organizationSlug: orgSlug }),
    )
  })

  it('holds the 14-day leash on a young low-confidence not-found record', async () => {
    const orgSlug = `ord-cron-young-${Date.now()}`
    await seedOrgWithOffice(orgSlug)
    await seedRecord(orgSlug, {
      verifiedAt: subDays(new Date(), 5),
      confidence: OrdinanceConfidence.LOW,
      codeFound: false,
    })
    const dispatchSpy = mockDispatchRun()
    mockCronLock(true)

    await service.app.get(OrdinanceDispatchService).dispatchDailyRefresh()

    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('dispatches a first run for an office org with no record or run', async () => {
    const orgSlug = `ord-cron-norec-${Date.now()}`
    await seedOrgWithOffice(orgSlug)
    const dispatchSpy = mockDispatchRun()
    mockCronLock(true)

    await service.app.get(OrdinanceDispatchService).dispatchDailyRefresh()

    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ organizationSlug: orgSlug }),
    )
  })

  it('skips a no-record org whose run completed within 60 days', async () => {
    const orgSlug = `ord-cron-recent-${Date.now()}`
    await seedOrgWithOffice(orgSlug)
    await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: FIND_EXISTING_ORDINANCES,
        status: ExperimentRunStatus.COMPLETED,
      },
    })
    const dispatchSpy = mockDispatchRun()
    mockCronLock(true)

    await service.app.get(OrdinanceDispatchService).dispatchDailyRefresh()

    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('skips an org with an in-flight run', async () => {
    const orgSlug = `ord-cron-inflight-${Date.now()}`
    await seedOrgWithOffice(orgSlug)
    await seedRecord(orgSlug, { verifiedAt: subDays(new Date(), 61) })
    await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: FIND_EXISTING_ORDINANCES,
        status: ExperimentRunStatus.QUEUED,
      },
    })
    const dispatchSpy = mockDispatchRun()
    mockCronLock(true)

    await service.app.get(OrdinanceDispatchService).dispatchDailyRefresh()

    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('caps dispatches at 200 per tick and still completes the lease', async () => {
    const slugs = Array.from({ length: 201 }, (_, i) => `ord-cap-${i}`)
    await service.prisma.organization.createMany({
      data: slugs.map((slug) => ({ slug, ownerId: service.user.id })),
    })
    await service.prisma.electedOffice.createMany({
      data: slugs.map((slug) => ({
        userId: service.user.id,
        organizationSlug: slug,
      })),
    })
    const verifiedAt = subDays(new Date(), 61)
    await service.prisma.ordinanceCodeRecord.createMany({
      data: slugs.map((slug) => ({
        organizationSlug: slug,
        codeFound: true,
        dataQuality: OrdinanceDataQuality.OK,
        confidence: OrdinanceConfidence.HIGH,
        place: 'Ramsey',
        state: 'MN',
        verifiedEvidence: 'evidence',
        artifactBucket: 'bucket',
        artifactKey: 'key',
        verifiedAt,
      })),
    })
    const dispatchSpy = mockDispatchRun()
    const { completeSpy } = mockCronLock(true)

    await service.app.get(OrdinanceDispatchService).dispatchDailyRefresh()

    expect(dispatchSpy).toHaveBeenCalledTimes(200)
    expect(completeSpy).toHaveBeenCalledTimes(1)
  })
})

describe('clerkless elected-office users', () => {
  beforeEach(() => {
    vi.stubEnv('ORDINANCES_AUTOMATION_ENABLED', 'true')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('dispatches without a clerk user id when the office user has none', async () => {
    const orgSlug = `ord-clerkless-${Date.now()}`
    const office = await seedOrgWithOffice(orgSlug)
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { clerkId: null },
    })
    mockResolveServeContext({
      state: 'MN',
      positionName: 'Ramsey City Council',
      isServeIcp: true,
    })
    const dispatchSpy = mockDispatchRun()

    await service.app
      .get(OrdinanceDispatchService)
      .onElectedOfficeCreated(office)

    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ clerkUserId: undefined }),
    )
  })
})
