import { HistoryIcon } from '@styleguide/components/ui/icons'
import type { OrdinanceLegislativeHistory } from '@goodparty_org/contracts'
import SourceLine from './SourceLine'

// The present_legislative_history tool payload rendered as a vertical
// timeline: why the chapter reads the way it does, with minutes excerpts.
export default function LegislativeHistoryWidget({
  history,
}: {
  history: OrdinanceLegislativeHistory
}): React.JSX.Element | null {
  if (history.entries.length === 0) return null
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <HistoryIcon className="size-4 text-primary" aria-hidden />
          <p className="text-base font-semibold text-foreground">
            Intent and history
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          {history.chapterLabel ? `${history.chapterLabel}. ` : ''}
          The reasoning behind the law, not just the text.
        </p>
      </div>
      <ol className="relative flex flex-col gap-4 pl-6">
        <span
          className="pointer-events-none absolute left-[7px] top-2 bottom-2 w-px bg-border"
          aria-hidden
        />
        {history.entries.map((entry, i) => (
          <li key={`${entry.year}-${entry.label}-${i}`} className="relative">
            <span
              className="absolute top-5 -left-[24px] flex h-4 w-4 items-center justify-center rounded-full border border-border bg-background"
              aria-hidden
            >
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            </span>
            <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {entry.year}
                </span>
                <span className="text-sm text-muted-foreground">
                  {entry.label}
                </span>
              </div>
              <p className="text-sm leading-6 text-foreground">
                {entry.summary}
              </p>
              {entry.minutesExcerpt ? (
                <blockquote className="break-words rounded-md border-l-2 border-border bg-muted/40 px-3 py-2 text-sm italic leading-6 text-foreground">
                  &ldquo;{entry.minutesExcerpt}&rdquo;
                  {entry.speaker ? (
                    <footer className="mt-1 text-xs not-italic text-muted-foreground">
                      {entry.speaker}
                    </footer>
                  ) : null}
                </blockquote>
              ) : null}
              {entry.source ? <SourceLine source={entry.source} /> : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
