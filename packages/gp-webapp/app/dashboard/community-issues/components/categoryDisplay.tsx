import {
  BriefcaseIcon,
  ConstructionIcon,
  GraduationCapIcon,
  HeartPulseIcon,
  HouseIcon,
  LandmarkIcon,
  ShieldIcon,
  TagIcon,
  TreePineIcon,
} from '@styleguide/components/ui/icons'

type CategoryDisplay = {
  label: string
  Icon: typeof TagIcon
}

const OTHER: CategoryDisplay = { label: 'Other', Icon: TagIcon }

const CATEGORY_DISPLAY: Record<string, CategoryDisplay> = {
  infrastructure_and_transportation: {
    label: 'Infrastructure',
    Icon: ConstructionIcon,
  },
  public_safety: { label: 'Public safety', Icon: ShieldIcon },
  education: { label: 'Education', Icon: GraduationCapIcon },
  housing_and_development: { label: 'Housing', Icon: HouseIcon },
  health_and_human_services: {
    label: 'Health & services',
    Icon: HeartPulseIcon,
  },
  economic_development: { label: 'Economic development', Icon: BriefcaseIcon },
  quality_of_life: { label: 'Quality of life', Icon: TreePineIcon },
  government_operations: { label: 'Government', Icon: LandmarkIcon },
  other: OTHER,
}

export const categoryDisplay = (category: string): CategoryDisplay =>
  CATEGORY_DISPLAY[category] ?? OTHER
