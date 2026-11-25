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
import { PlanCta } from './PlanCta'
import { PlanName } from './PlanName'
import { RecommendedPanel } from './RecommendedPanel'
import {
  planColumnsFor,
  PLAN_FEATURES,
  PLANS_COPY,
  planIncludes,
  PLAN_COLUMNS,
  type PlanKey,
} from './plansCopy'

interface PlansTableProps {
  currentPlan: PlanKey
  // What gp-api prices Team against; differs from currentPlan for a legacy subscriber.
  heldPlan: PlanKey
  onSubscription?: boolean
  highlighted: PlanKey
  // The plan to caption "Best for your race"; null for a campaign that is not on Free.
  recommended: PlanKey | null
  offerFor: (plan: PlanKey) => { href: string | null } | null
}

// Design: GpdPlansDesk and PayPlansPageTeam. The phone design swaps this for
// stacked cards.
export const PlansTable = ({
  currentPlan,
  heldPlan,
  onSubscription,
  highlighted,
  recommended,
  offerFor,
}: PlansTableProps): React.JSX.Element => (
  <Card className="px-6">
    {/* Table clips its own overflow, which would cut off the tint's overhang. */}
    <div className="isolate [&_[data-slot=table-container]]:overflow-visible">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="align-middle">
              <div className="flex flex-col gap-1">
                <span className="text-base font-semibold text-foreground">
                  {PLANS_COPY.compare}
                </span>
                {recommended && (
                  <span className="text-sm font-normal text-muted-foreground">
                    {PLANS_COPY.recommend(
                      PLAN_COLUMNS.find((c) => c.plan === recommended)?.name ??
                        '',
                    )}
                  </span>
                )}
              </div>
            </TableHead>
            {planColumnsFor(heldPlan, onSubscription).map((column) => (
              <TableHead
                key={column.plan}
                className="relative text-center align-top"
              >
                {column.plan === highlighted && <RecommendedPanel />}
                <div className="flex flex-col items-center gap-2 py-2">
                  <PlanName plan={column.plan} name={column.name} />
                  <span className="text-sm font-normal text-muted-foreground">
                    {column.plan === recommended
                      ? PLANS_COPY.bestForRace
                      : column.caption}
                  </span>
                  {/* The design has no price line: paid prices sit in the button label and Free is $0 by being the plan you start on. */}
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
                    <span className="text-sm font-semibold">
                      {feature.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {feature.caption}
                    </span>
                  </div>
                </div>
              </TableCell>
              {planColumnsFor(heldPlan, onSubscription).map((column) => {
                const included = planIncludes(column.plan, feature)
                return (
                  <TableCell key={column.plan} className="text-center">
                    {included && feature.offer ? (
                      <span className="text-sm">
                        <span className="font-semibold">
                          {PLANS_COPY.creditIncluded}
                        </span>
                        <br />
                        <span className="text-xs text-muted-foreground">
                          {PLANS_COPY.creditWorth}
                        </span>
                      </span>
                    ) : (
                      <span
                        role="img"
                        aria-label={
                          included
                            ? PLANS_COPY.included
                            : PLANS_COPY.notIncluded
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
    </div>
  </Card>
)
