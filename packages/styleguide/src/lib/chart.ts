export const CHART_COLORS = [
  'var(--data-chart-1)',
  'var(--data-chart-2)',
  'var(--data-chart-3)',
  'var(--data-chart-4)',
  'var(--data-chart-5)',
  'var(--data-chart-6)',
  'var(--data-chart-7)',
] as const

export const formatChartNumber = (
  value: number | string | null | undefined,
  fixed: number = 0,
): string => {
  if (value === null || value === undefined) return '0'
  const num = typeof value === 'number' ? value : parseFloat(value)
  if (Number.isNaN(num)) return '0'
  return num.toLocaleString('en-US', {
    minimumFractionDigits: fixed,
    maximumFractionDigits: fixed,
  })
}

export const formatChartPercent = (
  value: number | string | null | undefined,
): string => {
  if (value === null || value === undefined) return '0'
  const num = typeof value === 'number' ? value : parseFloat(value)
  if (Number.isNaN(num) || num <= 0) return '0'
  if (num < 1) return '<1'
  return formatChartNumber(num)
}
