export function formatNumber(num: number | string | undefined | null): string {
  if (num === undefined || num === null) return '—'
  const parsed = typeof num === 'string' ? parseFloat(num) : num
  if (isNaN(parsed)) return '—'
  return parsed.toLocaleString()
}
