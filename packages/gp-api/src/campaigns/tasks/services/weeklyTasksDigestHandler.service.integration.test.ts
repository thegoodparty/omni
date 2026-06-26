import { useTestService } from '@/test-service'
import { CampaignTaskType } from '../../../generated/prisma'
import { describe, expect, it, vi } from 'vitest'
import { AnalyticsService } from '@/analytics/analytics.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { WeeklyTasksDigestHandlerService } from './weeklyTasksDigestHandler.service'

const service = useTestService()

const WINDOW_START = '2026-04-20T00:00:00.000Z' // Monday
const WINDOW_END = '2026-04-27T00:00:00.000Z' // Following Monday (exclusive)
const FUTURE_ELECTION = '2027-11-03'
const PAST_ELECTION = '2020-01-01'

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
  } = {},
) {
  return service.prisma.campaignTrackerTask.create({
    data: {
      campaignId,
      title: overrides.title ?? 'Task',
      description: overrides.description ?? 'A task',
      flowType: overrides.flowType ?? CampaignTaskType.education,
      week: overrides.week ?? 10,
      date: overrides.date ?? new Date('2026-04-22T00:00:00.000Z'),
      completed: overrides.completed ?? false,
    },
  })
}

// Legacy (pre-v3) campaign_task rows — the cohort that never went through
// campaign story and so never bootstrapped the tracker.
async function makeLegacyTask(
  campaignId: number,
  overrides: {
    date?: Date
    completed?: boolean
    flowType?: CampaignTaskType
    title?: string
    description?: string
    week?: number
  } = {},
) {
  return service.prisma.campaignTask.create({
    data: {
      campaignId,
      title: overrides.title ?? 'Legacy Task',
      description: overrides.description ?? 'A legacy task',
      flowType: overrides.flowType ?? CampaignTaskType.education,
      week: overrides.week ?? 10,
      date: overrides.date ?? new Date('2026-04-22T00:00:00.000Z'),
      completed: overrides.completed ?? false,
    },
  })
}

describe('WeeklyTasksDigestHandlerService integration', () => {
  describe('campaign eligibility', () => {
    it('excludes campaigns with a past election date', async () => {
      const campaign = await makeCampaign({ electionDate: PAST_ELECTION })
      for (let i = 0; i < 5; i++) await makeTask(campaign.id)
      const trackSpy = getTrackSpy()

      const handler = service.app.get(WeeklyTasksDigestHandlerService)
      await handler.handleWeeklyTasksDigest({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      })

      expect(trackSpy).not.toHaveBeenCalled()
    })

    it('excludes campaigns with no electionDate in details', async () => {
      const campaign = await makeCampaign({ electionDate: null })
      for (let i = 0; i < 5; i++) await makeTask(campaign.id)
      const trackSpy = getTrackSpy()

      const handler = service.app.get(WeeklyTasksDigestHandlerService)
      await handler.handleWeeklyTasksDigest({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      })

      expect(trackSpy).not.toHaveBeenCalled()
    })

    it('excludes inactive campaigns so churned candidates are not emailed', async () => {
      const campaign = await makeCampaign({ isActive: false })
      for (let i = 0; i < 5; i++) await makeTask(campaign.id)
      const trackSpy = getTrackSpy()

      const handler = service.app.get(WeeklyTasksDigestHandlerService)
      await handler.handleWeeklyTasksDigest({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      })

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

      const handler = service.app.get(WeeklyTasksDigestHandlerService)
      await handler.handleWeeklyTasksDigest({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      })

      // The valid campaign still fires; the bad rows are silently filtered by the SQL regex.
      expect(trackSpy).toHaveBeenCalledOnce()
      expect(trackSpy).toHaveBeenCalledWith(
        validCampaign.userId,
        expect.any(String),
        expect.any(Object),
      )
    })

    it('excludes campaigns with fewer than 3 incomplete tasks in window', async () => {
      const campaign = await makeCampaign()
      await makeTask(campaign.id)
      await makeTask(campaign.id)
      const trackSpy = getTrackSpy()

      const handler = service.app.get(WeeklyTasksDigestHandlerService)
      await handler.handleWeeklyTasksDigest({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      })

      expect(trackSpy).not.toHaveBeenCalled()
    })

    it('includes campaigns with exactly 3 incomplete tasks', async () => {
      const campaign = await makeCampaign()
      await makeTask(campaign.id)
      await makeTask(campaign.id)
      await makeTask(campaign.id)
      const trackSpy = getTrackSpy()

      const handler = service.app.get(WeeklyTasksDigestHandlerService)
      await handler.handleWeeklyTasksDigest({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      })

      expect(trackSpy).toHaveBeenCalledOnce()
    })

    it('does not count completed tasks toward the MIN_TASKS threshold', async () => {
      const campaign = await makeCampaign()
      await makeTask(campaign.id, { completed: true })
      await makeTask(campaign.id, { completed: true })
      await makeTask(campaign.id) // only 1 incomplete
      await makeTask(campaign.id) // 2 incomplete
      const trackSpy = getTrackSpy()

      const handler = service.app.get(WeeklyTasksDigestHandlerService)
      await handler.handleWeeklyTasksDigest({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      })

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

      const handler = service.app.get(WeeklyTasksDigestHandlerService)
      await handler.handleWeeklyTasksDigest({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      })

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

      const handler = service.app.get(WeeklyTasksDigestHandlerService)
      await handler.handleWeeklyTasksDigest({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      })

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
      const sameDate = new Date('2026-04-22T00:00:00.000Z')
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

      const handler = service.app.get(WeeklyTasksDigestHandlerService)
      await handler.handleWeeklyTasksDigest({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      })

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
      const sameDate = new Date('2026-04-22T00:00:00.000Z')
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

      const handler = service.app.get(WeeklyTasksDigestHandlerService)
      await handler.handleWeeklyTasksDigest({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      })

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
        date: new Date('2026-04-24T00:00:00.000Z'),
      })
      await makeTask(campaign.id, {
        title: 'Monday Task',
        flowType: CampaignTaskType.text,
        date: new Date('2026-04-20T00:00:00.000Z'),
      })
      await makeTask(campaign.id, {
        title: 'Wednesday Task',
        flowType: CampaignTaskType.text,
        date: new Date('2026-04-22T00:00:00.000Z'),
      })
      const trackSpy = getTrackSpy()

      const handler = service.app.get(WeeklyTasksDigestHandlerService)
      await handler.handleWeeklyTasksDigest({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      })

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

      const handler = service.app.get(WeeklyTasksDigestHandlerService)
      await handler.handleWeeklyTasksDigest({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      })

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

  describe('date window bounds', () => {
    it('includes tasks dated exactly at windowStart (Monday 00:00)', async () => {
      const campaign = await makeCampaign()
      await makeTask(campaign.id, {
        title: 'Monday 00:00 Task',
        date: new Date('2026-04-20T00:00:00.000Z'),
      })
      await makeTask(campaign.id)
      await makeTask(campaign.id)
      const trackSpy = getTrackSpy()

      const handler = service.app.get(WeeklyTasksDigestHandlerService)
      await handler.handleWeeklyTasksDigest({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      })

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
        date: new Date('2026-04-26T23:59:59.999Z'),
      })
      await makeTask(campaign.id)
      await makeTask(campaign.id)
      const trackSpy = getTrackSpy()

      const handler = service.app.get(WeeklyTasksDigestHandlerService)
      await handler.handleWeeklyTasksDigest({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      })

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
        date: new Date('2026-04-27T00:00:00.000Z'),
      })
      await makeTask(campaign.id)
      await makeTask(campaign.id)
      const trackSpy = getTrackSpy()

      const handler = service.app.get(WeeklyTasksDigestHandlerService)
      await handler.handleWeeklyTasksDigest({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      })

      // Only 2 tasks in window (the 3rd is outside), below MIN_TASKS → not eligible
      expect(trackSpy).not.toHaveBeenCalled()
    })

    it('excludes tasks dated before windowStart (Sunday before)', async () => {
      const campaign = await makeCampaign()
      await makeTask(campaign.id, {
        title: 'Sunday Before',
        date: new Date('2026-04-19T23:59:59.999Z'),
      })
      await makeTask(campaign.id)
      await makeTask(campaign.id)
      const trackSpy = getTrackSpy()

      const handler = service.app.get(WeeklyTasksDigestHandlerService)
      await handler.handleWeeklyTasksDigest({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      })

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

      const handler = service.app.get(WeeklyTasksDigestHandlerService)
      await handler.handleWeeklyTasksDigest({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      })

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

      const handler = service.app.get(WeeklyTasksDigestHandlerService)
      await handler.handleWeeklyTasksDigest({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      })

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

      const handler = service.app.get(WeeklyTasksDigestHandlerService)
      await handler.handleWeeklyTasksDigest({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      })

      expect(trackSpy).toHaveBeenCalledWith(
        campaign.userId,
        EVENTS.CampaignPlan.WeeklyTasksDigest,
        expect.any(Object),
      )
    })
  })

  describe('legacy cohort (no tracker rows)', () => {
    it('sends the legacy campaign_task digest for a campaign with no tracker rows', async () => {
      const campaign = await makeCampaign()
      for (let i = 0; i < 3; i++) await makeLegacyTask(campaign.id)
      const trackSpy = getTrackSpy()

      const handler = service.app.get(WeeklyTasksDigestHandlerService)
      await handler.handleWeeklyTasksDigest({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      })

      expect(trackSpy).toHaveBeenCalledOnce()
      expect(trackSpy).toHaveBeenCalledWith(
        campaign.userId,
        EVENTS.CampaignPlan.WeeklyTasksDigest,
        expect.any(Object),
      )
    })

    it('counts only legacy tasks, ignoring tracker latest-generation scoping', async () => {
      const campaign = await makeCampaign()
      // 5 legacy tasks across two "weeks" — campaign_task has no generation
      // model, so all in-window rows count (unlike the tracker cohort).
      for (let i = 0; i < 3; i++) {
        await makeLegacyTask(campaign.id, { title: `W1 ${i}`, week: 1 })
      }
      for (let i = 0; i < 2; i++) {
        await makeLegacyTask(campaign.id, { title: `W2 ${i}`, week: 2 })
      }
      const trackSpy = getTrackSpy()

      const handler = service.app.get(WeeklyTasksDigestHandlerService)
      await handler.handleWeeklyTasksDigest({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      })

      const [, , properties] = trackSpy.mock.calls[0] as [
        number,
        string,
        Record<string, unknown>,
      ]
      expect(properties.plan_total_tasks).toBe(5)
    })

    it('routes a migrated campaign (both legacy + tracker rows) to the tracker cohort only, no double-send', async () => {
      const campaign = await makeCampaign()
      // Old legacy rows linger from before the campaign migrated to v3.
      for (let i = 0; i < 5; i++) {
        await makeLegacyTask(campaign.id, { title: `Legacy ${i}` })
      }
      // New tracker rows from after migration.
      for (let i = 0; i < 3; i++) {
        await makeTask(campaign.id, { title: `Tracker ${i}` })
      }
      const trackSpy = getTrackSpy()

      const handler = service.app.get(WeeklyTasksDigestHandlerService)
      await handler.handleWeeklyTasksDigest({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      })

      // Exactly one digest (mutual exclusion via the NOT EXISTS guard), and it
      // is the tracker digest — only the 3 tracker rows, never the 5 legacy.
      expect(trackSpy).toHaveBeenCalledOnce()
      const [, , properties] = trackSpy.mock.calls[0] as [
        number,
        string,
        Record<string, unknown>,
      ]
      expect(properties.plan_total_tasks).toBe(3)
      expect(properties.task_name_1).toContain('Tracker')
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

      const handler = service.app.get(WeeklyTasksDigestHandlerService)
      await handler.handleWeeklyTasksDigest({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      })

      expect(trackSpy).toHaveBeenCalledTimes(2)
      const userIds = trackSpy.mock.calls.map((call) => call[0]).sort()
      expect(userIds).toEqual([c1.userId, c2.userId].sort())
    })
  })
})
