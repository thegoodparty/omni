'use client'

import { Progress, Tooltip, TooltipContent, TooltipTrigger } from '@styleguide'
import { CircleHelpIcon } from '@styleguide/components/ui/icons'
import { Skeleton } from '@styleguide'
import { useSupportEstimate } from '../data/use-dashboard'

const HELP_COPY =
  'An estimate of how many constituents in your district are likely to ' +
  'support you, based on GoodParty.org modeling. It updates over time.'

export default function SupportHero(): React.JSX.Element {
  const { data, isPending, isError } = useSupportEstimate()

  const percent =
    data && data.districtSize > 0
      ? Math.min(
          100,
          Math.round((data.likelySupport / data.districtSize) * 100),
        )
      : 0

  return (
    <div className="rounded-2xl border border-border bg-card p-4 lg:p-6">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Likely supporters
        </span>
        <Tooltip openOnClick>
          <TooltipTrigger
            aria-label="What is this estimate?"
            className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          >
            <CircleHelpIcon className="size-4" aria-hidden />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{HELP_COPY}</TooltipContent>
        </Tooltip>
      </div>

      {isPending ? (
        <Skeleton className="mt-2 h-9 w-48" />
      ) : isError || !data ? (
        <p className="mt-1 text-sm text-muted-foreground">
          We could not load your support estimate right now.
        </p>
      ) : (
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-3xl font-bold tabular-nums text-foreground">
            {data.likelySupport.toLocaleString()}
          </span>
          <span className="text-lg font-medium tabular-nums text-muted-foreground">
            / {data.districtSize.toLocaleString()} constituents
          </span>
        </div>
      )}

      <Progress value={percent} className="mt-4 h-2 bg-muted" />
    </div>
  )
}
