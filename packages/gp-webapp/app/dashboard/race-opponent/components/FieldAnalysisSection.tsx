import { cn } from '@styleguide'
import {
  TrendingUpIcon,
  TriangleAlertIcon,
  SparklesIcon,
  OctagonAlertIcon,
} from '@styleguide/components/ui/icons'
import type { RaceOpponentFieldAnalysis } from 'gpApi/api-endpoints'
import SourceRow from './SourceRow'

type QuadrantKey = 'strengths' | 'weaknesses' | 'opportunities' | 'threats'

type Quadrant = {
  quadrantKey: QuadrantKey
  label: string
  icon: React.ReactNode
  items: string[]
  className: string
}

const QUADRANT_DEFS: Array<{
  quadrantKey: QuadrantKey
  label: string
  icon: React.ReactNode
  className: string
}> = [
  {
    quadrantKey: 'strengths',
    label: 'Strengths',
    icon: <TrendingUpIcon className="size-4" aria-hidden />,
    className: 'border-success/30 bg-success/5 text-success',
  },
  {
    quadrantKey: 'weaknesses',
    label: 'Weaknesses',
    icon: <TriangleAlertIcon className="size-4" aria-hidden />,
    className: 'border-warning/40 bg-warning/5 text-warning',
  },
  {
    quadrantKey: 'opportunities',
    label: 'Opportunities',
    icon: <SparklesIcon className="size-4" aria-hidden />,
    className: 'border-info/30 bg-info/5 text-info',
  },
  {
    quadrantKey: 'threats',
    label: 'Threats',
    icon: <OctagonAlertIcon className="size-4" aria-hidden />,
    className: 'border-destructive/30 bg-destructive/5 text-destructive',
  },
]

const QuadrantCard = ({
  label,
  icon,
  items,
  className,
}: Quadrant): React.JSX.Element => (
  <div
    className={cn(
      'flex min-w-0 flex-col gap-2 rounded-lg border p-3',
      className,
    )}
  >
    <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
      {icon}
      {label}
    </span>
    <ul className="mt-1 flex min-w-0 flex-col gap-2 text-sm">
      {items.map((item, index) => (
        <li
          key={`${label}-${index}`}
          className="ml-5 min-w-0 list-disc list-outside break-words text-foreground marker:text-current"
        >
          {item}
        </li>
      ))}
    </ul>
  </div>
)

type Props = {
  fieldAnalysis: RaceOpponentFieldAnalysis | null | undefined
}

// The campaign-level SWOT below the opponent roster: derived from the
// candidate's own platform plus opponent web sources (ENG-10630/ENG-10636).
// Omits an empty quadrant entirely, and omits the whole section when fewer
// than 2 quadrants have content — a single populated quadrant doesn't read as
// a "how you stack up against the field" comparison.
const FieldAnalysisSection = ({
  fieldAnalysis,
}: Props): React.JSX.Element | null => {
  if (!fieldAnalysis) return null

  const quadrants: Quadrant[] = QUADRANT_DEFS.map((def) => ({
    ...def,
    items: fieldAnalysis[def.quadrantKey],
  })).filter((quadrant) => quadrant.items.length > 0)

  if (quadrants.length < 2) return null

  return (
    <section className="mx-auto mt-10 w-full max-w-[608px]">
      <h2 className="text-lg font-semibold text-foreground">
        How your campaign stacks up against the field
      </h2>
      <p className="text-sm text-muted-foreground">
        Use this analysis to help decide where to lean in and where to shore up.
      </p>
      <div className="mt-4 rounded-xl border border-border bg-card p-4 md:p-6">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {quadrants.map((quadrant) => (
            <QuadrantCard key={quadrant.quadrantKey} {...quadrant} />
          ))}
        </div>
        <div className="mt-4">
          <SourceRow
            sources={fieldAnalysis.sources}
            nonLinkedSource={{ publisher: 'Good Party internal data' }}
          />
        </div>
      </div>
    </section>
  )
}

export default FieldAnalysisSection
