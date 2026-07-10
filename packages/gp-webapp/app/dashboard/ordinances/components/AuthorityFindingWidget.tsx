import { cn } from '@styleguide'
import {
  CircleAlertIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from '@styleguide/components/ui/icons'
import type { OrdinanceAuthorityFinding } from '@goodparty_org/contracts'
import SourceLine from './SourceLine'

// pass = authority confirmed, attention = authority with a caveat worth
// reading, flag = a blocker (preemption, charter change, ballot measure).
const VARIANTS = {
  pass: {
    icon: ShieldCheckIcon,
    label: 'Authority confirmed',
    card: 'border-success/40 bg-success/5',
    iconColor: 'text-success',
  },
  attention: {
    icon: CircleAlertIcon,
    label: 'Authority caveat',
    card: 'border-warning/40 bg-warning/5',
    iconColor: 'text-warning',
  },
  flag: {
    icon: TriangleAlertIcon,
    label: 'Authority problem',
    card: 'border-destructive/40 bg-destructive/5',
    iconColor: 'text-destructive',
  },
} as const

// The authority-check verdict card (present_authority_finding tool payload):
// status icon, verdict headline, the statute-grounded explanation, an optional
// "what this means for you" confirmation, and the cited source.
export default function AuthorityFindingWidget({
  finding,
}: {
  finding: OrdinanceAuthorityFinding
}): React.JSX.Element {
  const variant = VARIANTS[finding.status]
  const Icon = variant.icon
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border p-4 shadow-sm',
        variant.card,
      )}
    >
      <Icon
        className={cn('size-5 shrink-0', variant.iconColor)}
        aria-label={variant.label}
        role="img"
      />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-semibold text-foreground">
          {finding.headline}
        </p>
        <p className="text-sm leading-6 text-foreground">
          {finding.explanation}
        </p>
        {finding.confirmation ? (
          <p className="text-sm leading-6 text-foreground">
            {finding.confirmation}
          </p>
        ) : null}
        <div className="mt-1">
          <SourceLine source={finding.source} />
        </div>
      </div>
    </div>
  )
}
