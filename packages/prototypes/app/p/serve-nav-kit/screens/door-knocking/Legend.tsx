'use client'

import { FilterPill, FilterPillGroup, cn } from '@goodparty_org/styleguide'
import {
  type StatusColor,
  type Voter,
  STATUS_DOT,
  getVoterCounts,
} from './doorKnockingData'

const LABELS: Record<StatusColor, string> = {
  red: 'Support unknown',
  orange: 'Not home',
  green: 'Supporter',
  crimson: 'Non-supporter',
  purple: 'Inaccessible',
  slate: 'Refused',
}

// The interactive map legend and the read-only progress legend use different
// orders in the source, so the order follows the mode.
const MAP_ORDER: StatusColor[] = [
  'red',
  'orange',
  'green',
  'crimson',
  'purple',
  'slate',
]
const PROGRESS_ORDER: StatusColor[] = [
  'green',
  'crimson',
  'orange',
  'red',
  'purple',
  'slate',
]

type Props = {
  voters?: Voter[]
  pinFilter?: StatusColor | null
  onPinFilter?: (c: StatusColor | null) => void
  readOnly?: boolean
  withRoute?: boolean
  className?: string
}

const Dot = ({ color }: { color: StatusColor }) => (
  <span className={cn('size-2.5 rounded-full', STATUS_DOT[color])} />
)

export const Legend = ({
  voters,
  pinFilter,
  onPinFilter,
  readOnly = false,
  withRoute = false,
  className,
}: Props) => {
  const counts = voters ? getVoterCounts(voters) : null
  // Source renders the count as a plain small muted number after the label
  // (LegendDot), not a parenthesized "(N)".
  const count = (c: StatusColor) =>
    counts ? (
      <span className="text-muted-foreground ml-0.5 text-[10px] leading-none">
        {counts[c]}
      </span>
    ) : null
  const scroll = cn('scrollbar-none -mx-1 overflow-x-auto px-1', className)

  // Read-only (walk progress / draw preview): plain dot + label + count text,
  // matching the source (no bordered pills).
  if (readOnly || !onPinFilter) {
    return (
      <div className={scroll}>
        <div className="flex w-max items-center gap-x-4 gap-y-1">
          {PROGRESS_ORDER.map((c) => (
            <span
              key={c}
              className="text-muted-foreground inline-flex shrink-0 items-center gap-1.5 text-xs"
            >
              <Dot color={c} />
              {LABELS[c]}
              {count(c)}
            </span>
          ))}
          {withRoute && (
            <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1.5 text-xs">
              <span className="bg-primary h-0.5 w-5 rounded-full" />
              Route
            </span>
          )}
        </div>
      </div>
    )
  }

  // Interactive map legend: DS FilterPill toggles that filter the pins.
  return (
    <div className={scroll}>
      <FilterPillGroup
        type="single"
        value={pinFilter ?? ''}
        onValueChange={(v) => onPinFilter((v as StatusColor) || null)}
        className="w-max flex-nowrap"
      >
        {MAP_ORDER.map((c) => (
          <FilterPill key={c} value={c} className="shrink-0 gap-1.5">
            <Dot color={c} />
            {LABELS[c]}
            {count(c)}
          </FilterPill>
        ))}
      </FilterPillGroup>
    </div>
  )
}
