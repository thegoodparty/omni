import {
  ContactStatsCategory,
  ContactsStats,
} from 'app/dashboard/polls/shared/queries'
import { formatFencedCount } from '../../../crm/shared/formatFencedCount.util'

export interface ContactStatsRendered {
  totalConstituents: string | null
  homeownersPercent: string | null
  hasChildrenUnder18Percent: string | null
  medianIncomeRange: string | null
  visibleContactsPercent: string | null
}

const parseIncomeMin = (label: string): number => {
  const num = parseInt(label.replace(/[^0-9]/g, ''), 10)
  if (label.includes('+')) return 250000
  if (label.includes('k')) return num * 1000
  return num
}

const getMedianIncomeRange = (
  category?: ContactStatsCategory,
): string | null => {
  if (!category?.length) return null

  const sorted = category
    .filter((b) => b.label !== 'Unknown' && b.percent > 0)
    .sort((a, b) => parseIncomeMin(a.label) - parseIncomeMin(b.label))

  if (!sorted.length) return null

  const totalKnownPercent = sorted.reduce((sum, b) => sum + b.percent, 0)
  if (totalKnownPercent === 0) return null

  const medianThreshold = totalKnownPercent / 2
  let cumulative = 0
  for (const bucket of sorted) {
    cumulative += bucket.percent
    if (cumulative >= medianThreshold) {
      return `$${bucket.label.replace(/–/g, '-')}`
    }
  }

  const last = sorted[sorted.length - 1]
  return last ? `$${last.label.replace(/–/g, '-')}` : null
}

const getPercentForYes = (category: ContactStatsCategory): number | null => {
  const yes = category?.find((b) => b.label === 'Yes')
  return yes?.percent ? yes.percent : null
}

export const getContactStatsRendered = (
  stats: ContactsStats,
  totalVisibleContacts: number,
  totalVisibleContactsFenced?: boolean,
): ContactStatsRendered => {
  if (!stats || !stats.buckets) {
    return {
      totalConstituents: '--',
      homeownersPercent: '--',
      hasChildrenUnder18Percent: '--',
      medianIncomeRange: '--',
      visibleContactsPercent: '--',
    }
  }
  const totalConstituents = stats.totalConstituents
  const homeownersPercent = getPercentForYes(stats.buckets.homeowner)
  const hasChildrenUnder18Percent = getPercentForYes(
    stats.buckets.presenceOfChildren,
  )
  const medianIncomeRange = getMedianIncomeRange(
    stats.buckets.estimatedIncomeRange,
  )
  // A fenced totalVisibleContacts is a FENCE_LIMIT floor, not the real
  // count — a precise percent computed from it would contradict the "+"
  // shown on the total card right next to it.
  const visibleContactsPercent =
    totalVisibleContactsFenced || !totalConstituents
      ? 0
      : (totalVisibleContacts / totalConstituents) * 100
  return {
    totalConstituents: totalVisibleContacts
      ? formatFencedCount(totalVisibleContacts, totalVisibleContactsFenced)
      : '--',
    homeownersPercent: homeownersPercent ? `${homeownersPercent}%` : '--',
    hasChildrenUnder18Percent: hasChildrenUnder18Percent
      ? `${hasChildrenUnder18Percent}%`
      : '--',
    medianIncomeRange: medianIncomeRange ? `${medianIncomeRange}` : '--',
    visibleContactsPercent: visibleContactsPercent
      ? `${visibleContactsPercent.toFixed(2)}%`
      : '--',
  }
}
