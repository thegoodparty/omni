import { Badge, cn } from '@styleguide'
import type {
  OrdinanceComparables,
  OrdinancePresentComparables,
} from '@goodparty_org/contracts'
import { AssistantMarkdown } from '../../shared/agent-chat/chatUI'
import SourceLine from './SourceLine'

const STATUS = {
  passed: {
    label: 'Passed',
    badge: 'border-success/40 bg-success/10 text-success',
  },
  repealed: {
    label: 'Repealed',
    badge: 'border-destructive/40 bg-destructive/10 text-destructive',
  },
  unknown: {
    label: 'Unknown',
    badge: 'border-border bg-muted text-muted-foreground',
  },
} as const

const ComparableCard = ({
  comparable,
}: {
  comparable: OrdinanceComparables[number]
}): React.JSX.Element => {
  const status = STATUS[comparable.status]
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {comparable.city}, {comparable.state}
            {comparable.population != null || comparable.year != null ? (
              <span className="font-normal text-muted-foreground">
                {comparable.population != null
                  ? ` · pop ${comparable.population.toLocaleString('en-US')}`
                  : ''}
                {comparable.year != null ? ` · ${comparable.year}` : ''}
              </span>
            ) : null}
          </p>
          {comparable.headline ? (
            <p className="text-sm text-foreground">{comparable.headline}</p>
          ) : null}
        </div>
        <Badge
          variant="outline"
          shape="pill"
          className={cn(
            'shrink-0 text-xs font-semibold uppercase tracking-wide',
            status.badge,
          )}
        >
          {status.label}
        </Badge>
      </div>
      {comparable.quote.trim() ? (
        <blockquote className="break-words rounded-md border-l-2 border-border bg-muted/40 px-3 py-2 text-sm italic leading-6 text-foreground">
          &ldquo;{comparable.quote}&rdquo;
        </blockquote>
      ) : null}
      {comparable.outcome ? (
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">Outcome.</span>{' '}
          {comparable.outcome}
        </p>
      ) : null}
      {comparable.failureReason ? (
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-destructive">Why it failed.</span>{' '}
          {comparable.failureReason}
        </p>
      ) : null}
      <SourceLine source={comparable.source} />
    </div>
  )
}

// The present_comparables tool payload: intro and takeaway travel inside the
// payload so the framing prose and the cards render as one atomic block.
export default function ComparablesWidget({
  presentation,
}: {
  presentation: OrdinancePresentComparables
}): React.JSX.Element | null {
  const { intro, comparables, takeaway } = presentation
  if (comparables.length === 0 && !intro && !takeaway) return null
  return (
    <div className="flex flex-col gap-3">
      {intro ? <AssistantMarkdown>{intro}</AssistantMarkdown> : null}
      {comparables.map((comparable, i) => (
        <ComparableCard
          key={`${comparable.source.id}-${i}`}
          comparable={comparable}
        />
      ))}
      {takeaway ? <AssistantMarkdown>{takeaway}</AssistantMarkdown> : null}
    </div>
  )
}
