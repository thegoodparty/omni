import type { TrackerTaskSkipReason } from '../generated/enums'
import {
  BALLOT_ACCESS_CATEGORY,
  CAMPAIGN_TASK_CATALOG,
} from './CampaignTaskCatalog.data'

// A candidate can put a task off ("later"), which moves its date a few days
// out so the plan sorts it behind what's due sooner, or set it aside
// ("notForMe") until they bring it back. Shared so gp-api and every surface
// agree.

// How far "later" moves a task.
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

// A task whose date is a fact rather than a plan (a registration deadline,
// early voting, election day) can't be put off: moving it would be untrue.
const FIXED_DATE_CATEGORIES = new Set(['Election admin'])
const FIXED_DATE_TITLES = new Set(['Election Day'])

export const canPutOffTask = (title: string): boolean => {
  if (FIXED_DATE_TITLES.has(title)) return false
  const entry = CAMPAIGN_TASK_CATALOG.find((task) => task.title === title)
  return !entry || !FIXED_DATE_CATEGORIES.has(entry.category)
}

// The date "later" moves a task to: a few days from today, at UTC midnight
// like every tracker date.
export const trackerTaskPutOffDate = (now: Date): Date => {
  const later = new Date(now.getTime() + TRACKER_TASK_SNOOZE_DAYS * DAY_MS)
  return new Date(
    Date.UTC(later.getUTCFullYear(), later.getUTCMonth(), later.getUTCDate()),
  )
}

// Only "Not for me" takes a task out of the running. A put-off task is
// simply dated later.
export const isTrackerTaskSetAside = (task: {
  skipReason: TrackerTaskSkipReason | null
}): boolean => task.skipReason === 'notForMe'
