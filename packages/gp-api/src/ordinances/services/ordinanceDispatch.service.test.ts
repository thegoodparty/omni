import { BadGatewayException } from '@nestjs/common'
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
import { bucketForSlug } from '../../communityIssues/communityIssueBucketing'
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

// The refresh cron only considers orgs whose slug hashes to today's UTC-day
// bucket. These helpers build slugs that land in / out of that bucket so the
// cron tests exercise the staleness logic rather than the bucket filter.
const slugsInTodaysBucket = (prefix: string, count: number): string[] => {
  const bucket = new Date().getUTCDay()
  const slugs: string[] = []
  let i = 0
  while (slugs.length < count) {
    const slug = `${prefix}-${i}`
    if (bucketForSlug(slug, 7) === bucket) slugs.push(slug)
    i++
  }
  return slugs
}

const slugInTodaysBucket = (prefix: string): string => {
  const bucket = new Date().getUTCDay()
  let i = 0
  while (bucketForSlug(`${prefix}-${i}`, 7) !== bucket) i++
  return `${prefix}-${i}`
}

const slugOutsideTodaysBucket = (prefix: string): string => {
  const bucket = new Date().getUTCDay()
  let i = 0
  while (bucketForSlug(`${prefix}-${i}`, 7) === bucket) i++
  return `${prefix}-${i}`
}

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

  it('does not resolve serve context when a completed run already exists', async () => {
    const orgSlug = `ord-completed-${Date.now()}`
    const office = await seedOrgWithOffice(orgSlug)
    await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: FIND_EXISTING_ORDINANCES,
        status: ExperimentRunStatus.COMPLETED,
      },
    })
    const serveSpy = vi
      .spyOn(service.app.get(OrganizationsService), 'resolveServeContext')
      .mockResolvedValue({
        state: 'MN',
        positionName: 'City Council',
        isServeIcp: true,
      })
    const dispatchSpy = mockDispatchRun()

    await service.app
      .get(OrdinanceDispatchService)
      .onElectedOfficeCreated(office)

    expect(serveSpy).not.toHaveBeenCalled()
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
    const orgSlug = slugInTodaysBucket('ord-cron-fresh')
    await seedOrgWithOffice(orgSlug)
    await seedRecord(orgSlug, { verifiedAt: subDays(new Date(), 5) })
    const dispatchSpy = mockDispatchRun()
    mockCronLock(true)

    await service.app.get(OrdinanceDispatchService).dispatchDailyRefresh()

    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('dispatches a refresh for a record older than 60 days', async () => {
    const orgSlug = slugInTodaysBucket('ord-cron-stale')
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
    const orgSlug = slugInTodaysBucket('ord-cron-leash')
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
    const orgSlug = slugInTodaysBucket('ord-cron-young')
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
    const orgSlug = slugInTodaysBucket('ord-cron-norec')
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
    const orgSlug = slugInTodaysBucket('ord-cron-recent')
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
    const orgSlug = slugInTodaysBucket('ord-cron-inflight')
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
    const slugs = slugsInTodaysBucket('ord-cap', 201)
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

  it('dispatches only the stale org whose slug is in today bucket', async () => {
    const inBucket = slugInTodaysBucket('ord-cron-inbucket')
    const outBucket = slugOutsideTodaysBucket('ord-cron-outbucket')
    await seedOrgWithOffice(inBucket)
    await seedOrgWithOffice(outBucket)
    await seedRecord(inBucket, { verifiedAt: subDays(new Date(), 61) })
    await seedRecord(outBucket, { verifiedAt: subDays(new Date(), 61) })
    const dispatchSpy = mockDispatchRun()
    mockCronLock(true)

    await service.app.get(OrdinanceDispatchService).dispatchDailyRefresh()

    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ organizationSlug: inBucket }),
    )
  })

  it('isolates a serve-context failure to one org and dispatches the rest', async () => {
    const failSlug = slugInTodaysBucket('ord-cron-fault-a')
    const okSlug = slugInTodaysBucket('ord-cron-fault-b')
    await seedOrgWithOffice(failSlug)
    await seedOrgWithOffice(okSlug)
    const dispatchSpy = mockDispatchRun()
    mockCronLock(true)
    vi.spyOn(
      service.app.get(OrganizationsService),
      'resolveServeContext',
    ).mockImplementation(async (org) => {
      if (org.slug === failSlug) {
        throw new BadGatewayException('election-api unavailable')
      }
      return { state: 'MN', positionName: 'City Council', isServeIcp: true }
    })

    await expect(
      service.app.get(OrdinanceDispatchService).dispatchDailyRefresh(),
    ).resolves.toBeUndefined()

    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ organizationSlug: okSlug }),
    )
  })

  it('skips an org with a FAILED run inside the retry backoff window', async () => {
    const orgSlug = slugInTodaysBucket('ord-cron-failrecent')
    await seedOrgWithOffice(orgSlug)
    await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: FIND_EXISTING_ORDINANCES,
        status: ExperimentRunStatus.FAILED,
        createdAt: subDays(new Date(), 1),
      },
    })
    const dispatchSpy = mockDispatchRun()
    mockCronLock(true)

    await service.app.get(OrdinanceDispatchService).dispatchDailyRefresh()

    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('re-dispatches an org whose FAILED run predates the retry backoff', async () => {
    const orgSlug = slugInTodaysBucket('ord-cron-failold')
    await seedOrgWithOffice(orgSlug)
    await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: FIND_EXISTING_ORDINANCES,
        status: ExperimentRunStatus.FAILED,
        createdAt: subDays(new Date(), 3),
      },
    })
    const dispatchSpy = mockDispatchRun()
    mockCronLock(true)

    await service.app.get(OrdinanceDispatchService).dispatchDailyRefresh()

    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ organizationSlug: orgSlug }),
    )
  })

  it('holds the leash when a recent completed run outdates a stale record', async () => {
    const orgSlug = slugInTodaysBucket('ord-cron-maxbranch')
    await seedOrgWithOffice(orgSlug)
    await seedRecord(orgSlug, { verifiedAt: subDays(new Date(), 100) })
    const run = await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: FIND_EXISTING_ORDINANCES,
        status: ExperimentRunStatus.COMPLETED,
      },
    })
    await service.prisma.$executeRaw`
      UPDATE experiment_run SET updated_at = ${subDays(new Date(), 5)}
      WHERE run_id = ${run.runId}
    `
    const dispatchSpy = mockDispatchRun()
    mockCronLock(true)

    await service.app.get(OrdinanceDispatchService).dispatchDailyRefresh()

    expect(dispatchSpy).not.toHaveBeenCalled()
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
