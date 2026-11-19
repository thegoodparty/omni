import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@styleguide'
import { CheckIcon, GiftIcon, MinusIcon } from '@styleguide/components/ui/icons'
import { PlanCta } from './PlanCta'
import { PlanName } from './PlanName'
import {
  planColumnsFor,
  PLAN_FEATURES,
  PLANS_COPY,
  planIncludes,
  type PlanKey,
} from './plansCopy'

interface PlansTableProps {
  currentPlan: PlanKey
  offerFor: (plan: PlanKey) => { href: string | null } | null
}

// Design: GpdPlansDesk. The phone design swaps this for stacked cards.
export const PlansTable = ({
  currentPlan,
  offerFor,
}: PlansTableProps): React.JSX.Element => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>
          <span className="text-base font-semibold text-foreground">
            {PLANS_COPY.compare}
          </span>
        </TableHead>
        {planColumnsFor(currentPlan).map((column) => (
          <TableHead key={column.plan} className="text-center align-top">
            <div className="flex flex-col items-center gap-1 py-2">
              <PlanName plan={column.plan} name={column.name} />
              <span className="text-sm text-muted-foreground">
                {column.caption}
              </span>
              <span className="text-sm font-semibold text-foreground">
                {column.price}
              </span>
              <PlanCta
                column={column}
                isCurrent={column.plan === currentPlan}
                offer={offerFor(column.plan)}
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
            <div className="flex flex-col">
              <span className="text-sm font-semibold">{feature.title}</span>
              <span className="text-xs text-muted-foreground">
                {feature.caption}
              </span>
            </div>
          </TableCell>
          {planColumnsFor(currentPlan).map((column) => {
            const included = planIncludes(column.plan, feature)
            return (
              <TableCell key={column.plan} className="text-center">
                {included && feature.offer ? (
                  <span className="inline-flex items-center gap-1 text-sm font-medium">
                    <GiftIcon className="size-4" aria-hidden />
                    {feature.offer}
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
                      <CheckIcon className="size-4" aria-hidden />
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
)
