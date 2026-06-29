import { Badge, cn } from '@styleguide'

export type OpponentBadgeTone = 'neutral' | 'democrat' | 'republican'

export const partyTone = (party: string): OpponentBadgeTone => {
  const normalized = party.trim().toLowerCase()
  if (normalized === 'democrat' || normalized === 'democratic') {
    return 'democrat'
  }
  if (normalized === 'republican') {
    return 'republican'
  }
  return 'neutral'
}

type Props = {
  label: string
  tone?: OpponentBadgeTone
  className?: string
}

const TONE_CLASS: Record<OpponentBadgeTone, string> = {
  neutral: 'bg-muted text-muted-foreground border-border',
  democrat: 'bg-info-50 text-info-600 border-info-600/20',
  republican: 'bg-destructive/10 text-destructive border-destructive/20',
}

const OpponentBadge = ({
  label,
  tone = 'neutral',
  className,
}: Props): React.JSX.Element => (
  <Badge
    variant="outline"
    className={cn(
      'rounded-full px-2.5 py-0.5 text-xs font-medium',
      TONE_CLASS[tone],
      className,
    )}
  >
    {label}
  </Badge>
)

export default OpponentBadge
