import {
  Card,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@styleguide'
import { CheckIcon, MinusIcon } from '@styleguide/components/ui/icons'
import { cn } from '@styleguide/lib/utils'
import { PlanCta } from './PlanCta'
import { PlanName } from './PlanName'
import { PlanOffer } from './PlanOffer'
import {
  planColumnsFor,
  PLAN_FEATURES,
  PLANS_COPY,
  planIncludes,
  type PlanKey,
} from './plansCopy'

interface PlansTableProps {
  currentPlan: PlanKey
  onSubscription?: boolean
  highlighted: PlanKey
  offerFor: (plan: PlanKey) => { href: string | null } | null
}

const TINT = 'bg-primary/5'

// Design: GpdPlansDesk and PayPlansPageTeam. The phone design swaps this for
// stacked cards.
export const PlansTable = ({
  currentPlan,
  onSubscription,
  highlighted,
  offerFor,
}: PlansTableProps): React.JSX.Element => (
  <Card className="px-6">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="align-middle">
            <div className="flex flex-col gap-1">
              <span className="text-base font-semibold text-foreground">
                {PLANS_COPY.compare}
              </span>
              {!onSubscription && (
                <span className="text-sm font-normal text-muted-foreground">
                  {PLANS_COPY.upgradeAnytime}
                </span>
              )}
            </div>
          </TableHead>
          {planColumnsFor(currentPlan, onSubscription).map((column) => (
            <TableHead
              key={column.plan}
              className={cn(
                'text-center align-top',
                column.plan === highlighted && TINT,
              )}
            >
              <div className="flex flex-col items-center gap-2 py-2">
                <PlanName plan={column.plan} name={column.name} />
                <span className="text-sm font-normal text-muted-foreground">
                  {column.caption}
                </span>
                <PlanCta
                  column={column}
                  isCurrent={column.plan === currentPlan}
                  offer={offerFor(column.plan)}
                  highlighted={column.plan === highlighted}
                />
              </div>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {PLAN_FEATURES.map((feature) => (
          <TableRow key={feature.title}>
            <TableCell>
              <div className="flex items-center gap-3">
                <feature.icon
                  className="size-5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <div className="flex flex-col">
                  <span className="text-sm font-semibold">{feature.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {feature.caption}
                  </span>
                </div>
              </div>
            </TableCell>
            {planColumnsFor(currentPlan, onSubscription).map((column) => {
              const included = planIncludes(column.plan, feature)
              return (
                <TableCell
                  key={column.plan}
                  className={cn(
                    'text-center',
                    column.plan === highlighted && TINT,
                  )}
                >
                  {included && feature.offer ? (
                    <span className="text-sm">
                      <PlanOffer offer={feature.offer} />
                    </span>
                  ) : (
                    <span
                      role="img"
                      aria-label={
                        included ? PLANS_COPY.included : PLANS_COPY.notIncluded
                      }
                      className="inline-flex"
                    >
                      {included ? (
                        <CheckIcon
                          className="size-4 text-primary"
                          aria-hidden
                        />
                      ) : (
                        <MinusIcon
                          className="size-4 text-muted-foreground"
                          aria-hidden
                        />
                      )}
                    </span>
                  )}
                </TableCell>
              )
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </Card>
)
