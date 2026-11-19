import Link from 'next/link'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@styleguide'
import { CheckIcon } from '@styleguide/components/ui/icons'
import { cn } from '@styleguide/lib/utils'
import { PLANS_COPY, type PlanCardCopy } from './plansCopy'

interface PlanCardProps {
  card: PlanCardCopy
  isCurrent: boolean
  // Null when the plan can't be bought from here: Free, or one at or below
  // the current plan.
  cta: { label: string; href: string } | null
  className?: string
}

export const PlanCard = ({
  card,
  isCurrent,
  cta,
  className,
}: PlanCardProps): React.JSX.Element => (
  <Card
    data-testid={`plan-card-${card.plan}`}
    className={cn(isCurrent && 'border-primary', className)}
  >
    <CardHeader>
      <div className="flex items-center justify-between gap-2">
        <CardTitle className="text-sm font-semibold">{card.name}</CardTitle>
        {isCurrent && <Badge variant="soft">{PLANS_COPY.currentBadge}</Badge>}
      </div>
      <p className="text-xl font-semibold">{card.price}</p>
      <p className="text-sm text-muted-foreground">{card.caption}</p>
    </CardHeader>
    <CardContent className="flex flex-1 flex-col gap-4">
      <ul className="flex flex-1 flex-col gap-2">
        {card.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm">
            <CheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            {feature}
          </li>
        ))}
      </ul>
      {isCurrent ? (
        <Button disabled className="w-full">
          {PLANS_COPY.currentCta}
        </Button>
      ) : (
        cta && (
          <Button asChild className="w-full">
            <Link href={cta.href}>{cta.label}</Link>
          </Button>
        )
      )}
    </CardContent>
  </Card>
)
