import Link from 'next/link'
import { Badge, Button } from '@styleguide'
import { PLANS_COPY, type PlanColumn } from './plansCopy'

interface PlanCtaProps {
  column: PlanColumn
  isCurrent: boolean
  // Null when the plan can't be bought from here: Free, or one at or below
  // the current plan. A null href inside it shows the button disabled.
  offer: { href: string | null } | null
  className?: string
}

export const PlanCta = ({
  column,
  isCurrent,
  offer,
  className,
}: PlanCtaProps): React.JSX.Element | null => {
  const variant = column.plan === 'team' ? 'outline' : 'default'
  if (isCurrent) {
    return (
      <div className="flex flex-col items-center gap-2">
        <Badge variant="outline">{PLANS_COPY.currentBadge}</Badge>
        {column.cta && (
          <Button disabled variant={variant} className={className}>
            {column.cta}
          </Button>
        )}
      </div>
    )
  }
  if (!offer || !column.cta) return null
  if (!offer.href) {
    return (
      <Button disabled variant={variant} className={className}>
        {column.cta}
      </Button>
    )
  }
  return (
    <Button asChild variant={variant} className={className}>
      <Link href={offer.href}>{column.cta}</Link>
    </Button>
  )
}
