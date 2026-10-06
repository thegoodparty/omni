import { addDays, format, subDays } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestException } from '@nestjs/common'
import { ExperimentRun, UserRole } from '../generated/prisma'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { AgentJobContracts } from '@/generated/agent-job-contracts'
import { CampaignStrategyService } from './services/campaignStrategy.service'
import { StrategicLandscapeParamsService } from './services/strategicLandscapeParams.service'
import { TEST_USER_DOMAIN } from '@/users/util/users.util'
import { useTestService } from '@/test-service'
import {
  BackfillPlansResponse,
  BACKFILL_PLANS_MAX_LIMIT,
} from './schemas/backfillPlans.schema'

const PATH = '/v1/campaignStrategy/backfill'

const dateString = (date: Date): string => format(date, 'yyyy-MM-dd')
const future = dateString(addDays(new Date(), 30))
const past = dateString(subDays(new Date(), 30))

describe('POST /v1/campaignStrategy/backfill', () => {
  const service = useTestService()

  let seq = 0
  const seedCampaign = async (
    details: Record<string, unknown> = {},
    overrides: Record<string, unknown> = {},
  ) => {
    const slug = `backfill-${++seq}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    return service.prisma.campaign.create({
      data: {
        organizationSlug: slug,
        userId: service.user.id,
        slug,
        isActive: true,
        isDemo: false,
        details: { raceId: 'br-race', electionDate: future, ...details },
        ...overrides,
      },
    })
  }

  // The route is AdminOrM2MGuard-gated; the default test user is not an
  // admin, so every cohort test promotes it first.
  const makeAdmin = () =>
    service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [UserRole.admin] },
    })

  const mockDispatchRun = () =>
    vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockImplementation(
        async () => ({ runId: `run-${++seq}` }) as ExperimentRun,
      )

  const dryRun = async (body: Record<string, unknown> = {}) => {
    const res = await service.client.post<BackfillPlansResponse>(PATH, body)
    expect(res.status).toBe(200)
    return res.data
  }

  const selectedIds = async (body: Record<string, unknown> = {}) =>
    (await dryRun(body)).preview.map((row) => row.id)

  beforeEach(makeAdmin)

  it('refuses a non-admin user', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [] },
    })

    const res = await service.client.post(PATH, {}, { validateStatus: null })

    expect(res.status).toBe(403)
  })

  it('caps the batch size', async () => {
    const res = await service.client.post(
      PATH,
      { apply: true, limit: BACKFILL_PLANS_MAX_LIMIT + 1 },
      { validateStatus: null },
    )

    expect(res.status).toBe(400)
  })

  it('selects an active campaign with a race, an upcoming election and no plan', async () => {
    const campaign = await seedCampaign()

    const report = await dryRun()

    expect(report.apply).toBe(false)
    expect(report.outcomes).toBeNull()
    expect(report.eligible).toBe(1)
    expect(report.selected).toBe(1)
    expect(report.approxCostUsd).toBe(2)
    expect(report.preview).toEqual([
      {
        id: campaign.id,
        createdAt: dateString(campaign.createdAt),
        electionDate: future,
      },
    ])
  })

  it('falls back to the primary when there is no general election date', async () => {
    const campaign = await seedCampaign({
      electionDate: undefined,
      primaryElectionDate: future,
    })

    expect(await selectedIds()).toEqual([campaign.id])
  })

  it.each([
    ['inactive', {}, { isActive: false }],
    ['demo', {}, { isDemo: true }],
    ['no raceId', { raceId: undefined }, {}],
    ['empty raceId', { raceId: '' }, {}],
    ['past election', { electionDate: past }, {}],
    ['no date at all', { electionDate: undefined }, {}],
    [
      'both dates passed',
      {
        electionDate: past,
        primaryElectionDate: dateString(subDays(new Date(), 60)),
      },
      {},
    ],
  ])('skips a campaign that is %s', async (_label, details, overrides) => {
    await seedCampaign(details, overrides)

    expect(await selectedIds()).toEqual([])
  })

  // The service refuses only when EVERY stored date has passed, so a returning
  // candidate carrying last cycle's general alongside an upcoming primary is
  // still generable.
  it('selects a campaign with a past general but an upcoming primary', async () => {
    const campaign = await seedCampaign({
      electionDate: past,
      primaryElectionDate: future,
    })

    const [row] = (await dryRun()).preview

    expect(row).toMatchObject({ id: campaign.id, electionDate: future })
  })

  it('skips a campaign whose plan is fully persisted', async () => {
    const campaign = await seedCampaign()
    await service.prisma.campaignStrategy.create({
      data: {
        campaignId: campaign.id,
        oppositionPersistedAt: new Date(),
        opportunitiesPersistedAt: new Date(),
      },
    })

    expect(await selectedIds()).toEqual([])
  })

  it.each([
    ['opposition only', { oppositionPersistedAt: new Date() }],
    ['opportunities only', { opportunitiesPersistedAt: new Date() }],
    ['neither', {}],
  ])('selects a half-finished plan (%s)', async (_label, markers) => {
    const campaign = await seedCampaign()
    await service.prisma.campaignStrategy.create({
      data: { campaignId: campaign.id, ...markers },
    })

    expect(await selectedIds()).toEqual([campaign.id])
  })

  it('skips a campaign created before createdSince', async () => {
    const old = await seedCampaign(
      {},
      { createdAt: new Date('2026-08-15T12:00:00Z') },
    )
    const recent = await seedCampaign()

    expect(await selectedIds({ createdSince: '2026-09-01' })).toEqual([
      recent.id,
    ])
    expect(await selectedIds({ createdSince: '2026-08-01' })).toEqual([
      recent.id,
      old.id,
    ])
  })

  it('skips test campaigns and counts them', async () => {
    const tester = await service.prisma.user.create({
      data: {
        email: `backfill-tester${TEST_USER_DOMAIN}`,
        firstName: 'Test',
        lastName: 'User',
      },
    })
    await service.prisma.organization.create({
      data: { slug: 'backfill-test-org', ownerId: tester.id },
    })
    await service.prisma.campaign.create({
      data: {
        organizationSlug: 'backfill-test-org',
        userId: tester.id,
        slug: 'backfill-test-org',
        isActive: true,
        isDemo: false,
        details: { raceId: 'br-race', electionDate: future },
      },
    })
    const real = await seedCampaign()

    const report = await dryRun()

    expect(report.eligible).toBe(1)
    expect(report.testCampaignsSkipped).toBe(1)
    expect(report.preview.map((row) => row.id)).toEqual([real.id])
  })

  it('reports the whole cohort on a dry run and newest first', async () => {
    const first = await seedCampaign()
    const second = await seedCampaign()

    const report = await dryRun({ limit: 1 })

    expect(report.selected).toBe(2)
    expect(report.preview.map((row) => row.id)).toEqual([second.id, first.id])
  })

  it('dispatches only the batch on apply, and a re-run skips what is done', async () => {
    const dispatch = mockDispatchRun()
    // Param building reads the race from election-api, which the harness
    // does not reach; the dispatch contract is what this test is about.
    const params = vi
      .spyOn(service.app.get(StrategicLandscapeParamsService), 'build')
      .mockResolvedValue({
        race_id: 'br-race',
      } as AgentJobContracts['opposition_research']['Input'])
    const older = await seedCampaign()
    const newer = await seedCampaign()

    const report = await dryRun({ apply: true, limit: 1 })

    expect(report.apply).toBe(true)
    expect(report.selected).toBe(1)
    expect(report.preview.map((row) => row.id)).toEqual([newer.id])
    expect(report.outcomes).toEqual({
      dispatched: 1,
      skipped: 0,
      failed: 0,
      failures: [],
    })
    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(
      await service.prisma.campaignStrategy.findUnique({
        where: { campaignId: older.id },
      }),
    ).toBeNull()

    await service.prisma.campaignStrategy.update({
      where: { campaignId: newer.id },
      data: {
        oppositionPersistedAt: new Date(),
        opportunitiesPersistedAt: new Date(),
      },
    })

    expect(await selectedIds()).toEqual([older.id])
    dispatch.mockRestore()
    params.mockRestore()
  })

  it('records a refused campaign as failed and keeps going', async () => {
    const older = await seedCampaign()
    const newer = await seedCampaign()
    const generate = vi
      .spyOn(
        service.app.get(CampaignStrategyService),
        'getOrGenerateStrategicLandscape',
      )
      .mockRejectedValueOnce(new BadRequestException('Election has passed'))
      .mockResolvedValueOnce({ status: 'generating' })

    const report = await dryRun({ apply: true, limit: 10 })

    expect(generate.mock.calls.map(([campaign]) => campaign.id)).toEqual([
      newer.id,
      older.id,
    ])
    expect(report.outcomes).toEqual({
      dispatched: 1,
      skipped: 0,
      failed: 1,
      failures: [{ id: newer.id, reason: 'Election has passed' }],
    })
    generate.mockRestore()
  })
})
