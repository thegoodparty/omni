import type { ReactNode } from 'react'

export function formatNumberForDisplay(
  num: number | string | undefined | null,
  emptyState: ReactNode = '—'
): ReactNode {
  if (num === undefined || num === null) return emptyState
  const parsed = typeof num === 'string' ? parseFloat(num) : num
  if (isNaN(parsed)) return emptyState
  return parsed.toLocaleString()
}
