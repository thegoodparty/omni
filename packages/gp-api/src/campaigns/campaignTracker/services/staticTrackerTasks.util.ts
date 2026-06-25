import {
  addDays,
  addWeeks,
  differenceInCalendarWeeks,
  startOfDay,
  subDays,
  subWeeks,
} from 'date-fns'
import { CAMPAIGN_TASK_CATALOG, TaskTiming } from '@goodparty_org/contracts'
import { Prisma } from '../../../generated/prisma'
import { CHANNEL_TO_FLOW_TYPE } from '../campaignTracker.consts'

// Resolve a catalog task's structured timing to a concrete date. The column is
// NOT NULL, so undated kinds (jurisdiction/recurring/perItem) anchor to `start`
// until the plan timeline supplies real dates.
const resolveTaskDate = (
  timing: TaskTiming,
  start: Date,
  electionDate: Date | null,
): Date => {
  switch (timing.kind) {
    case 'asap':
    case 'onboardingWeek':
      return start
    case 'preLaunch':
      return addDays(start, 7)
    case 'launch':
      return addDays(start, 14)
    case 'electionRelative':
      if (!electionDate) return start
      return timing.unit === 'weeks'
        ? subWeeks(electionDate, timing.offset)
        : subDays(electionDate, timing.offset)
    case 'electionDay':
      return electionDate ?? start
    case 'afterElection':
      return electionDate ? addWeeks(electionDate, timing.weeks) : start
    case 'jurisdiction':
    case 'recurring':
    case 'perItem':
      return start
  }
}

// Build the campaign's static (global) tracker rows from the catalog — the
// Pre-launch/Launch/GOTV-ops tasks that exist as soon as the tracker starts.
export const buildStaticTrackerTaskRows = (
  campaignId: number,
  start: Date,
  electionDate: Date | null,
): Prisma.CampaignTrackerTaskCreateManyInput[] =>
  CAMPAIGN_TASK_CATALOG.filter((task) => task.type === 'static').map((task) => {
    const date = startOfDay(resolveTaskDate(task.timing, start, electionDate))
    return {
      campaignId,
      title: task.title,
      description: task.description,
      flowType: CHANNEL_TO_FLOW_TYPE[task.channel] ?? null,
      week: Math.max(0, differenceInCalendarWeeks(date, start)),
      date,
      proRequired: task.proRequired,
      isDefaultTask: true,
      phase: task.phase,
      completed: false,
    }
  })
