import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { ExperimentRunStatus, Prisma } from '../../../generated/prisma'
import { CAMPAIGN_TRACKER_EXPERIMENT_TYPE } from '../campaignTracker.consts'
import { CampaignTrackerTasksService } from './campaignTrackerTasks.service'

// Runs the real campaignTrackerWeekly schedule and its campaignTrackerRegen
// fan-out on the real pg-boss workers (src/jobs/AGENTS.md § Tests).
const service = useTestService({ jobs: true })

const seedCampaign = async (
  overrides: Partial<Prisma.CampaignUncheckedCreateInput> = {},
  { trackerRows = true }: { trackerRows?: boolean } = {},
) => {
  const slug = `tracker-weekly-${randomUUID()}`
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
  if (trackerRows) {
    await service.prisma.campaignTrackerTask.create({
      data: {
        campaignId: campaign.id,
        title: 'Get your EIN',
        description: '',
        week: 0,
        date: new Date('2099-01-05T00:00:00.000Z'),
      },
    })
  }
  return campaign
}

const spyGeneration = () =>
  vi
    .spyOn(service.app.get(CampaignTrackerTasksService), 'dispatchGeneration')
    .mockResolvedValue(undefined)

const generatedFor = (spy: ReturnType<typeof spyGeneration>) =>
  spy.mock.calls.map(([campaign, mode]) => [campaign.id, mode])

describe('the campaignTrackerWeekly schedule', () => {
  beforeEach(() => {
    vi.stubEnv('CAMPAIGN_TRACKER_AUTOMATION_ENABLED', 'true')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('does nothing when automation is disabled', async () => {
    vi.stubEnv('CAMPAIGN_TRACKER_AUTOMATION_ENABLED', '')
    await seedCampaign()
    const generation = spyGeneration()

    await service.jobs.runSchedule('campaignTrackerWeekly')

    expect(generation).not.toHaveBeenCalled()
  })

  it('regenerates only active, non-demo campaigns already on the tracker', async () => {
    const eligible = await seedCampaign()
    await seedCampaign({ isActive: false })
    await seedCampaign({ isDemo: true })
    await seedCampaign({}, { trackerRows: false })
    const generation = spyGeneration()

    await service.jobs.runSchedule('campaignTrackerWeekly')

    expect(generatedFor(generation)).toEqual([[eligible.id, 'weekly']])
  })

  it('removes outreach and skips generation when the primary was lost', async () => {
    const lost = await seedCampaign({ primaryResult: 'lost' })
    const generation = spyGeneration()
    const removeOutreach = vi
      .spyOn(
        service.app.get(CampaignTrackerTasksService),
        'removeOutreachTasks',
      )
      .mockResolvedValue(0)

    await service.jobs.runSchedule('campaignTrackerWeekly')

    expect(removeOutreach).toHaveBeenCalledWith(lost.id)
    expect(generation).not.toHaveBeenCalled()
  })

  it('skips a campaign whose election has already passed', async () => {
    await seedCampaign({ details: { electionDate: '2020-01-01' } })
    const generation = spyGeneration()

    await service.jobs.runSchedule('campaignTrackerWeekly')

    expect(generation).not.toHaveBeenCalled()
  })

  it('skips a campaign that already had a run this week, but not a failed one', async () => {
    const covered = await seedCampaign()
    const failed = await seedCampaign()
    await service.prisma.experimentRun.create({
      data: {
        organizationSlug: covered.organizationSlug ?? '',
        experimentType: CAMPAIGN_TRACKER_EXPERIMENT_TYPE,
        status: ExperimentRunStatus.COMPLETED,
      },
    })
    await service.prisma.experimentRun.create({
      data: {
        organizationSlug: failed.organizationSlug ?? '',
        experimentType: CAMPAIGN_TRACKER_EXPERIMENT_TYPE,
        status: ExperimentRunStatus.FAILED,
      },
    })
    const generation = spyGeneration()

    await service.jobs.runSchedule('campaignTrackerWeekly')

    expect(generatedFor(generation)).toEqual([[failed.id, 'weekly']])
  })

  it('dead-letters one campaign whose generation fails and still regenerates the rest', async () => {
    const failing = await seedCampaign()
    const ok = await seedCampaign()
    const generation = spyGeneration().mockImplementation(async (campaign) => {
      if (campaign.id === failing.id) throw new Error('boom')
    })

    const { deadLetters } = await service.jobs.runSchedule(
      'campaignTrackerWeekly',
      { allowDeadLetters: true },
    )

    expect(deadLetters).toEqual([
      {
        name: 'campaignTrackerRegen',
        data: { campaignId: failing.id },
        error: 'boom',
      },
    ])
    expect(generation).toHaveBeenCalledWith(
      expect.objectContaining({ id: ok.id }),
      'weekly',
    )
  })
})
