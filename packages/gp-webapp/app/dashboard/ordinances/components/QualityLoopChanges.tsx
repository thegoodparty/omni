import { useState } from 'react'
import { Button, cn } from '@styleguide'
import { ChevronRightIcon } from '@styleguide/components/ui/icons'
import type {
  OrdinanceQualityIterationSummary,
  OrdinanceQualityLoopStatus,
  OrdinanceQualityReport,
} from '@goodparty_org/contracts'

// Honest terminal copy per the loop design: improvement is only claimed when
// flags are actually gone, stopped_* admits work remains, and superseded (the
// user's own edit won) gets no banner at all.
const outcomeLine = (
  status: OrdinanceQualityLoopStatus,
  report: OrdinanceQualityReport | null,
): string | null => {
  if (status === 'converged') {
    const attention = report?.tally.attention ?? 0
    if (attention === 0) return 'All six checks pass'
    return attention === 1
      ? 'No blocking problems — 1 item worth a look'
      : `No blocking problems — ${attention} items worth a look`
  }
  if (
    status === 'stopped_max_iterations' ||
    status === 'stopped_not_improving'
  ) {
    const flags = report?.tally.flag ?? 0
    return flags === 1
      ? 'Kept your strongest version — 1 check still needs your attention'
      : `Kept your strongest version — ${flags} checks still need` +
          ' your attention'
  }
  if (status === 'cancelled') {
    return 'Improvements stopped — your draft is ready to edit.'
  }
  if (status === 'failed') {
    return 'The improvement run hit a snag — your draft is ready to edit.'
  }
  return null
}

function IterationChanges({
  it,
}: {
  it: OrdinanceQualityIterationSummary
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const checkLabel = (checkId: string): string =>
    it.report?.checks.find((c) => c.id === checkId)?.label ?? checkId
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Pass {it.iteration + 1}
      </p>
      {it.revisionNotes?.map((note) => (
        <p key={note.checkId} className="text-sm text-foreground">
          <span className="font-semibold">{checkLabel(note.checkId)}:</span>{' '}
          {note.note}
        </p>
      ))}
      {it.revisedBody !== null ? (
        <>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="flex items-center gap-1 self-start text-sm font-medium text-primary"
          >
            <ChevronRightIcon
              className={cn(
                'size-4 shrink-0 transition-transform',
                expanded && 'rotate-90',
              )}
              aria-hidden
            />
            Show before and after
          </button>
          {expanded ? (
            <div className="flex flex-col gap-3">
              <div>
                <p className="mb-1 text-xs font-semibold text-muted-foreground">
                  Before
                </p>
                <p className="text-sm font-semibold text-foreground">
                  {it.draftTitle}
                </p>
                <p className="whitespace-pre-wrap text-sm text-foreground">
                  {it.draftBody}
                </p>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold text-muted-foreground">
                  After
                </p>
                <p className="text-sm font-semibold text-foreground">
                  {it.revisedTitle}
                </p>
                <p className="whitespace-pre-wrap text-sm text-foreground">
                  {it.revisedBody}
                </p>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

// Terminal summary of a finished quality-improvement loop: the outcome line
// plus a collapsible per-pass history (reviser notes + before/after texts)
// and a way back to the pre-loop draft.
export default function QualityLoopChanges({
  status,
  report,
  iterations,
  onRestoreOriginal,
}: {
  status: OrdinanceQualityLoopStatus
  report: OrdinanceQualityReport | null
  iterations: OrdinanceQualityIterationSummary[]
  onRestoreOriginal: () => Promise<void>
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  const line = outcomeLine(status, report)
  const revised = iterations.filter(
    (it) => it.revisedBody !== null || (it.revisionNotes?.length ?? 0) > 0,
  )
  if (!line && revised.length === 0) return null

  const restore = async (): Promise<void> => {
    setRestoring(true)
    setRestoreError(null)
    try {
      await onRestoreOriginal()
    } catch {
      setRestoreError('Could not restore the original draft. Please try again.')
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-3 rounded-lg border border-border p-4">
      {line ? (
        <p className="text-sm font-medium text-foreground">{line}</p>
      ) : null}
      {revised.length > 0 ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex items-center gap-1 self-start text-sm font-medium text-primary"
          >
            <ChevronRightIcon
              className={cn(
                'size-4 shrink-0 transition-transform',
                open && 'rotate-90',
              )}
              aria-hidden
            />
            What changed
          </button>
          {open ? (
            <div className="flex flex-col gap-3">
              {revised.map((it) => (
                <IterationChanges key={it.iteration} it={it} />
              ))}
              <div className="border-t border-border pt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="small"
                  onClick={restore}
                  disabled={restoring}
                  className="rounded-full text-sm"
                >
                  Restore original draft
                </Button>
                {restoreError ? (
                  <p className="mt-2 text-sm text-destructive">
                    {restoreError}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
