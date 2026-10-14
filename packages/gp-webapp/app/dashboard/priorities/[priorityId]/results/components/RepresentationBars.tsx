import {
  REPRESENTATION_DIMENSIONS,
  type PriorityRepresentation,
  type RepresentationGroup,
} from '@goodparty_org/contracts'
import { DIMENSION_LABELS, RESULTS_COPY } from '../resultsCopy'

// A gap this small is noise at the sample sizes outreach reaches.
const EVEN_WITHIN_POINTS = 2
// The widest bar, in points. Larger gaps pin to the edge rather than
// shrinking every other bar into a sliver.
const SCALE_POINTS = 25

const pct = (share: number): number => Math.round(share * 100)

type SharesLabel = (respondent: number, district: number) => string

const GroupRow = ({
  group,
  shares,
}: {
  group: RepresentationGroup
  shares: SharesLabel
}) => {
  const gap = (group.respondentShare - group.districtShare) * 100
  const points = Math.round(Math.abs(gap))
  const even = points < EVEN_WITHIN_POINTS
  const width = `${Math.min(100, (Math.abs(gap) / SCALE_POINTS) * 100) / 2}%`
  const label = even
    ? RESULTS_COPY.even
    : gap > 0
      ? RESULTS_COPY.overBy(points)
      : RESULTS_COPY.underBy(points)

  return (
    <li className="grid grid-cols-[minmax(0,10rem)_1fr] items-center gap-3 py-1.5 sm:grid-cols-[12rem_1fr_8rem]">
      <div className="min-w-0">
        <p className="truncate text-sm text-foreground">{group.label}</p>
        <p className="text-xs text-muted-foreground sm:hidden">{label}</p>
      </div>
      <div
        className="relative h-4 rounded-sm bg-muted"
        role="img"
        aria-label={`${group.label}: ${label}. ${shares(
          pct(group.respondentShare),
          pct(group.districtShare),
        )}`}
        title={shares(pct(group.respondentShare), pct(group.districtShare))}
      >
        <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
        {!even && (
          <span
            className={
              gap > 0
                ? 'absolute inset-y-0 left-1/2 rounded-r-sm bg-primary'
                : 'absolute inset-y-0 right-1/2 rounded-l-sm bg-warning'
            }
            style={{ width }}
          />
        )}
      </div>
      <p className="hidden text-right text-xs tabular-nums text-muted-foreground sm:block">
        {label}
      </p>
    </li>
  )
}

export const RepresentationBars = ({
  representation,
  shares = RESULTS_COPY.shares,
}: {
  representation: PriorityRepresentation
  shares?: SharesLabel
}) => (
  <div className="flex flex-col gap-5">
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm bg-primary" aria-hidden />
        {RESULTS_COPY.legendOver}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm bg-warning" aria-hidden />
        {RESULTS_COPY.legendUnder}
      </span>
    </div>
    {REPRESENTATION_DIMENSIONS.map((dimension) => {
      const groups = representation.groups.filter(
        (group) => group.dimension === dimension,
      )
      if (groups.length === 0) return null
      return (
        <section key={dimension} aria-label={DIMENSION_LABELS[dimension]}>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {DIMENSION_LABELS[dimension]}
          </h3>
          <ul>
            {groups.map((group) => (
              <GroupRow key={group.key} group={group} shares={shares} />
            ))}
          </ul>
        </section>
      )
    })}
  </div>
)
