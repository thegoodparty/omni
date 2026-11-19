import Link from 'next/link'
import { Badge, Button } from '@styleguide'
import { PLANS_COPY, type PlanColumn } from './plansCopy'

interface PlanCtaProps {
  column: PlanColumn
  isCurrent: boolean
  // Null when the plan can't be bought from here: Free, or one at or below
  // the current plan.
  href: string | null
  className?: string
}

export const PlanCta = ({
  column,
  isCurrent,
  href,
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
  if (!href || !column.cta) return null
  return (
    <Button asChild variant={variant} className={className}>
      <Link href={href}>{column.cta}</Link>
    </Button>
  )
}
