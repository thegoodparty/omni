import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { firstOrThrow } from 'src/shared/test-utils/arrays.util'
import {
  CampaignTaskType,
  ExperimentRunStatus,
} from '../../../generated/prisma'
import { CampaignTrackerTasksService } from './campaignTrackerTasks.service'
import { CAMPAIGN_TRACKER_EXPERIMENT_TYPE } from '../campaignTracker.consts'
import { SlackChannel } from 'src/vendors/slack/slackService.types'

// Direct-instantiation unit test (mirrors campaignStrategy.cap.test.ts): the
// service reads through this.model / this.client (both resolved from _prisma),
// so we override _prisma + logger after construction.

const makeService = () => {
  const prisma = {
    campaignTrackerTask: {
      count: vi.fn().mockResolvedValue(0),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn().mockResolvedValue({ id: 't1' }),
    },
    campaign: {
      findFirst: vi.fn().mockResolvedValue({ id: 42 }),
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: 42, isPro: false, data: {}, user: null }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 42, data: {} }),
      update: vi.fn().mockResolvedValue({}),
    },
    campaignUpdateHistory: {
      create: vi.fn().mockResolvedValue({ id: 99 }),
      delete: vi.fn().mockResolvedValue({}),
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ id: 99, type: 'text', quantity: 5 }),
    },
    campaignStory: { findUnique: vi.fn().mockResolvedValue(null) },
    website: { findUnique: vi.fn().mockResolvedValue(null) },
    campaignStrategy: {
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  }
  const experimentRuns = {
    dispatchRun: vi.fn().mockResolvedValue({ runId: 'r1' }),
    findFirst: vi.fn().mockResolvedValue(null),
    markFailed: vi.fn().mockResolvedValue(undefined),
  }
  const s3 = { getFile: vi.fn() }
  const slack = { message: vi.fn().mockResolvedValue('ok') }
  const service = new CampaignTrackerTasksService(
    experimentRuns as never,
    s3 as never,
    slack as never,
  )
  Object.defineProperty(service, '_prisma', { value: prisma })
  Object.assign(service, {
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  })
  return { service, prisma, experimentRuns, s3, slack }
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

// A Pro campaign as returned by findUnique({ include: { user } }): the shape
// the Slack notifications read (isPro gate, name, hubspotId).
const proCampaign = (over: Record<string, unknown> = {}) =>
  ({
    id: 42,
    isPro: true,
    data: { name: 'Jordan Nguyen', hubspotId: 'hs-9' },
    user: { firstName: 'Jordan', lastName: 'Nguyen' },
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
    const arg = firstOrThrow(h.experimentRuns.dispatchRun.mock.calls)[0]
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
    const p = firstOrThrow(h.experimentRuns.dispatchRun.mock.calls)[0].params
    expect(p.mode).toBe('weekly')
    expect(p).not.toHaveProperty('prior_tasks')
    // no prior-tasks read against the tracker model
    expect(h.prisma.campaignTrackerTask.findMany).not.toHaveBeenCalled()
  })

  it('assembles campaign_plan + campaign_story from the DB', async () => {
    h.prisma.campaignStory.findUnique.mockResolvedValueOnce({
      background: 'Local business owner',
    })
    // The "why" (bio) and issues live on the website now (shared with
    // Pro-upgrade).
    h.prisma.website.findUnique.mockResolvedValueOnce({
      content: {
        about: { bio: 'I care', issues: [{ description: 'Housing' }] },
      },
    })
    h.prisma.campaignStrategy.findUnique.mockResolvedValueOnce({
      opportunities: [{ content: 'Engaged renters' }],
      challenges: [{ content: 'Low turnout' }],
      opponents: [{ fullName: 'Jane Doe', partyAffiliation: 'Independent' }],
    })
    await h.service.dispatchGeneration(campaign(), 'initial')

    const p = firstOrThrow(h.experimentRuns.dispatchRun.mock.calls)[0].params
    expect(p.campaign_story).toContain('I care')
    expect(p.campaign_story).toContain('Housing')
    expect(p.campaign_plan).toContain('Engaged renters')
    expect(p.campaign_plan).toContain('Jane Doe (Independent)')
  })

  it('sends null plan/story when neither exists', async () => {
    await h.service.dispatchGeneration(campaign(), 'initial')
    const p = firstOrThrow(h.experimentRuns.dispatchRun.mock.calls)[0].params
    expect(p.campaign_plan).toBeNull()
    expect(p.campaign_story).toBeNull()
  })
})

describe('CampaignTrackerTasksService.bootstrapForCampaign', () => {
  let h: ReturnType<typeof makeService>
  beforeEach(() => {
    h = makeService()
  })

  it('claims the flag, materializes static rows, and dispatches initial when the claim wins', async () => {
    await h.service.bootstrapForCampaign(campaign())
    expect(h.prisma.campaignStrategy.updateMany).toHaveBeenCalledWith({
      where: { campaignId: 42, trackerBootstrapped: false },
      data: { trackerBootstrapped: true },
    })
    expect(h.prisma.campaignTrackerTask.createMany).toHaveBeenCalled()
    expect(h.experimentRuns.dispatchRun).toHaveBeenCalledTimes(1)
    expect(
      firstOrThrow(h.experimentRuns.dispatchRun.mock.calls)[0].params.mode,
    ).toBe('initial')
  })

  it('no-ops when the bootstrap flag is already claimed (concurrent completion)', async () => {
    h.prisma.campaignStrategy.updateMany.mockResolvedValueOnce({ count: 0 })
    await h.service.bootstrapForCampaign(campaign())
    expect(h.prisma.campaignTrackerTask.createMany).not.toHaveBeenCalled()
    expect(h.experimentRuns.dispatchRun).not.toHaveBeenCalled()
  })

  it('does not re-create static rows when they already exist', async () => {
    h.prisma.campaignTrackerTask.count.mockResolvedValueOnce(31)
    await h.service.bootstrapForCampaign(campaign())
    expect(h.prisma.campaignTrackerTask.createMany).not.toHaveBeenCalled()
  })

  it('releases the claim and rethrows when bootstrap work fails', async () => {
    h.prisma.campaignTrackerTask.createMany.mockRejectedValueOnce(
      new Error('db down'),
    )
    await expect(h.service.bootstrapForCampaign(campaign())).rejects.toThrow(
      'db down',
    )
    // claim flips false->true, then the failure resets it back to false
    expect(h.prisma.campaignStrategy.updateMany).toHaveBeenCalledTimes(2)
    expect(h.prisma.campaignStrategy.updateMany).toHaveBeenLastCalledWith({
      where: { campaignId: 42 },
      data: { trackerBootstrapped: false },
    })
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

  const artifact = () =>
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
    })

  it('appends a new generation without deleting prior rows', async () => {
    h.s3.getFile.mockResolvedValueOnce(artifact())
    await h.service.onExperimentRunCompleted(run())

    // Append, not replace — completion on prior generations survives.
    expect(h.prisma.campaignTrackerTask.deleteMany).not.toHaveBeenCalled()
    const created = firstOrThrow(
      h.prisma.campaignTrackerTask.createMany.mock.calls,
    )[0].data
    expect(created).toHaveLength(2)
    expect(created[0].isDefaultTask).toBe(false)
    // first generation when none exist yet
    expect(created[0].week).toBe(1)
    expect(created[1].link).toBe('https://x.test')
    // event keeps its real date
    expect(created[1].date).toEqual(new Date('2026-07-11T00:00:00'))
  })

  it('stamps the next generation index when prior generations exist', async () => {
    h.prisma.campaignTrackerTask.findFirst.mockResolvedValueOnce({ week: 2 })
    h.s3.getFile.mockResolvedValueOnce(artifact())
    await h.service.onExperimentRunCompleted(run())
    const created = firstOrThrow(
      h.prisma.campaignTrackerTask.createMany.mock.calls,
    )[0].data
    expect(created.every((r: { week: number }) => r.week === 3)).toBe(true)
  })

  describe('Slack notification on generation (Pro only)', () => {
    const weekTasks = [
      {
        id: 'k1',
        title: 'Knock doors',
        date: new Date('2026-07-13'),
        flowType: 'doorKnocking',
      },
      {
        id: 's1',
        title: 'Send intro text',
        date: new Date('2026-07-14'),
        flowType: 'text',
      },
    ]

    it('posts the week to casClickupTasks for a Pro weekly regen', async () => {
      // prior dynamic rows exist → generation 2 → a weekly regen, not bootstrap
      h.prisma.campaignTrackerTask.findFirst.mockResolvedValueOnce({ week: 1 })
      h.prisma.campaign.findUnique.mockResolvedValueOnce(proCampaign())
      h.prisma.campaignTrackerTask.findMany.mockResolvedValueOnce(weekTasks)
      h.s3.getFile.mockResolvedValueOnce(artifact())

      await h.service.onExperimentRunCompleted(run())

      expect(h.slack.message).toHaveBeenCalledTimes(1)
      const [message, channel] = firstOrThrow(h.slack.message.mock.calls)
      expect(channel).toBe(SlackChannel.casClickupTasks)
      const text = message.blocks[0].text.text
      expect(text).toContain('Weekly campaign tasks generated')
      expect(text).toContain('Jordan Nguyen')
      expect(text).toContain('hs-9')
      expect(text).toContain('DOORKNOCKING: Knock doors')
    })

    it('notifies with the first-week title on the initial generation', async () => {
      // no prior dynamic rows → generation 1 → initial bootstrap
      h.prisma.campaign.findUnique.mockResolvedValueOnce(proCampaign())
      h.prisma.campaignTrackerTask.findMany.mockResolvedValueOnce(weekTasks)
      h.s3.getFile.mockResolvedValueOnce(artifact())

      await h.service.onExperimentRunCompleted(run())

      expect(h.slack.message).toHaveBeenCalledTimes(1)
      const text = firstOrThrow(h.slack.message.mock.calls)[0].blocks[0].text
        .text
      expect(text).toContain('Campaign tracker launched')
    })

    it('does not notify a non-Pro campaign', async () => {
      // campaign.findUnique defaults to isPro: false
      h.s3.getFile.mockResolvedValueOnce(artifact())
      await h.service.onExperimentRunCompleted(run())
      expect(h.slack.message).not.toHaveBeenCalled()
    })

    it('keeps the run successful when the Slack post fails', async () => {
      h.prisma.campaign.findUnique.mockResolvedValueOnce(proCampaign())
      h.prisma.campaignTrackerTask.findMany.mockResolvedValueOnce(weekTasks)
      h.s3.getFile.mockResolvedValueOnce(artifact())
      h.slack.message.mockRejectedValueOnce(new Error('slack down'))

      await expect(
        h.service.onExperimentRunCompleted(run()),
      ).resolves.toBeUndefined()
      // rows were committed and the run was not marked failed
      expect(h.prisma.campaignTrackerTask.createMany).toHaveBeenCalled()
      expect(h.experimentRuns.markFailed).not.toHaveBeenCalled()
    })
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

describe('CampaignTrackerTasksService.notifyProUpgrade', () => {
  let h: ReturnType<typeof makeService>
  beforeEach(() => {
    h = makeService()
  })

  it('posts the earliest incomplete task window to casClickupTasks for Pro', async () => {
    h.prisma.campaign.findUnique.mockResolvedValueOnce(proCampaign())
    // The window is anchored to the earliest incomplete task, not the clock.
    // findFirst: earliest incomplete, then the latest dynamic generation (guard
    // + postCampaignWeekToSlack), which must be non-null to send.
    h.prisma.campaignTrackerTask.findFirst
      .mockResolvedValueOnce({ date: new Date('2026-07-06') })
      .mockResolvedValue({ week: 2 })
    h.prisma.campaignTrackerTask.findMany.mockResolvedValueOnce([
      {
        id: 't1',
        title: 'Door knock',
        date: new Date('2026-07-06'),
        flowType: 'doorKnocking',
      },
    ])
    const result = await h.service.notifyProUpgrade(42)

    expect(result).toBe(true)
    expect(h.slack.message).toHaveBeenCalledTimes(1)
    const [message, channel] = firstOrThrow(h.slack.message.mock.calls)
    expect(channel).toBe(SlackChannel.casClickupTasks)
    const text = message.blocks[0].text.text
    expect(text).toContain('Pro upgrade')
    expect(text).toContain('Door knock')
  })

  it('does nothing and returns false when there are no incomplete tasks', async () => {
    h.prisma.campaign.findUnique.mockResolvedValueOnce(proCampaign())
    // findFirst (earliest incomplete task) defaults to null
    const result = await h.service.notifyProUpgrade(42)
    expect(result).toBe(false)
    expect(h.slack.message).not.toHaveBeenCalled()
  })

  it('does not post before the first dynamic generation and returns false', async () => {
    h.prisma.campaign.findUnique.mockResolvedValueOnce(proCampaign())
    // Static tasks are materialized (earliest exists) but no dynamic generation
    // has landed yet, so the pro-upgrade post is skipped: notifyTasksGenerated
    // announces the first week when generation 1 completes.
    h.prisma.campaignTrackerTask.findFirst
      .mockResolvedValueOnce({ date: new Date('2026-07-06') })
      .mockResolvedValueOnce(null)
    const result = await h.service.notifyProUpgrade(42)
    expect(result).toBe(false)
    expect(h.slack.message).not.toHaveBeenCalled()
  })

  it('does nothing for a non-Pro campaign', async () => {
    // findUnique defaults to isPro: false
    await h.service.notifyProUpgrade(42)
    expect(h.slack.message).not.toHaveBeenCalled()
  })
})

// The CAS Slack message must scope tasks exactly like the weekly digest
// (fetchTrackerDigestRows): latest dynamic generation + deterministic
// text/robocall outreach, GOTV-gated to the 30-day window. These assert the
// Prisma `where` the query builds; the digest's matching SQL is covered by its
// integration test. Fixed clock so the GOTV window is deterministic.
describe('CampaignTrackerTasksService Slack query scoping', () => {
  let h: ReturnType<typeof makeService>
  beforeEach(() => {
    h = makeService()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const runProUpgrade = async (electionDate: string) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-01T12:00:00Z'))
    h.prisma.campaign.findUnique.mockResolvedValueOnce(
      proCampaign({ details: { electionDate } }),
    )
    // findFirst: earliest incomplete task, then the latest generation (fetched
    // for the guard and again inside postCampaignWeekToSlack).
    h.prisma.campaignTrackerTask.findFirst
      .mockResolvedValueOnce({ date: new Date('2026-07-06') })
      .mockResolvedValue({ week: 3 })
    h.prisma.campaignTrackerTask.findMany.mockResolvedValueOnce([])
    await h.service.notifyProUpgrade(42)
    return firstOrThrow(h.prisma.campaignTrackerTask.findMany.mock.calls)[0]
      .where
  }

  it('gates default rows to text/robocall outreach and scopes dynamic rows to the latest generation', async () => {
    const where = await runProUpgrade('2026-11-03')
    expect(where.OR).toEqual([
      {
        isDefaultTask: true,
        flowType: { in: [CampaignTaskType.text, CampaignTaskType.robocall] },
      },
      { isDefaultTask: false, week: 3 },
    ])
  })

  it('suppresses GOTV-phase tasks when the election is more than 30 days out', async () => {
    const where = await runProUpgrade('2026-11-03')
    expect(where.NOT).toEqual({ phase: 'gotv' })
  })

  it('stops suppressing GOTV-phase tasks once the election is within 30 days', async () => {
    const where = await runProUpgrade('2026-07-15')
    expect(where.NOT).toBeUndefined()
  })
})

describe('CampaignTrackerTasksService.completeTask', () => {
  let h: ReturnType<typeof makeService>
  const caller = { id: 42, userId: 7 } as never
  beforeEach(() => {
    h = makeService()
  })

  it('marks the task completed without voter contact', async () => {
    h.prisma.campaignTrackerTask.findFirst.mockResolvedValueOnce({
      id: 't1',
      completed: false,
    })
    await h.service.completeTask(caller, 't1')
    expect(h.prisma.campaignUpdateHistory.create).not.toHaveBeenCalled()
    expect(h.prisma.campaignTrackerTask.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { completed: true },
    })
  })

  it('logs history and bumps reported goals with voter contact', async () => {
    h.prisma.campaignTrackerTask.findFirst.mockResolvedValueOnce({
      id: 't1',
      completed: false,
    })
    await h.service.completeTask(caller, 't1', {
      type: 'text',
      quantity: 5,
    } as never)
    expect(h.prisma.$executeRaw).toHaveBeenCalled()
    expect(h.prisma.campaignUpdateHistory.create).toHaveBeenCalled()
    expect(h.prisma.campaign.update).toHaveBeenCalled()
    expect(h.prisma.campaignTrackerTask.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { completed: true, updateHistoryId: 99 },
    })
  })

  it('is idempotent when the task is already completed', async () => {
    h.prisma.campaignTrackerTask.findFirst.mockResolvedValueOnce({
      id: 't1',
      completed: true,
    })
    await h.service.completeTask(caller, 't1')
    expect(h.prisma.campaignTrackerTask.update).not.toHaveBeenCalled()
  })

  it('throws when the task is not found', async () => {
    h.prisma.campaignTrackerTask.findFirst.mockResolvedValueOnce(null)
    await expect(h.service.completeTask(caller, 'missing')).rejects.toThrow()
  })
})

describe('CampaignTrackerTasksService.unCompleteTask', () => {
  let h: ReturnType<typeof makeService>
  const caller = { id: 42 } as never
  beforeEach(() => {
    h = makeService()
  })

  it('clears completion and reverses the logged history', async () => {
    h.prisma.campaignTrackerTask.findFirst.mockResolvedValueOnce({
      id: 't1',
      completed: true,
      updateHistoryId: 99,
    })
    h.prisma.campaign.findUniqueOrThrow.mockResolvedValueOnce({
      id: 42,
      data: { reportedVoterGoals: { text: 5 } },
    })
    await h.service.unCompleteTask(caller, 't1')
    expect(h.prisma.campaignUpdateHistory.delete).toHaveBeenCalledWith({
      where: { id: 99 },
    })
    expect(h.prisma.campaignTrackerTask.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { completed: false, updateHistoryId: null },
    })
  })

  it('is idempotent when the task is not completed', async () => {
    h.prisma.campaignTrackerTask.findFirst.mockResolvedValueOnce({
      id: 't1',
      completed: false,
    })
    await h.service.unCompleteTask(caller, 't1')
    expect(h.prisma.campaignTrackerTask.update).not.toHaveBeenCalled()
  })
})
