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

export function formatTimestampString(
  timestamp: string | undefined,
  emptyState: ReactNode = '—'
): ReactNode {
  if (!timestamp) return emptyState
  const ts = parseInt(timestamp, 10)
  if (isNaN(ts)) return timestamp
  return formatDate(ts, emptyState)
}
