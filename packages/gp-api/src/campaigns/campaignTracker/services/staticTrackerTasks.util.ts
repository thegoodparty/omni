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

// The only outreach the tracker ever suggests is the campaign plan's fixed
// contact schedule: the 7 text/robocall sends (intro/persuasion/early-vote/
// election-day). They are deterministic and election-dated, NOT agent-selected
// — the CAP catalog attachment excludes these channels (see
// scripts/generate-tracker-catalog.ts) and the persist drops any it returns.
const OUTREACH_CHANNELS = new Set<string>(['text', 'robocall'])

const toRow = (
  campaignId: number,
  start: Date,
  electionDate: Date | null,
  task: (typeof CAMPAIGN_TASK_CATALOG)[number],
): Prisma.CampaignTrackerTaskCreateManyInput => {
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
}

// Build the campaign's static (global) tracker rows from the catalog — the
// Pre-launch/Launch/GOTV-ops tasks that exist as soon as the tracker starts.
export const buildStaticTrackerTaskRows = (
  campaignId: number,
  start: Date,
  electionDate: Date | null,
): Prisma.CampaignTrackerTaskCreateManyInput[] =>
  CAMPAIGN_TASK_CATALOG.filter((task) => task.type === 'static').map((task) =>
    toRow(campaignId, start, electionDate, task),
  )

// Build the 7 deterministic outreach rows (the plan contact schedule). Returns
// none when the candidate lost their primary — a lost-primary race is over, so
// the tracker must never suggest further texts/robocalls (gated on the
// HubSpot-sourced `campaign.primaryResult`).
export const buildOutreachTrackerTaskRows = (
  campaignId: number,
  start: Date,
  electionDate: Date | null,
  primaryLost: boolean,
): Prisma.CampaignTrackerTaskCreateManyInput[] =>
  primaryLost
    ? []
    : CAMPAIGN_TASK_CATALOG.filter((task) =>
        OUTREACH_CHANNELS.has(task.channel),
      ).map((task) => toRow(campaignId, start, electionDate, task))
