import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import {
  AgentRunStatus,
  ExperimentRunStatus,
  Prisma,
} from '../../../generated/prisma'
import { CampaignTrackerTasksService } from './campaignTrackerTasks.service'
import { hasRecentTrackerRun } from './campaignTrackerRun'

const service = useTestService({ jobs: true })

const seedCampaign = async (
  overrides: Partial<Prisma.CampaignUncheckedCreateInput> = {},
) => {
  const slug = `tracker-run-${randomUUID()}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  const campaign = await service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug,
      organizationSlug: slug,
      isActive: true,
      details: { electionDate: '2099-11-03' },
      ...overrides,
    },
  })
  await service.prisma.campaignTrackerTask.create({
    data: {
      campaignId: campaign.id,
      title: 'Get your EIN',
      description: '',
      week: 0,
      date: new Date('2099-01-05T00:00:00.000Z'),
    },
  })
  return campaign
}

const since = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)

describe('hasRecentTrackerRun', () => {
  it('sees a run the PMF Engine stored', async () => {
    const campaign = await seedCampaign()
    await service.prisma.experimentRun.create({
      data: {
        organizationSlug: campaign.organizationSlug ?? '',
        experimentType: 'campaign_tracker_tasks',
        status: ExperimentRunStatus.COMPLETED,
      },
    })

    expect(
      await hasRecentTrackerRun(
        service.prisma,
        campaign.organizationSlug,
        since(6),
      ),
    ).toBe(true)
  })

  it('sees a run gp-api agents stored', async () => {
    const campaign = await seedCampaign()
    await service.prisma.agentRun.create({
      data: {
        agentName: 'campaign_tracker_tasks',
        organizationSlug: campaign.organizationSlug ?? '',
        status: AgentRunStatus.completed,
        manifest: {},
        shapeHash: 'a-shape',
        input: { organizationSlug: campaign.organizationSlug },
      },
    })

    expect(
      await hasRecentTrackerRun(
        service.prisma,
        campaign.organizationSlug,
        since(6),
      ),
    ).toBe(true)
  })

  it('ignores a failed run on either engine so a stuck week retries', async () => {
    const campaign = await seedCampaign()
    await service.prisma.experimentRun.create({
      data: {
        organizationSlug: campaign.organizationSlug ?? '',
        experimentType: 'campaign_tracker_tasks',
        status: ExperimentRunStatus.FAILED,
      },
    })
    await service.prisma.agentRun.create({
      data: {
        agentName: 'campaign_tracker_tasks',
        organizationSlug: campaign.organizationSlug ?? '',
        status: AgentRunStatus.failed,
        manifest: {},
        shapeHash: 'a-shape',
        input: { organizationSlug: campaign.organizationSlug },
      },
    })

    expect(
      await hasRecentTrackerRun(
        service.prisma,
        campaign.organizationSlug,
        since(6),
      ),
    ).toBe(false)
  })

  it('ignores a run older than the coverage window', async () => {
    const campaign = await seedCampaign()
    await service.prisma.experimentRun.create({
      data: {
        organizationSlug: campaign.organizationSlug ?? '',
        experimentType: 'campaign_tracker_tasks',
        status: ExperimentRunStatus.COMPLETED,
        createdAt: since(10),
      },
    })

    expect(
      await hasRecentTrackerRun(
        service.prisma,
        campaign.organizationSlug,
        since(6),
      ),
    ).toBe(false)
  })

  it('ignores another org runs', async () => {
    const campaign = await seedCampaign()
    const other = await seedCampaign()
    await service.prisma.experimentRun.create({
      data: {
        organizationSlug: other.organizationSlug ?? '',
        experimentType: 'campaign_tracker_tasks',
        status: ExperimentRunStatus.COMPLETED,
      },
    })

    expect(
      await hasRecentTrackerRun(
        service.prisma,
        campaign.organizationSlug,
        since(6),
      ),
    ).toBe(false)
  })
})

describe('the weekly coverage gate reads both engines', () => {
  beforeEach(() => {
    vi.stubEnv('CAMPAIGN_TRACKER_AUTOMATION_ENABLED', 'true')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  // The gate's rollback case: after a revert the run this week is on gp-api's
  // table and the switch points at the PMF Engine. Reading the switched table
  // alone would find nothing and dispatch a duplicate paid run.
  it('skips a campaign whose run this week is an AgentRun', async () => {
    const campaign = await seedCampaign()
    await service.prisma.agentRun.create({
      data: {
        agentName: 'campaign_tracker_tasks',
        organizationSlug: campaign.organizationSlug ?? '',
        status: AgentRunStatus.completed,
        manifest: {},
        shapeHash: 'a-shape',
        input: { organizationSlug: campaign.organizationSlug },
      },
    })
    const generation = vi
      .spyOn(service.app.get(CampaignTrackerTasksService), 'dispatchGeneration')
      .mockResolvedValue(undefined)

    await service.jobs.runSchedule('campaignTrackerWeekly')

    expect(generation).not.toHaveBeenCalled()
  })
})
