import { cn } from '@styleguide'
import type { RaceOpponentThreatTier } from '@goodparty_org/contracts'

// The threat-tier label shown on the right of an opponent row: a colored dot
// plus text. Card v2 (ENG-10635): the primary threat reads in the primary
// token; the other two tiers read in foreground text with a colored dot
// (matching the Lovable design). `warning-600` is the nearest registered
// design token to Lovable's raw amber-500 — the styleguide forbids raw
// Tailwind palette classes, and there is no `warning-500` token.
const TIER_CONFIG: Record<
  RaceOpponentThreatTier,
  { label: string; dot: string; text: string }
> = {
  primary_threat: {
    label: 'Main threat',
    dot: 'bg-primary',
    text: 'text-primary',
  },
  watch_closely: {
    label: 'Watch closely',
    dot: 'bg-warning-600',
    text: 'text-foreground',
  },
  low_priority: {
    label: 'Low priority',
    dot: 'bg-muted-foreground/50',
    text: 'text-foreground',
  },
}

// The bare tier label (no dot/color), reused by the PDF export so the brief's
// snapshot line reads the same wording as the on-screen roster badge.
export const threatTierLabel = (
  tier: RaceOpponentThreatTier,
): string | undefined => TIER_CONFIG[tier]?.label

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
        'flex items-center gap-1.5 text-xs font-medium',
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
