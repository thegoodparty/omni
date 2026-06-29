import {
  TriangleAlertIcon,
  EyeIcon,
  CircleMinusIcon,
} from '@styleguide/components/ui/icons'
import type { RaceOpponentThreatTier } from '@goodparty_org/contracts'
import OpponentBadge, { type OpponentBadgeTone } from './OpponentBadge'

const TIER_CONFIG: Record<
  RaceOpponentThreatTier,
  { label: string; tone: OpponentBadgeTone; Icon: typeof TriangleAlertIcon }
> = {
  primary_threat: {
    label: 'Primary threat',
    tone: 'threat_primary',
    Icon: TriangleAlertIcon,
  },
  watch_closely: {
    label: 'Watch closely',
    tone: 'threat_watch',
    Icon: EyeIcon,
  },
  low_priority: {
    label: 'Low priority',
    tone: 'threat_low',
    Icon: CircleMinusIcon,
  },
}

type Props = {
  tier: RaceOpponentThreatTier
  className?: string
}

// The colored threat-tier label shown on the roster card. Returns nothing for
// an unknown tier so an opponent without analysis renders no badge (rather than
// an empty placeholder).
const ThreatTierBadge = ({
  tier,
  className,
}: Props): React.JSX.Element | null => {
  const config = TIER_CONFIG[tier]
  if (!config) return null
  return (
    <OpponentBadge
      label={config.label}
      tone={config.tone}
      Icon={config.Icon}
      className={className}
    />
  )
}

export default ThreatTierBadge
