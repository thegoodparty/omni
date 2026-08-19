import {
  addDays,
  addWeeks,
  differenceInCalendarWeeks,
  startOfDay,
  subDays,
  subWeeks,
} from 'date-fns'
import {
  BALLOT_ACCESS_CATEGORY,
  CAMPAIGN_TASK_CATALOG,
  TaskTiming,
} from '@goodparty_org/contracts'
import { Campaign, Prisma } from '../../../generated/prisma'
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

// Onboarding's "Are you already on the ballot?" answer. Read it the same way
// the campaign manager does: onboarding writes it to details.ballotStatus AND
// to the whole-answers snapshot, and campaigns that answered before the update
// schema let details.ballotStatus through only have the snapshot copy.
export const resolveBallotStatus = (
  campaign: Pick<Campaign, 'details' | 'data'>,
): PrismaJson.CampaignDetails['ballotStatus'] | null =>
  campaign.details?.ballotStatus ??
  campaign.data?.onboarding?.ballotStatus ??
  null

// Ballot access is only work for a candidate who has not filed yet.
// 'on-ballot' is the one answer that affirmatively means those steps are done,
// so it is the only one that drops them; 'testing' and a missing answer keep
// them, because a candidate we never asked is not a candidate who filed, and
// silently dropping a filing deadline is unrecoverable while an extra
// pre-launch task is one they can check off.
export const needsBallotAccessTasks = (
  campaign: Pick<Campaign, 'details' | 'data'>,
): boolean => resolveBallotStatus(campaign) !== 'on-ballot'

// Tracker rows carry no catalog id, so the titles are the only handle the
// reconcile has on the ballot-access rows — derive them from the catalog so
// they cannot drift from what was materialized.
export const BALLOT_ACCESS_TASK_TITLES = CAMPAIGN_TASK_CATALOG.filter(
  (task) => task.category === BALLOT_ACCESS_CATEGORY,
).map((task) => task.title)

// Build the campaign's static (global) tracker rows from the catalog — the
// Pre-launch/Launch/GOTV-ops tasks that exist as soon as the tracker starts.
export const buildStaticTrackerTaskRows = (
  campaignId: number,
  start: Date,
  electionDate: Date | null,
  includeBallotAccess: boolean,
): Prisma.CampaignTrackerTaskCreateManyInput[] =>
  CAMPAIGN_TASK_CATALOG.filter(
    (task) =>
      task.type === 'static' &&
      (includeBallotAccess || task.category !== BALLOT_ACCESS_CATEGORY),
  ).map((task) => toRow(campaignId, start, electionDate, task))

// Just the ballot-access rows, for adding them back when a candidate's ballot
// status changes after the one-shot static materialization.
export const buildBallotAccessTrackerTaskRows = (
  campaignId: number,
  start: Date,
  electionDate: Date | null,
): Prisma.CampaignTrackerTaskCreateManyInput[] =>
  CAMPAIGN_TASK_CATALOG.filter(
    (task) => task.category === BALLOT_ACCESS_CATEGORY,
  ).map((task) => toRow(campaignId, start, electionDate, task))

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
