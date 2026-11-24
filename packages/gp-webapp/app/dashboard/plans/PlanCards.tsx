import { Card } from '@styleguide'
import { CheckIcon, MinusIcon } from '@styleguide/components/ui/icons'
import { cn } from '@styleguide/lib/utils'
import { PlanCta } from './PlanCta'
import { PlanName } from './PlanName'
import { PlanOffer } from './PlanOffer'
import {
  planColumnsFor,
  PLAN_COLUMNS,
  PLAN_FEATURES,
  PLANS_COPY,
  planIncludes,
  planRank,
  type PlanColumn,
  type PlanKey,
} from './plansCopy'

interface PlanCardsProps {
  currentPlan: PlanKey
  onSubscription?: boolean
  highlighted: PlanKey
  // The plan the page recommends; null for a campaign that is not on Free.
  recommended: PlanKey | null
  offerFor: (plan: PlanKey) => { href: string | null } | null
}

// Design: GpdPlansPhone and PayPlansPhoneTeam. The table becomes one card per
// plan; the highlighted plan leads, then the other paid plan, then Free. The
// highlighted card and Free list every feature. The other paid card lists only
// what differs from the highlighted plan.
export const PlanCards = ({
  currentPlan,
  onSubscription,
  highlighted,
  recommended,
  offerFor,
}: PlanCardsProps): React.JSX.Element => {
  const rank = (plan: PlanKey): number =>
    plan === highlighted ? 0 : plan === 'free' ? 2 : 1
  const columns = [...planColumnsFor(currentPlan, onSubscription)].sort(
    (a, b) => rank(a.plan) - rank(b.plan),
  )
  const highlightedName =
    PLAN_COLUMNS.find((c) => c.plan === highlighted)?.name ?? ''
  const recommendedName =
    PLAN_COLUMNS.find((c) => c.plan === recommended)?.name ?? ''
  return (
    <div className="flex flex-col gap-4">
      {recommended && (
        <p className="text-sm text-muted-foreground">
          {PLANS_COPY.recommend(recommendedName)}
        </p>
      )}
      {columns.map((column) => (
        <div
          key={column.plan}
          className={cn(
            'rounded-xl',
            column.plan === highlighted && 'ring-2 ring-primary/30',
          )}
        >
          <Card
            data-testid={`plan-card-${column.plan}`}
            className={cn(
              'gap-3 px-4',
              column.plan === highlighted && 'bg-primary/5',
            )}
          >
            <div className="flex items-center justify-between">
              <PlanName plan={column.plan} name={column.name} />
              <span className="text-base font-semibold">{column.price}</span>
            </div>
            <p className="text-sm text-muted-foreground">{column.caption}</p>
            {column.plan === 'free' || column.plan === highlighted ? (
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
            ) : (
              <DifferenceList
                column={column}
                highlighted={highlighted}
                name={highlightedName}
              />
            )}
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

// The other paid plan against the highlighted one: Team adds a row over Pro,
// Pro lacks one that Team has.
const DifferenceList = ({
  column,
  highlighted,
  name,
}: {
  column: PlanColumn
  highlighted: PlanKey
  name: string
}): React.JSX.Element => {
  const adds = planRank(column.plan) > planRank(highlighted)
  const rows = PLAN_FEATURES.filter(
    (feature) =>
      planIncludes(column.plan, feature) !== planIncludes(highlighted, feature),
  )
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-sm font-semibold">
        {adds
          ? PLANS_COPY.everythingInPlus(name)
          : PLANS_COPY.everythingInExcept(name)}
      </p>
      <ul className="flex flex-col gap-2.5">
        {rows.map((feature) => (
          <li key={feature.title} className="flex items-start gap-2.5 text-sm">
            {adds ? (
              <CheckIcon
                className="mt-0.5 size-4 shrink-0 text-primary"
                aria-hidden
              />
            ) : (
              <MinusIcon
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            )}
            {feature.title}
          </li>
        ))}
      </ul>
    </div>
  )
}
