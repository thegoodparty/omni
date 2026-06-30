import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { firstOrThrow } from 'src/shared/test-utils/arrays.util'
import { ExperimentRunStatus } from '../../../generated/prisma'
import { CampaignTrackerDispatchService } from './campaignTrackerDispatch.service'

const ENV = 'CAMPAIGN_TRACKER_AUTOMATION_ENABLED'

const makeService = () => {
  const prisma = { campaign: { findMany: vi.fn().mockResolvedValue([]) } }
  const cronLock = {
    tryClaimDailyRun: vi.fn().mockResolvedValue(true),
    markCompleted: vi.fn().mockResolvedValue(undefined),
  }
  const experimentRuns = { findFirst: vi.fn().mockResolvedValue(null) }
  const trackerTasks = {
    dispatchGeneration: vi.fn().mockResolvedValue(undefined),
    removeOutreachTasks: vi.fn().mockResolvedValue(0),
  }
  const service = new CampaignTrackerDispatchService(
    cronLock as never,
    experimentRuns as never,
    trackerTasks as never,
  )
  Object.defineProperty(service, '_prisma', { value: prisma })
  Object.assign(service, {
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  })
  return { service, prisma, cronLock, experimentRuns, trackerTasks }
}

const campaign = (over: Record<string, unknown> = {}) => ({
  id: 7,
  organizationSlug: 'org-7',
  // far-future election so the past-election guard passes
  details: { electionDate: '2026-12-31' },
  user: { clerkId: 'clk' },
  ...over,
})

describe('CampaignTrackerDispatchService.dispatchWeeklyRegen', () => {
  let h: ReturnType<typeof makeService>
  beforeEach(() => {
    h = makeService()
    process.env[ENV] = 'true'
  })
  afterEach(() => {
    delete process.env[ENV]
  })

  it('does nothing when automation is disabled', async () => {
    delete process.env[ENV]
    await h.service.dispatchWeeklyRegen()
    expect(h.cronLock.tryClaimDailyRun).not.toHaveBeenCalled()
    expect(h.prisma.campaign.findMany).not.toHaveBeenCalled()
  })

  it('bails when it cannot claim the daily run (another pod won)', async () => {
    h.cronLock.tryClaimDailyRun.mockResolvedValueOnce(false)
    await h.service.dispatchWeeklyRegen()
    expect(h.prisma.campaign.findMany).not.toHaveBeenCalled()
  })

  it('selects only active campaigns that already have tracker rows', async () => {
    await h.service.dispatchWeeklyRegen()
    expect(h.prisma.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          isDemo: false,
          campaignTrackerTasks: { some: {} },
        },
      }),
    )
    expect(h.cronLock.markCompleted).toHaveBeenCalled()
  })

  it('dispatches a weekly run for an eligible campaign with no recent run', async () => {
    h.prisma.campaign.findMany.mockResolvedValueOnce([campaign()])
    await h.service.dispatchWeeklyRegen()
    expect(h.trackerTasks.dispatchGeneration).toHaveBeenCalledTimes(1)
    expect(firstOrThrow(h.trackerTasks.dispatchGeneration.mock.calls)[1]).toBe(
      'weekly',
    )
  })

  it('removes outreach and skips generation when the primary was lost', async () => {
    h.prisma.campaign.findMany.mockResolvedValueOnce([
      campaign({ primaryResult: 'lost' }),
    ])
    await h.service.dispatchWeeklyRegen()
    expect(h.trackerTasks.removeOutreachTasks).toHaveBeenCalledWith(7)
    expect(h.trackerTasks.dispatchGeneration).not.toHaveBeenCalled()
  })

  it('skips a campaign whose election has already passed', async () => {
    h.prisma.campaign.findMany.mockResolvedValueOnce([
      campaign({ details: { electionDate: '2020-01-01' } }),
    ])
    await h.service.dispatchWeeklyRegen()
    expect(h.trackerTasks.dispatchGeneration).not.toHaveBeenCalled()
  })

  it('skips a campaign that already had a run this week (dedup)', async () => {
    h.prisma.campaign.findMany.mockResolvedValueOnce([campaign()])
    h.experimentRuns.findFirst.mockResolvedValueOnce({ runId: 'recent' })
    await h.service.dispatchWeeklyRegen()
    expect(h.trackerTasks.dispatchGeneration).not.toHaveBeenCalled()
  })

  it('ignores FAILED runs when deduping so a failed week retries', async () => {
    h.prisma.campaign.findMany.mockResolvedValueOnce([campaign()])
    await h.service.dispatchWeeklyRegen()
    expect(h.experimentRuns.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { not: ExperimentRunStatus.FAILED },
        }),
      }),
    )
  })

  it('keeps going if one campaign dispatch throws', async () => {
    h.prisma.campaign.findMany.mockResolvedValueOnce([
      campaign({ id: 1, organizationSlug: 'a' }),
      campaign({ id: 2, organizationSlug: 'b' }),
    ])
    h.trackerTasks.dispatchGeneration
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined)
    await h.service.dispatchWeeklyRegen()
    expect(h.trackerTasks.dispatchGeneration).toHaveBeenCalledTimes(2)
    expect(h.cronLock.markCompleted).toHaveBeenCalled()
  })
})
