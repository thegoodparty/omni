import { Card } from '@styleguide'
import { CheckIcon, GiftIcon } from '@styleguide/components/ui/icons'
import { cn } from '@styleguide/lib/utils'
import { PlanCta } from './PlanCta'
import { PlanName } from './PlanName'
import {
  planColumnsFor,
  PLAN_FEATURES,
  planIncludes,
  type PlanKey,
} from './plansCopy'

interface PlanCardsProps {
  currentPlan: PlanKey
  highlightTeam: boolean
  hrefFor: (plan: PlanKey) => string | null
}

// Design: GpdPlansPhone. The table becomes one card per plan with a check
// list; Team moves to the top when the visitor came from a Team pitch.
export const PlanCards = ({
  currentPlan,
  highlightTeam,
  hrefFor,
}: PlanCardsProps): React.JSX.Element => (
  <div className="flex flex-col gap-4">
    {planColumnsFor(currentPlan).map((column) => (
      <Card
        key={column.plan}
        data-testid={`plan-card-${column.plan}`}
        className={cn(
          'gap-3 px-4',
          highlightTeam && column.plan === 'team' && '-order-1',
        )}
      >
        <div className="flex items-center justify-between">
          <PlanName plan={column.plan} name={column.name} />
          <span className="text-sm font-semibold">{column.price}</span>
        </div>
        <p className="text-sm text-muted-foreground">{column.caption}</p>
        <ul className="flex flex-col gap-2">
          {PLAN_FEATURES.filter((feature) =>
            planIncludes(column.plan, feature),
          ).map((feature) => (
            <li key={feature.title} className="flex items-start gap-2 text-sm">
              <CheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {feature.title}
                {feature.offer && (
                  <span className="ml-1 inline-flex items-center gap-1 font-medium">
                    <GiftIcon className="size-4" aria-hidden />
                    {feature.offer}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
        <PlanCta
          column={column}
          isCurrent={column.plan === currentPlan}
          href={hrefFor(column.plan)}
          className="w-full"
        />
      </Card>
    ))}
  </div>
)
