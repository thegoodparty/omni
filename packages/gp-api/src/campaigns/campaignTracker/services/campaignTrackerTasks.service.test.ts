import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExperimentRunStatus } from '../../../generated/prisma'
import { CampaignTrackerTasksService } from './campaignTrackerTasks.service'
import { CAMPAIGN_TRACKER_EXPERIMENT_TYPE } from '../campaignTracker.consts'

// Direct-instantiation unit test (mirrors campaignStrategy.cap.test.ts): the
// service reads through this.model / this.client (both resolved from _prisma),
// so we override _prisma + logger after construction.

const makeService = () => {
  const prisma = {
    campaignTrackerTask: {
      count: vi.fn().mockResolvedValue(0),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    campaign: { findFirst: vi.fn().mockResolvedValue({ id: 42 }) },
    campaignStory: { findUnique: vi.fn().mockResolvedValue(null) },
    campaignStrategy: { findUnique: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  }
  const experimentRuns = {
    dispatchRun: vi.fn().mockResolvedValue({ runId: 'r1' }),
    findFirst: vi.fn().mockResolvedValue(null),
    markFailed: vi.fn().mockResolvedValue(undefined),
  }
  const s3 = { getFile: vi.fn() }
  const service = new CampaignTrackerTasksService(
    experimentRuns as never,
    s3 as never,
  )
  Object.defineProperty(service, '_prisma', { value: prisma })
  Object.assign(service, {
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  })
  return { service, prisma, experimentRuns, s3 }
}

const campaign = (over: Record<string, unknown> = {}) =>
  ({
    id: 42,
    organizationSlug: 'org-1',
    createdAt: new Date('2026-06-01'),
    details: {
      raceId: 'race-abc',
      electionDate: '2026-11-03',
      state: 'NC',
      city: 'Asheville',
    },
    user: { clerkId: 'clk_1', firstName: 'Jordan', lastName: 'Nguyen' },
    ...over,
  }) as never

describe('CampaignTrackerTasksService.dispatchGeneration', () => {
  let h: ReturnType<typeof makeService>
  beforeEach(() => {
    h = makeService()
  })

  it('skips dispatch when raceId / clerkId / name is missing', async () => {
    await h.service.dispatchGeneration(
      campaign({ details: {}, user: null }),
      'initial',
    )
    expect(h.experimentRuns.dispatchRun).not.toHaveBeenCalled()
  })

  it('dispatches initial with the personalization params (no catalog/prior tasks in params)', async () => {
    await h.service.dispatchGeneration(campaign(), 'initial')

    expect(h.experimentRuns.dispatchRun).toHaveBeenCalledTimes(1)
    const arg = h.experimentRuns.dispatchRun.mock.calls[0][0]
    expect(arg.type).toBe(CAMPAIGN_TRACKER_EXPERIMENT_TYPE)
    expect(arg.organizationSlug).toBe('org-1')
    expect(arg.clerkUserId).toBe('clk_1')

    const p = arg.params
    expect(p.mode).toBe('initial')
    expect(p.user_full_name).toBe('Jordan Nguyen')
    expect(p.race_id).toBe('race-abc')
    // The catalog ships as an experiment attachment and prior tasks come via
    // MCP — neither is sent in params (that's how we stay under the 6 KB cap).
    expect(p).not.toHaveProperty('task_catalog')
    expect(p).not.toHaveProperty('prior_tasks')
  })

  it('does not query the DB for prior tasks (weekly fetches them via MCP)', async () => {
    await h.service.dispatchGeneration(campaign(), 'weekly')
    const p = h.experimentRuns.dispatchRun.mock.calls[0][0].params
    expect(p.mode).toBe('weekly')
    expect(p).not.toHaveProperty('prior_tasks')
    // no prior-tasks read against the tracker model
    expect(h.prisma.campaignTrackerTask.findMany).not.toHaveBeenCalled()
  })

  it('assembles campaign_plan + campaign_story from the DB', async () => {
    h.prisma.campaignStory.findUnique.mockResolvedValueOnce({
      why: 'I care',
      background: 'Local business owner',
      issues: 'Housing',
    })
    h.prisma.campaignStrategy.findUnique.mockResolvedValueOnce({
      opportunities: [{ content: 'Engaged renters' }],
      challenges: [{ content: 'Low turnout' }],
      opponents: [{ fullName: 'Jane Doe', partyAffiliation: 'Independent' }],
    })
    await h.service.dispatchGeneration(campaign(), 'initial')

    const p = h.experimentRuns.dispatchRun.mock.calls[0][0].params
    expect(p.campaign_story).toContain('I care')
    expect(p.campaign_story).toContain('Housing')
    expect(p.campaign_plan).toContain('Engaged renters')
    expect(p.campaign_plan).toContain('Jane Doe (Independent)')
  })

  it('sends null plan/story when neither exists', async () => {
    await h.service.dispatchGeneration(campaign(), 'initial')
    const p = h.experimentRuns.dispatchRun.mock.calls[0][0].params
    expect(p.campaign_plan).toBeNull()
    expect(p.campaign_story).toBeNull()
  })
})

describe('CampaignTrackerTasksService.bootstrapForCampaign', () => {
  let h: ReturnType<typeof makeService>
  beforeEach(() => {
    h = makeService()
  })

  it('materializes static rows and dispatches initial when no tracker run exists', async () => {
    await h.service.bootstrapForCampaign(campaign())
    expect(h.prisma.campaignTrackerTask.createMany).toHaveBeenCalled()
    expect(h.experimentRuns.dispatchRun).toHaveBeenCalledTimes(1)
    expect(h.experimentRuns.dispatchRun.mock.calls[0][0].params.mode).toBe(
      'initial',
    )
  })

  it('skips the initial dispatch when a tracker run already exists (idempotent)', async () => {
    h.experimentRuns.findFirst.mockResolvedValueOnce({ runId: 'existing' })
    await h.service.bootstrapForCampaign(campaign())
    expect(h.experimentRuns.dispatchRun).not.toHaveBeenCalled()
  })

  it('does not re-create static rows when they already exist', async () => {
    h.prisma.campaignTrackerTask.count.mockResolvedValueOnce(31)
    await h.service.bootstrapForCampaign(campaign())
    expect(h.prisma.campaignTrackerTask.createMany).not.toHaveBeenCalled()
  })
})

describe('CampaignTrackerTasksService.onExperimentRunCompleted', () => {
  let h: ReturnType<typeof makeService>
  const run = (over: Record<string, unknown> = {}) =>
    ({
      runId: 'run-1',
      status: ExperimentRunStatus.COMPLETED,
      experimentType: CAMPAIGN_TRACKER_EXPERIMENT_TYPE,
      organizationSlug: 'org-1',
      artifactBucket: 'bucket',
      artifactKey: 'key',
      ...over,
    }) as never
  beforeEach(() => {
    h = makeService()
  })

  it('ignores a non-COMPLETED run', async () => {
    await h.service.onExperimentRunCompleted(
      run({ status: ExperimentRunStatus.RUNNING }),
    )
    expect(h.s3.getFile).not.toHaveBeenCalled()
    expect(h.experimentRuns.markFailed).not.toHaveBeenCalled()
  })

  it('ignores a different experiment type', async () => {
    await h.service.onExperimentRunCompleted(
      run({ experimentType: 'opposition_research' }),
    )
    expect(h.s3.getFile).not.toHaveBeenCalled()
  })

  it('marks failed and throws when the run has no artifact location', async () => {
    await expect(
      h.service.onExperimentRunCompleted(run({ artifactKey: null })),
    ).rejects.toThrow()
    expect(h.experimentRuns.markFailed).toHaveBeenCalledWith(
      'run-1',
      expect.stringContaining('artifact'),
    )
  })

  it('replaces non-static rows: events keep their date, tasks dated by order', async () => {
    h.s3.getFile.mockResolvedValueOnce(
      JSON.stringify({
        generated_at: '2026-06-24T00:00:00Z',
        tasks: [
          {
            kind: 'task',
            title: 'Knock doors',
            description: 'go',
            phase: 'active',
            channel: 'doorKnocking',
          },
          {
            kind: 'event',
            title: 'Festival',
            description: 'meet voters',
            phase: 'active',
            channel: 'event',
            date: '2026-07-11',
            url: 'https://x.test',
          },
        ],
      }),
    )
    await h.service.onExperimentRunCompleted(run())

    expect(h.prisma.$transaction).toHaveBeenCalled()
    expect(h.prisma.campaignTrackerTask.deleteMany).toHaveBeenCalledWith({
      where: { campaignId: 42, isDefaultTask: false },
    })
    const created =
      h.prisma.campaignTrackerTask.createMany.mock.calls[0][0].data
    expect(created).toHaveLength(2)
    expect(created[0].isDefaultTask).toBe(false)
    expect(created[1].link).toBe('https://x.test')
    // event keeps its real date
    expect(created[1].date).toEqual(new Date('2026-07-11T00:00:00'))
  })

  it('fail-closed: a bad artifact marks failed and rethrows', async () => {
    h.s3.getFile.mockResolvedValueOnce(null)
    await expect(h.service.onExperimentRunCompleted(run())).rejects.toThrow()
    expect(h.experimentRuns.markFailed).toHaveBeenCalledWith(
      'run-1',
      expect.any(String),
    )
    expect(h.prisma.campaignTrackerTask.createMany).not.toHaveBeenCalled()
  })

  it('no-ops when the campaign is not found', async () => {
    h.prisma.campaign.findFirst.mockResolvedValueOnce(null)
    await h.service.onExperimentRunCompleted(run())
    expect(h.s3.getFile).not.toHaveBeenCalled()
    expect(h.prisma.$transaction).not.toHaveBeenCalled()
  })
})
