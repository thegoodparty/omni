import { cn } from '@styleguide'
import type { RaceOpponentThreatTier } from '@goodparty_org/contracts'

// The threat-tier label shown on the right of an opponent row: a colored dot
// plus text. The primary threat reads in blue; the others keep foreground/muted
// text with a colored dot (matching the Lovable design).
const TIER_CONFIG: Record<
  RaceOpponentThreatTier,
  { label: string; dot: string; text: string }
> = {
  primary_threat: {
    label: 'Main threat',
    dot: 'bg-info-600',
    text: 'text-info-600',
  },
  watch_closely: {
    label: 'Watch closely',
    dot: 'bg-warning-600',
    text: 'text-foreground',
  },
  low_priority: {
    label: 'Low priority',
    dot: 'bg-muted-foreground',
    text: 'text-muted-foreground',
  },
}

type Props = {
  tier: RaceOpponentThreatTier
  className?: string
}

// Returns nothing for an unknown tier so an opponent without analysis renders no
// label (rather than an empty placeholder).
const ThreatTierBadge = ({
  tier,
  className,
}: Props): React.JSX.Element | null => {
  const config = TIER_CONFIG[tier]
  if (!config) return null
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 text-sm font-medium',
        config.text,
        className,
      )}
    >
      <span
        className={cn('size-2 shrink-0 rounded-full', config.dot)}
        aria-hidden
      />
      {config.label}
    </span>
  )
}

export default ThreatTierBadge
