import { Card } from '@styleguide'
import { CheckIcon } from '@styleguide/components/ui/icons'
import { cn } from '@styleguide/lib/utils'
import { PlanCta } from './PlanCta'
import { PlanName } from './PlanName'
import { PlanOffer } from './PlanOffer'
import {
  planColumnsFor,
  PLAN_FEATURES,
  planIncludes,
  type PlanKey,
} from './plansCopy'

interface PlanCardsProps {
  currentPlan: PlanKey
  onSubscription?: boolean
  highlighted: PlanKey
  offerFor: (plan: PlanKey) => { href: string | null } | null
}

// Design: GpdPlansPhone and PayPlansPhoneTeam. The table becomes one card per
// plan with a check list; the highlighted plan leads, then the other paid
// plan, then Free.
export const PlanCards = ({
  currentPlan,
  onSubscription,
  highlighted,
  offerFor,
}: PlanCardsProps): React.JSX.Element => {
  const rank = (plan: PlanKey): number =>
    plan === highlighted ? 0 : plan === 'free' ? 2 : 1
  const columns = [...planColumnsFor(currentPlan, onSubscription)].sort(
    (a, b) => rank(a.plan) - rank(b.plan),
  )
  return (
    <div className="flex flex-col gap-4">
      {columns.map((column) => (
        <div
          key={column.plan}
          className={cn(
            'rounded-xl',
            column.plan === highlighted && 'ring-2 ring-primary/30',
          )}
        >
          <Card data-testid={`plan-card-${column.plan}`} className="gap-3 px-4">
            <div className="flex items-center justify-between">
              <PlanName plan={column.plan} name={column.name} />
              <span className="text-base font-semibold">{column.price}</span>
            </div>
            <p className="text-sm text-muted-foreground">{column.caption}</p>
            <ul className="flex flex-col gap-2.5">
              {PLAN_FEATURES.filter((feature) =>
                planIncludes(column.plan, feature),
              ).map((feature) => (
                <li
                  key={feature.title}
                  className="flex items-start gap-2.5 text-sm"
                >
                  <CheckIcon
                    className="mt-0.5 size-4 shrink-0 text-primary"
                    aria-hidden
                  />
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {feature.title}
                    {feature.offer && <PlanOffer offer={feature.offer} />}
                  </span>
                </li>
              ))}
            </ul>
            <PlanCta
              column={column}
              isCurrent={column.plan === currentPlan}
              offer={offerFor(column.plan)}
              highlighted={column.plan === highlighted}
              className="w-full"
            />
          </Card>
        </div>
      ))}
    </div>
  )
}
