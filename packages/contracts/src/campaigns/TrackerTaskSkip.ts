import type { TrackerTaskSkipReason } from '../generated/enums'
import {
  BALLOT_ACCESS_CATEGORY,
  CAMPAIGN_TASK_CATALOG,
} from './CampaignTaskCatalog.data'

// A candidate can set a task aside without completing it: "later" keeps it
// from being their next task for a few days, "notForMe" until they bring it
// back. Shared so gp-api and every surface agree on what is set aside.

// How long "later" keeps a task from being the next task.
export const TRACKER_TASK_SNOOZE_DAYS = 3

const DAY_MS = 24 * 60 * 60 * 1000

// Ballot access can only be put off, never set aside for good: it only shows
// for a candidate who hasn't told us they're on the ballot, and missing it
// ends the race. Finance reporting is not on this list, because whether a
// candidate has to file depends on the state and often on how much they
// raise, and we don't know either.
export const canSetTaskAsideForGood = (title: string): boolean =>
  CAMPAIGN_TASK_CATALOG.find((task) => task.title === title)?.category !==
  BALLOT_ACCESS_CATEGORY

// "Later" never carries a task past its own due date: it comes back on the
// due date when that is sooner than the usual few days, and still ahead.
export const trackerTaskSnoozeUntil = (now: Date, due: Date | string): Date => {
  const usual = new Date(now.getTime() + TRACKER_TASK_SNOOZE_DAYS * DAY_MS)
  const dueAt = new Date(due)
  return dueAt > now && dueAt < usual ? dueAt : usual
}

export const isTrackerTaskSetAside = (
  task: {
    skipReason: TrackerTaskSkipReason | null
    snoozedUntil: string | Date | null
  },
  now: Date,
): boolean =>
  task.skipReason === 'notForMe' ||
  (task.skipReason === 'later' &&
    task.snoozedUntil !== null &&
    new Date(task.snoozedUntil) > now)
