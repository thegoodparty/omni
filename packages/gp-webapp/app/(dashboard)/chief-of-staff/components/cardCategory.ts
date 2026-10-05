import {
  MessageSquareIcon,
  SparklesIcon,
} from '@styleguide/components/ui/icons'
import type { DashboardCardType } from '../data/contracts'

interface CardCategory {
  label: string
}

const BY_TYPE: Record<DashboardCardType, CardCategory> = {
  briefing: { label: 'Briefing' },
  agenda_item: { label: 'Legislation' },
  community_issue: { label: 'Community Issue' },
}

/**
 * Map a card type to its overline label. `comms` / CoS categories
 * (message-square / sparkles icons) are reserved for future card sources.
 */
export function cardCategory(type: DashboardCardType): CardCategory {
  return BY_TYPE[type]
}

export const COMMS_ICON = MessageSquareIcon
export const COS_ICON = SparklesIcon
