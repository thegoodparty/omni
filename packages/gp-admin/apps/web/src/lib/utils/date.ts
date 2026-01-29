import { format } from 'date-fns'

export function formatDate(
  value: string | number | Date | null | undefined
): string {
  if (!value) return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (isNaN(date.getTime())) return '—'
  return format(date, 'MMM d, yyyy')
}

export function formatTimestampString(timestamp: string | undefined): string {
  if (!timestamp) return '—'
  const ts = parseInt(timestamp, 10)
  if (isNaN(ts)) return timestamp
  return formatDate(ts)
}
