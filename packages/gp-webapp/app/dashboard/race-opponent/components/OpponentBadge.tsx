import { Badge, cn } from '@styleguide'
import type { ScaleIcon } from '@styleguide/components/ui/icons'

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
  // Optional leading icon (a lucide icon from the styleguide barrel), shown
  // before the label to match the Lovable badge styling.
  Icon?: typeof ScaleIcon
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
  Icon,
  className,
}: Props): React.JSX.Element => (
  <Badge
    variant="outline"
    className={cn(
      'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
      TONE_CLASS[tone],
      className,
    )}
  >
    {Icon && <Icon className="size-3 shrink-0" aria-hidden />}
    {label}
  </Badge>
)

export default OpponentBadge
