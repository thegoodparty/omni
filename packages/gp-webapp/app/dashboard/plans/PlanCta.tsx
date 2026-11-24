import Link from 'next/link'
import { Button } from '@styleguide'
import { PLANS_COPY, type PlanColumn } from './plansCopy'

interface PlanCtaProps {
  column: PlanColumn
  isCurrent: boolean
  // Null when the plan can't be bought from here: Free, or one at or below
  // the current plan. A null href inside it shows the button disabled.
  offer: { href: string | null } | null
  // The highlighted plan takes the filled button; the other paid plan, outline.
  highlighted: boolean
  className?: string
}

export const PlanCta = ({
  column,
  isCurrent,
  offer,
  highlighted,
  className,
}: PlanCtaProps): React.JSX.Element | null => {
  const variant = highlighted ? 'default' : 'outline'
  if (isCurrent) {
    return (
      <span className="flex h-10 w-full items-center justify-center text-base font-medium text-foreground">
        {PLANS_COPY.currentBadge}
      </span>
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
