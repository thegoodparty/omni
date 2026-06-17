import {
  CalendarIcon,
  GavelIcon,
  MessageSquareIcon,
  SparklesIcon,
} from '@styleguide/components/ui/icons'
import type { LucideIcon } from 'lucide-react'
import type { DashboardCardType } from '../data/contracts'

interface CardCategory {
  label: string
  Icon: LucideIcon
}

const BY_TYPE: Record<DashboardCardType, CardCategory> = {
  briefing: { label: 'Briefing', Icon: CalendarIcon },
  agenda_item: { label: 'Legislation', Icon: GavelIcon },
}

/**
 * Map a card type to its eyebrow label + icon. `comms` / CoS categories
 * (message-square / sparkles) are reserved for future card sources; v1 only
 * generates `briefing` and `agenda_item` rows.
 */
export function cardCategory(type: DashboardCardType): CardCategory {
  return BY_TYPE[type]
}

export const COMMS_ICON = MessageSquareIcon
export const COS_ICON = SparklesIcon
