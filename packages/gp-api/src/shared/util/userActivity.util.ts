import { differenceInCalendarDays } from 'date-fns'

// Don't spend generation budget on a user who hasn't opened the product in
// this many days — fire a re-engagement signal instead. On-demand paths
// (landing on the dashboard) skip this gate, since landing already proves
// activity. Shared by meetingBriefings and communityIssues dispatch.
export const INACTIVITY_THRESHOLD_DAYS = 30

export const isInactiveUser = (
  lastVisitedMs: number | undefined,
  now: Date,
): boolean =>
  !lastVisitedMs ||
  differenceInCalendarDays(now, new Date(lastVisitedMs)) >
    INACTIVITY_THRESHOLD_DAYS
