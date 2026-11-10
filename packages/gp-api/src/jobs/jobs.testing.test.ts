import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { addDays } from 'date-fns'
import { describe, expect, it, vi } from 'vitest'
import { AnalyticsService } from '@/analytics/analytics.service'
import { CampaignTaskType } from '@/generated/prisma'
import {
  CENTRAL_TIMEZONE,
  nextMondayUtcMidnight,
} from '@/shared/util/date.util'
import { useTestService } from '@/test-service'
import { JobsService } from './jobs.service'

// The test utilities on useTestService({ jobs: true }): settle() and
// runSchedule(). The weekly tasks digest is the job they drive, because its
// outcome is one Segment event per campaign.
const service = useTestService({ jobs: true })

const TRACKED = { event: 'tracked', userId: 'tracked' }

const windowStart = () => nextMondayUtcMidnight(new Date(), CENTRAL_TIMEZONE)

const makeDigestCampaign = async () => {
  const unique = randomUUID()
  const user = await service.prisma.user.create({
    data: { email: `jobs-${unique}@test.goodparty.org` },
  })
  const org = await service.prisma.organization.create({
    data: { slug: `jobs-org-${unique}`, ownerId: user.id },
  })
  const campaign = await service.prisma.campaign.create({
    data: {
      userId: user.id,
      slug: `jobs-${unique}`,
      details: { electionDate: '2099-11-03' },
      organizationSlug: org.slug,
      isActive: true,
    },
  })
  for (let i = 0; i < 3; i++) {
    await service.prisma.campaignTrackerTask.create({
      data: {
        campaignId: campaign.id,
        title: `Task ${i}`,
        description: 'A task',
        flowType: CampaignTaskType.education,
        week: 10,
        date: addDays(windowStart(), 2),
      },
    })
  }
  return campaign
}

const sendDigestJob = (campaignId: number) =>
  service.app.get(JobsService).send('weeklyTasksDigestCampaign', {
    campaignId,
    windowStart: windowStart().toISOString(),
    windowEnd: addDays(windowStart(), 7).toISOString(),
  })

describe('service.jobs', () => {
  it('runs a schedule and its fan-out to completion', async () => {
    const first = await makeDigestCampaign()
    const second = await makeDigestCampaign()
    const track = vi
      .spyOn(service.app.get(AnalyticsService), 'track')
      .mockResolvedValue(TRACKED)

    expect(await service.jobs.runSchedule('weeklyTasksDigest')).toEqual({
      deadLetters: [],
    })

    expect(track.mock.calls.map(([userId]) => userId).sort()).toEqual(
      [first.userId, second.userId].sort(),
    )
  })

  it('throws naming a job that dead-lettered, after every attempt', async () => {
    const campaign = await makeDigestCampaign()
    const track = vi
      .spyOn(service.app.get(AnalyticsService), 'track')
      .mockRejectedValue(new Error('Segment down'))
    await sendDigestJob(campaign.id)

    await expect(service.jobs.settle()).rejects.toThrow(
      new RegExp(
        '- weeklyTasksDigestCampaign \\{.*' +
          `"campaignId":${campaign.id},.*\\}: Segment down`,
      ),
    )
    expect(track).toHaveBeenCalledTimes(3)
  })

  it('returns dead letters when the test expects them', async () => {
    const campaign = await makeDigestCampaign()
    vi.spyOn(service.app.get(AnalyticsService), 'track').mockRejectedValue(
      new Error('Segment down'),
    )
    await sendDigestJob(campaign.id)

    expect(await service.jobs.settle({ allowDeadLetters: true })).toEqual({
      deadLetters: [
        {
          name: 'weeklyTasksDigestCampaign',
          data: expect.objectContaining({ campaignId: campaign.id }),
          error: 'Segment down',
        },
      ],
    })
  })

  // Runs after the dead-letter tests, so it also shows their dead letters
  // do not reach a later test's settle().
  it('waits for a sent job to finish', async () => {
    const campaign = await makeDigestCampaign()
    let sent = false
    vi.spyOn(service.app.get(AnalyticsService), 'track').mockImplementation(
      async () => {
        await sleep(500)
        sent = true
        return TRACKED
      },
    )
    await sendDigestJob(campaign.id)

    expect(await service.jobs.settle()).toEqual({ deadLetters: [] })
    expect(sent).toBe(true)
  })

  it('throws naming the unfinished job when it times out', async () => {
    const campaign = await makeDigestCampaign()
    vi.spyOn(service.app.get(AnalyticsService), 'track').mockImplementation(
      () => sleep(1500, TRACKED),
    )
    await sendDigestJob(campaign.id)

    const timedOut = service.jobs.settle({ timeoutMs: 200 })
    await expect(timedOut).rejects.toThrow('unfinished after 200ms')
    await expect(timedOut).rejects.toThrow(
      /- weeklyTasksDigestCampaign \((created|active)\)/,
    )
    await service.jobs.settle()
  })
})
