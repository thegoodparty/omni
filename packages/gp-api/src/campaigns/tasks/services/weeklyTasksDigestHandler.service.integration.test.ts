import { addDays, addMilliseconds } from 'date-fns'
import { useTestService } from '@/test-service'
import {
  CENTRAL_TIMEZONE,
  nextMondayUtcMidnight,
} from '@/shared/util/date.util'
import { CampaignTaskType } from '../../../generated/prisma'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsService } from '@/analytics/analytics.service'
import { JobsService } from '@/jobs/jobs.service'
import { EVENTS } from '@/vendors/segment/segment.types'

// Every test runs the real weeklyTasksDigest schedule on the real pg-boss
// workers: the fan-out, then one weeklyTasksDigestCampaign job per campaign
// (src/jobs/AGENTS.md § Tests).
const service = useTestService({ jobs: true })

const FUTURE_ELECTION = '2027-11-03'
const PAST_ELECTION = '2020-01-01'

// The week the schedule picks when it runs now: Monday through Sunday.
let windowStart: Date
let windowEnd: Date
const day = (offset: number) => addDays(windowStart, offset)

beforeEach(() => {
  windowStart = nextMondayUtcMidnight(new Date(), CENTRAL_TIMEZONE)
  windowEnd = addDays(windowStart, 7)
})

type TrackSpy = ReturnType<typeof vi.spyOn>

function getTrackSpy(): TrackSpy {
  const analytics = service.app.get(AnalyticsService)
  return vi.spyOn(analytics, 'track').mockResolvedValue({} as never)
}

async function makeCampaign(
  opts: {
    electionDate?: string | null
    isActive?: boolean
  } = {},
) {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const user = await service.prisma.user.create({
    data: {
      email: `digest-${unique}@test.goodparty.org`,
      firstName: 'Test',
      lastName: 'User',
    },
  })
  const org = await service.prisma.organization.create({
    data: {
      slug: `digest-org-${unique}`,
      ownerId: user.id,
    },
  })
  // `null` = omit the key entirely; any string (including '') = use as-is;
  // `undefined` (not provided) = use the default future election date.
  const details =
    opts.electionDate === null
      ? {}
      : opts.electionDate !== undefined
        ? { electionDate: opts.electionDate }
        : { electionDate: FUTURE_ELECTION }
  return service.prisma.campaign.create({
    data: {
      userId: user.id,
      slug: `digest-${unique}`,
      details,
      organizationSlug: org.slug,
      isActive: opts.isActive ?? true,
    },
  })
}

async function makeTask(
  campaignId: number,
  overrides: {
    date?: Date
    completed?: boolean
    flowType?: CampaignTaskType
    title?: string
    description?: string
    week?: number
    isDefaultTask?: boolean
  } = {},
) {
  return service.prisma.campaignTrackerTask.create({
    data: {
      campaignId,
      title: overrides.title ?? 'Task',
      description: overrides.description ?? 'A task',
      flowType: overrides.flowType ?? CampaignTaskType.education,
      week: overrides.week ?? 10,
      date: overrides.date ?? day(2),
      completed: overrides.completed ?? false,
      isDefaultTask: overrides.isDefaultTask ?? false,
    },
  })
}

const runDigest = () => service.jobs.runSchedule('weeklyTasksDigest')

describe('the weeklyTasksDigest schedule', () => {
  describe('campaign eligibility', () => {
    it('excludes campaigns with a past election date', async () => {
      const campaign = await makeCampaign({ electionDate: PAST_ELECTION })
      for (let i = 0; i < 5; i++) await makeTask(campaign.id)
      const trackSpy = getTrackSpy()

      await runDigest()

      expect(trackSpy).not.toHaveBeenCalled()
    })

    it('excludes campaigns with no electionDate in details', async () => {
      const campaign = await makeCampaign({ electionDate: null })
      for (let i = 0; i < 5; i++) await makeTask(campaign.id)
      const trackSpy = getTrackSpy()

      await runDigest()

      expect(trackSpy).not.toHaveBeenCalled()
    })

    it('excludes inactive campaigns so churned candidates are not emailed', async () => {
      const campaign = await makeCampaign({ isActive: false })
      for (let i = 0; i < 5; i++) await makeTask(campaign.id)
      const trackSpy = getTrackSpy()

      await runDigest()

      expect(trackSpy).not.toHaveBeenCalled()
    })

    it('skips (does not crash) when electionDate is an empty string or malformed', async () => {
      const emptyCampaign = await makeCampaign({ electionDate: '' })
      const malformedCampaign = await makeCampaign({ electionDate: 'TBD' })
      const validCampaign = await makeCampaign()
      for (let i = 0; i < 5; i++) await makeTask(emptyCampaign.id)
      for (let i = 0; i < 5; i++) await makeTask(malformedCampaign.id)
      for (let i = 0; i < 3; i++) await makeTask(validCampaign.id)

      const trackSpy = getTrackSpy()

      await runDigest()

      // The valid campaign still fires; the bad rows are silently filtered by the SQL regex.
      expect(trackSpy).toHaveBeenCalledOnce()
      expect(trackSpy).toHaveBeenCalledWith(
        validCampaign.userId,
        expect.any(String),
        expect.any(Object),
        undefined,
        expect.any(String),
      )
    })

    it('excludes campaigns with fewer than 3 incomplete tasks in window', async () => {
      const campaign = await makeCampaign()
      await makeTask(campaign.id)
      await makeTask(campaign.id)
      const trackSpy = getTrackSpy()

      await runDigest()

      expect(trackSpy).not.toHaveBeenCalled()
    })

    it('includes campaigns with exactly 3 incomplete tasks', async () => {
      const campaign = await makeCampaign()
      await makeTask(campaign.id)
      await makeTask(campaign.id)
      await makeTask(campaign.id)
      const trackSpy = getTrackSpy()

      await runDigest()

      expect(trackSpy).toHaveBeenCalledOnce()
    })

    it('does not count completed tasks toward the MIN_TASKS threshold', async () => {
      const campaign = await makeCampaign()
      await makeTask(campaign.id, { completed: true })
      await makeTask(campaign.id, { completed: true })
      await makeTask(campaign.id) // only 1 incomplete
      await makeTask(campaign.id) // 2 incomplete
      const trackSpy = getTrackSpy()

      await runDigest()

      expect(trackSpy).not.toHaveBeenCalled()
    })
  })

  describe('task selection', () => {
    it('returns exactly 3 tasks when a campaign has more than 3 incomplete', async () => {
      const campaign = await makeCampaign()
      for (let i = 0; i < 8; i++) {
        await makeTask(campaign.id, { title: `Task ${i}` })
      }
      const trackSpy = getTrackSpy()

      await runDigest()

      const [, , properties] = trackSpy.mock.calls[0] as [
        number,
        string,
        Record<string, unknown>,
      ]
      // Top 3 surfaced; the event still carries 5 slots (slots 4-5 blank) so
      // HubSpot clears stale data — no change needed on the email side.
      expect(properties.task_name_3).not.toBe('')
      expect(properties.task_name_4).toBe('')
      expect(properties.task_name_5).toBe('')
      // plan_total_tasks still reflects the real incomplete count, not the cap
      expect(properties.plan_total_tasks).toBe(8)
    })

    it('counts only the latest dynamic generation, not stale prior generations', async () => {
      const campaign = await makeCampaign()
      // Weekly regen appends generations; a prior generation's rows stay in the
      // table. Only the latest (highest week) should count — not both.
      for (let i = 0; i < 3; i++) {
        await makeTask(campaign.id, { title: `Old ${i}`, week: 1 })
      }
      for (let i = 0; i < 3; i++) {
        await makeTask(campaign.id, { title: `New ${i}`, week: 2 })
      }
      const trackSpy = getTrackSpy()

      await runDigest()

      const [, , properties] = trackSpy.mock.calls[0] as [
        number,
        string,
        Record<string, unknown>,
      ]
      // 3 latest-generation tasks, not 6 — the stale week-1 rows are excluded.
      expect(properties.plan_total_tasks).toBe(3)
      expect(properties.task_name_1).toContain('New')
      expect(properties.task_name_2).toContain('New')
      expect(properties.task_name_3).toContain('New')
    })

    it('prioritizes outreach task types (text, robocall, doorKnocking, phoneBanking) over others', async () => {
      const campaign = await makeCampaign()
      // 2 non-outreach + 2 outreach, all same date so only outreach priority matters
      const sameDate = day(2)
      await makeTask(campaign.id, {
        title: 'Education Task',
        flowType: CampaignTaskType.education,
        date: sameDate,
      })
      await makeTask(campaign.id, {
        title: 'Social Media Task',
        flowType: CampaignTaskType.socialMedia,
        date: sameDate,
      })
      await makeTask(campaign.id, {
        title: 'Text Task',
        flowType: CampaignTaskType.text,
        date: sameDate,
      })
      await makeTask(campaign.id, {
        title: 'Door Knocking Task',
        flowType: CampaignTaskType.doorKnocking,
        date: sameDate,
      })
      const trackSpy = getTrackSpy()

      await runDigest()

      const [, , properties] = trackSpy.mock.calls[0] as [
        number,
        string,
        Record<string, unknown>,
      ]
      // First two slots should be the outreach tasks
      const slot1And2 = [properties.task_name_1, properties.task_name_2]
      expect(slot1And2).toContain('Text Task')
      expect(slot1And2).toContain('Door Knocking Task')
    })

    it('prioritizes robocall and phoneBanking as outreach types', async () => {
      const campaign = await makeCampaign()
      const sameDate = day(2)
      await makeTask(campaign.id, {
        title: 'Education Task',
        flowType: CampaignTaskType.education,
        date: sameDate,
      })
      await makeTask(campaign.id, {
        title: 'Events Task',
        flowType: CampaignTaskType.events,
        date: sameDate,
      })
      await makeTask(campaign.id, {
        title: 'Robocall Task',
        flowType: CampaignTaskType.robocall,
        date: sameDate,
      })
      await makeTask(campaign.id, {
        title: 'Phone Banking Task',
        flowType: CampaignTaskType.phoneBanking,
        date: sameDate,
      })
      const trackSpy = getTrackSpy()

      await runDigest()

      const [, , properties] = trackSpy.mock.calls[0] as [
        number,
        string,
        Record<string, unknown>,
      ]
      const slot1And2 = [properties.task_name_1, properties.task_name_2]
      expect(slot1And2).toContain('Robocall Task')
      expect(slot1And2).toContain('Phone Banking Task')
    })

    it('orders tasks by date within the same priority category', async () => {
      const campaign = await makeCampaign()
      // All outreach, different dates
      await makeTask(campaign.id, {
        title: 'Friday Task',
        flowType: CampaignTaskType.text,
        date: day(4),
      })
      await makeTask(campaign.id, {
        title: 'Monday Task',
        flowType: CampaignTaskType.text,
        date: day(0),
      })
      await makeTask(campaign.id, {
        title: 'Wednesday Task',
        flowType: CampaignTaskType.text,
        date: day(2),
      })
      const trackSpy = getTrackSpy()

      await runDigest()

      const [, , properties] = trackSpy.mock.calls[0] as [
        number,
        string,
        Record<string, unknown>,
      ]
      expect(properties.task_name_1).toBe('Monday Task')
      expect(properties.task_name_2).toBe('Wednesday Task')
      expect(properties.task_name_3).toBe('Friday Task')
    })

    it('does not include completed tasks in the slots', async () => {
      const campaign = await makeCampaign()
      await makeTask(campaign.id, { title: 'Completed', completed: true })
      await makeTask(campaign.id, { title: 'Incomplete 1' })
      await makeTask(campaign.id, { title: 'Incomplete 2' })
      await makeTask(campaign.id, { title: 'Incomplete 3' })
      const trackSpy = getTrackSpy()

      await runDigest()

      const [, , properties] = trackSpy.mock.calls[0] as [
        number,
        string,
        Record<string, unknown>,
      ]
      const taskNames = [
        properties.task_name_1,
        properties.task_name_2,
        properties.task_name_3,
      ]
      expect(taskNames).not.toContain('Completed')
    })
  })

  describe('dynamic + deterministic outreach selection (tracker cohort)', () => {
    it('includes the deterministic text/robocall outreach dated in the window and ranks it above the dynamic picks', async () => {
      const campaign = await makeCampaign()
      // Latest dynamic generation: 3 agent-picked rows.
      for (let i = 0; i < 3; i++) {
        await makeTask(campaign.id, {
          title: `Dynamic ${i}`,
          flowType: CampaignTaskType.education,
          week: 10,
        })
      }
      // Deterministic outreach (default row) dated in the window. It is what the
      // tracker's week view shows alongside the dynamic tasks, so it belongs in
      // the digest, and as an outreach type it ranks ahead of the dynamic picks.
      await makeTask(campaign.id, {
        title: 'Intro Text',
        flowType: CampaignTaskType.text,
        week: 10,
        isDefaultTask: true,
        date: day(1),
      })
      const trackSpy = getTrackSpy()

      await runDigest()

      expect(trackSpy).toHaveBeenCalledOnce()
      const [, , properties] = trackSpy.mock.calls[0] as [
        number,
        string,
        Record<string, unknown>,
      ]
      // 3 dynamic + 1 outreach all count; the outreach leads.
      expect(properties.plan_total_tasks).toBe(4)
      expect(properties.task_name_1).toBe('Intro Text')
    })

    it('excludes the static setup checklist (non-outreach default rows), even when their week equals the latest generation', async () => {
      const campaign = await makeCampaign()
      for (let i = 0; i < 3; i++) {
        await makeTask(campaign.id, {
          title: `Dynamic ${i}`,
          flowType: CampaignTaskType.education,
          week: 10,
        })
      }
      // A setup-checklist default row whose calendar-offset week coincidentally
      // equals the latest generation index. Not an outreach type, so it must be
      // excluded: a strong check that the dynamic branch guards on
      // is_default_task = false and the default branch only admits outreach.
      await makeTask(campaign.id, {
        title: 'Setup Checklist',
        flowType: CampaignTaskType.education,
        week: 10,
        isDefaultTask: true,
      })
      const trackSpy = getTrackSpy()

      await runDigest()

      expect(trackSpy).toHaveBeenCalledOnce()
      const [, , properties] = trackSpy.mock.calls[0] as [
        number,
        string,
        Record<string, unknown>,
      ]
      expect(properties.plan_total_tasks).toBe(3)
      const names = [
        properties.task_name_1,
        properties.task_name_2,
        properties.task_name_3,
      ]
      expect(names).not.toContain('Setup Checklist')
    })

    it('leaves out text sends once texting is closed for the race', async () => {
      // Texting closes 19 days before the general election.
      const closedElection = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10)
      const campaign = await makeCampaign({ electionDate: closedElection })
      for (let i = 0; i < 3; i++) {
        await makeTask(campaign.id, {
          title: `Dynamic ${i}`,
          flowType: CampaignTaskType.education,
          week: 10,
        })
      }
      await makeTask(campaign.id, {
        title: 'Intro Text',
        flowType: CampaignTaskType.text,
        week: 10,
        isDefaultTask: true,
        date: day(1),
      })
      await makeTask(campaign.id, {
        title: 'Intro Robocall',
        flowType: CampaignTaskType.robocall,
        week: 10,
        isDefaultTask: true,
        date: day(2),
      })
      const trackSpy = getTrackSpy()

      await runDigest()

      expect(trackSpy).toHaveBeenCalledOnce()
      const [, , properties] = trackSpy.mock.calls[0] as [
        number,
        string,
        Record<string, unknown>,
      ]
      expect(properties.plan_total_tasks).toBe(4)
      expect(properties.task_name_1).toBe('Intro Robocall')
      expect([
        properties.task_name_1,
        properties.task_name_2,
        properties.task_name_3,
      ]).not.toContain('Intro Text')
    })

    it('does not send a tracker digest when a campaign has only non-outreach default rows and no dynamic generation', async () => {
      const campaign = await makeCampaign()
      // Setup checklist materialized eagerly, but no dynamic generation and no
      // outreach dated in the window, so there is nothing to email yet.
      for (let i = 0; i < 5; i++) {
        await makeTask(campaign.id, {
          title: `Setup ${i}`,
          flowType: CampaignTaskType.education,
          isDefaultTask: true,
        })
      }
      const trackSpy = getTrackSpy()

      await runDigest()

      expect(trackSpy).not.toHaveBeenCalled()
    })
  })

  describe('date window bounds', () => {
    it('includes tasks dated exactly at windowStart (Monday 00:00)', async () => {
      const campaign = await makeCampaign()
      await makeTask(campaign.id, {
        title: 'Monday 00:00 Task',
        date: windowStart,
      })
      await makeTask(campaign.id)
      await makeTask(campaign.id)
      const trackSpy = getTrackSpy()

      await runDigest()

      expect(trackSpy).toHaveBeenCalledOnce()
      const [, , properties] = trackSpy.mock.calls[0] as [
        number,
        string,
        Record<string, unknown>,
      ]
      const titles = [
        properties.task_name_1,
        properties.task_name_2,
        properties.task_name_3,
      ]
      expect(titles).toContain('Monday 00:00 Task')
    })

    it('includes tasks dated Sunday 23:59:59.999', async () => {
      const campaign = await makeCampaign()
      await makeTask(campaign.id, {
        title: 'Sunday Late Task',
        date: addMilliseconds(windowEnd, -1),
      })
      await makeTask(campaign.id)
      await makeTask(campaign.id)
      const trackSpy = getTrackSpy()

      await runDigest()

      expect(trackSpy).toHaveBeenCalledOnce()
      const [, , properties] = trackSpy.mock.calls[0] as [
        number,
        string,
        Record<string, unknown>,
      ]
      const titles = [
        properties.task_name_1,
        properties.task_name_2,
        properties.task_name_3,
      ]
      expect(titles).toContain('Sunday Late Task')
    })

    it('excludes tasks dated exactly at windowEnd (next Monday 00:00)', async () => {
      const campaign = await makeCampaign()
      await makeTask(campaign.id, {
        title: 'Next Monday Task',
        date: windowEnd,
      })
      await makeTask(campaign.id)
      await makeTask(campaign.id)
      const trackSpy = getTrackSpy()

      await runDigest()

      // Only 2 tasks in window (the 3rd is outside), below MIN_TASKS → not eligible
      expect(trackSpy).not.toHaveBeenCalled()
    })

    it('excludes tasks dated before windowStart (Sunday before)', async () => {
      const campaign = await makeCampaign()
      await makeTask(campaign.id, {
        title: 'Sunday Before',
        date: addMilliseconds(windowStart, -1),
      })
      await makeTask(campaign.id)
      await makeTask(campaign.id)
      const trackSpy = getTrackSpy()

      await runDigest()

      // Only 2 tasks in window → not eligible
      expect(trackSpy).not.toHaveBeenCalled()
    })
  })

  describe('event payload', () => {
    it('reports completed and total task counts correctly', async () => {
      const campaign = await makeCampaign()
      await makeTask(campaign.id, { completed: true })
      await makeTask(campaign.id, { completed: true })
      await makeTask(campaign.id)
      await makeTask(campaign.id)
      await makeTask(campaign.id)
      const trackSpy = getTrackSpy()

      await runDigest()

      const [, , properties] = trackSpy.mock.calls[0] as [
        number,
        string,
        Record<string, unknown>,
      ]
      expect(properties.plan_tasks_completed).toBe(2)
      expect(properties.plan_total_tasks).toBe(5)
    })

    it('emits all 5 task slots with blank values when fewer than 5 tasks exist', async () => {
      const campaign = await makeCampaign()
      await makeTask(campaign.id, { title: 'T1' })
      await makeTask(campaign.id, { title: 'T2' })
      await makeTask(campaign.id, { title: 'T3' })
      const trackSpy = getTrackSpy()

      await runDigest()

      const [, , properties] = trackSpy.mock.calls[0] as [
        number,
        string,
        Record<string, unknown>,
      ]
      expect(properties.task_name_4).toBe('')
      expect(properties.task_description_4).toBe('')
      expect(properties.task_type_4).toBe('')
      expect(properties.task_due_date_4).toBe('')
      expect(properties.task_week_number_4).toBe(null)
      expect(properties.task_name_5).toBe('')
      expect(properties.task_week_number_5).toBe(null)
    })

    it('uses the correct event name', async () => {
      const campaign = await makeCampaign()
      await makeTask(campaign.id)
      await makeTask(campaign.id)
      await makeTask(campaign.id)
      const trackSpy = getTrackSpy()

      await runDigest()

      expect(trackSpy).toHaveBeenCalledWith(
        campaign.userId,
        EVENTS.CampaignPlan.WeeklyTasksDigest,
        expect.any(Object),
        undefined,
        expect.any(String),
      )
    })
  })

  describe('multiple campaigns', () => {
    it('fires one event per eligible campaign', async () => {
      const c1 = await makeCampaign()
      const c2 = await makeCampaign()
      const c3Ineligible = await makeCampaign({ electionDate: PAST_ELECTION })

      for (let i = 0; i < 3; i++) await makeTask(c1.id)
      for (let i = 0; i < 3; i++) await makeTask(c2.id)
      for (let i = 0; i < 5; i++) await makeTask(c3Ineligible.id)

      const trackSpy = getTrackSpy()

      await runDigest()

      expect(trackSpy).toHaveBeenCalledTimes(2)
      const userIds = trackSpy.mock.calls
        .map((call: Parameters<AnalyticsService['track']>) => call[0])
        .sort()
      expect(userIds).toEqual([c1.userId, c2.userId].sort())
    })

    it("sends each campaign once per week: the queue drops a repeat run's jobs, and Segment drops a later one by messageId", async () => {
      const c1 = await makeCampaign()
      const c2 = await makeCampaign()
      for (const campaign of [c1, c2]) {
        for (let i = 0; i < 3; i++) await makeTask(campaign.id)
      }
      const trackSpy = getTrackSpy()
      const messageIdsFor = (userId: number) =>
        trackSpy.mock.calls
          .filter(
            ([id]: Parameters<AnalyticsService['track']>) => id === userId,
          )
          .map((call: Parameters<AnalyticsService['track']>) => call[4])

      // While the first run's jobs still exist, a second run adds none.
      await runDigest()
      await runDigest()
      for (const campaign of [c1, c2]) {
        expect(messageIdsFor(campaign.userId)).toHaveLength(1)
      }

      // Once pg-boss has deleted the finished jobs (a minute later in
      // production), a re-run sends again, with the same messageId, which
      // Segment uses to drop the repeat.
      await service.prisma.$executeRaw`
        DELETE FROM pgboss.job WHERE name = 'weeklyTasksDigestCampaign'`
      await runDigest()
      for (const campaign of [c1, c2]) {
        const messageIds = messageIdsFor(campaign.userId)
        expect(messageIds).toHaveLength(2)
        expect(new Set(messageIds).size).toBe(1)
      }
    })

    it('retries a campaign whose Segment call fails, dead-letters it, and still sends the others', async () => {
      const failing = await makeCampaign()
      const other = await makeCampaign()
      for (const campaign of [failing, other]) {
        for (let i = 0; i < 3; i++) await makeTask(campaign.id)
      }
      const trackSpy = vi
        .spyOn(service.app.get(AnalyticsService), 'track')
        .mockImplementation(async (userId, event) => {
          if (userId === failing.userId) throw new Error('Segment down')
          return { event, userId: String(userId) }
        })

      const { deadLetters } = await service.jobs.runSchedule(
        'weeklyTasksDigest',
        { allowDeadLetters: true },
      )

      expect(deadLetters).toEqual([
        {
          name: 'weeklyTasksDigestCampaign',
          data: {
            campaignId: failing.id,
            windowStart: windowStart.toISOString(),
            windowEnd: windowEnd.toISOString(),
          },
          error: 'Segment down',
        },
      ])
      const userIds = trackSpy.mock.calls.map(([userId]) => userId)
      expect(userIds.filter((id) => id === failing.userId)).toHaveLength(3)
      expect(userIds.filter((id) => id === other.userId)).toHaveLength(1)
    })
  })

  describe('a campaign job that runs after its campaign stopped qualifying', () => {
    it('sends nothing', async () => {
      const campaign = await makeCampaign({ isActive: false })
      for (let i = 0; i < 3; i++) await makeTask(campaign.id)
      const trackSpy = getTrackSpy()
      // The job the fan-out sent while the campaign still qualified.
      await service.app.get(JobsService).send('weeklyTasksDigestCampaign', {
        campaignId: campaign.id,
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
      })

      await service.jobs.settle()

      expect(trackSpy).not.toHaveBeenCalled()
    })
  })

  describe('the week it covers', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    // The cron fires Monday 04:00 UTC: Sunday night Central.
    it.each([
      ['Sunday 11 PM Central', '2026-04-20T04:00:00.000Z', '2026-04-20'],
      ['Sunday 11:59 PM Central', '2026-04-20T04:59:00.000Z', '2026-04-20'],
      ['Saturday 11 PM Central', '2026-04-19T04:00:00.000Z', '2026-04-20'],
      [
        'Sunday 11 PM Central standard time',
        '2026-01-05T05:00:00.000Z',
        '2026-01-05',
      ],
    ])('run %s, covers the Monday %s week', async (_label, now, monday) => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date(now) })
      const start = new Date(`${monday}T00:00:00.000Z`)
      const campaign = await makeCampaign()
      await makeTask(campaign.id, {
        title: 'Before',
        date: addMilliseconds(start, -1),
      })
      await makeTask(campaign.id, { title: 'First', date: start })
      await makeTask(campaign.id, { title: 'Middle', date: addDays(start, 3) })
      await makeTask(campaign.id, {
        title: 'Last',
        date: addMilliseconds(addDays(start, 7), -1),
      })
      await makeTask(campaign.id, { title: 'After', date: addDays(start, 7) })
      const trackSpy = getTrackSpy()

      await runDigest()

      expect(trackSpy).toHaveBeenCalledOnce()
      const [, , properties] = trackSpy.mock.calls[0] as [
        number,
        string,
        Record<string, unknown>,
      ]
      expect(properties.plan_total_tasks).toBe(3)
      expect([
        properties.task_name_1,
        properties.task_name_2,
        properties.task_name_3,
      ]).toEqual(['First', 'Middle', 'Last'])
    })
  })
})
