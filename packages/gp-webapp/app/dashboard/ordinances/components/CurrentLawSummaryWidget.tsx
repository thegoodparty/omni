import type {
  OrdinanceCurrentLawSummary,
  OrdinanceLawPoint,
} from '@goodparty_org/contracts'
import SourceLine from './SourceLine'

const PointsCard = ({
  title,
  points,
}: {
  title: string
  points: OrdinanceLawPoint[]
}) => (
  <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
    <p className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
      {title}
    </p>
    <ul className="mt-3 flex flex-col gap-3">
      {points.map((point, i) => (
        <li key={`${point.title}-${i}`} className="flex items-start gap-3">
          <span className="mt-2.5 h-1.5 w-1.5 rounded-full bg-foreground/50" />
          <div className="flex min-w-0 flex-col">
            <p className="text-sm font-semibold text-card-foreground">
              {point.title}
            </p>
            {point.subtitle ? (
              <p className="text-sm text-muted-foreground">{point.subtitle}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  </div>
)

// present_current_law_summary tool payload: what the chapter on the books does
// today and where it falls short. An empty list renders no card at all.
export default function CurrentLawSummaryWidget({
  summary,
}: {
  summary: OrdinanceCurrentLawSummary
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-foreground">
          {summary.chapterLabel}
        </p>
        {summary.source ? <SourceLine source={summary.source} /> : null}
      </div>
      {summary.does.length > 0 ? (
        <PointsCard title="What it does today" points={summary.does} />
      ) : null}
      {summary.gaps.length > 0 ? (
        <PointsCard title="Where there are gaps" points={summary.gaps} />
      ) : null}
    </div>
  )
}
