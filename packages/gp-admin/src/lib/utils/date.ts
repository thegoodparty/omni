import { format } from 'date-fns'
import type { ReactNode } from 'react'

export function formatDate(
  value: string | number | Date | null | undefined,
  emptyState: ReactNode = '—'
): ReactNode {
  if (!value) return emptyState
  const date = value instanceof Date ? value : new Date(value)
  if (isNaN(date.getTime())) return emptyState
  return format(date, 'MMM d, yyyy')
}

// Fixed to Eastern rather than the viewer's or the server's runtime zone:
// this page renders on the server (Vercel's runtime clock is arbitrary) and
// the queue table on the client, so a "local" format would silently disagree
// between the two. CAS's own send-window/compliance cron jobs already treat
// Eastern as the team's operating timezone (gp-api's EASTERN_TIMEZONE), so
// this reuses that convention rather than introducing a second one.
const SEND_TIME_ZONE = 'America/New_York'

export function formatDateTime(
  value: string | number | Date | null | undefined,
  emptyState: ReactNode = '—'
): ReactNode {
  if (!value) return emptyState
  const date = value instanceof Date ? value : new Date(value)
  if (isNaN(date.getTime())) return emptyState
  return new Intl.DateTimeFormat('en-US', {
    timeZone: SEND_TIME_ZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date)
}

// For a plain "YYYY-MM-DD" calendar-day string (no time, no zone — e.g.
// Outreach.scheduledLocalDate). `new Date('YYYY-MM-DD')` parses as UTC
// midnight, which prints as the PREVIOUS day in any zone behind UTC — the
// exact bug this exists to avoid, so the parts are read out and handed to
// the local-timezone Date constructor directly instead.
export function formatLocalDateString(
  value: string | null | undefined,
  emptyState: ReactNode = '—'
): ReactNode {
  if (!value) return emptyState
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return emptyState
  const [, year, month, day] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  return format(date, 'MMM d, yyyy')
}

// For a plain "HH:mm" wall-clock string (no date, no zone — e.g.
// Outreach.scheduledLocalTime, applied in each contact's own timezone).
// Returns null on a missing/malformed value so callers can fall back to
// their no-time copy.
export function formatLocalTimeString(
  value: string | null | undefined
): string | null {
  if (!value) return null
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const [, hours, minutes] = match
  const date = new Date(2000, 0, 1, Number(hours), Number(minutes))
  if (isNaN(date.getTime())) return null
  return format(date, Number(minutes) === 0 ? 'haaa' : 'h:mmaaa')
}

export function formatTimestampString(
  timestamp: string | undefined,
  emptyState: ReactNode = '—'
): ReactNode {
  if (!timestamp) return emptyState
  const ts = parseInt(timestamp, 10)
  if (isNaN(ts)) return timestamp
  return formatDate(ts, emptyState)
}
