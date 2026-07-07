import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExperimentRunStatus } from '../../generated/prisma'
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
