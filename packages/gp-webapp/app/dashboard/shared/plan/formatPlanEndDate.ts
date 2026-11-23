import { planLastDay } from '@goodparty_org/contracts'

// UTC, never the viewer's zone, so the server render and the browser agree.
export const formatPlanEndDate = (
  endsAt: Date | string,
  month: 'short' | 'long' = 'short',
): string =>
  planLastDay(endsAt).toLocaleDateString('en-US', {
    month,
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
