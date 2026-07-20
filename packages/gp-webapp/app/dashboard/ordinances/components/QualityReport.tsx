'use client'

import { useEffect, useRef, useState } from 'react'
import { Badge, Button, IconButton, cn } from '@styleguide'
import {
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  LoaderCircleIcon,
  RefreshIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from '@styleguide/components/ui/icons'
import type {
  OrdinanceQualityCheck,
  OrdinanceQualityCheckStatus,
  OrdinanceQualityReport,
  OrdinanceQualityRun,
  OrdinanceQualityRunStatus,
} from '@goodparty_org/contracts'
import { extractApiErrorInfo } from 'helpers/extractApiErrorInfo'
import { fetchQualityRun, startQualityReport } from '../data/ordinances-api'
import SourceLine from './SourceLine'

type StatusMeta = {
  label: string
  pillClass: string
  Icon: typeof CircleCheckIcon
  iconClass: string
}

// Labels are stored lowercase and uppercased with CSS so the rendered text still
// reads "PASS" / "FLAG" while the DOM text stays lowercase.
const STATUS_META: Record<OrdinanceQualityCheckStatus, StatusMeta> = {
  pass: {
    label: 'pass',
    pillClass: 'border-success/40 bg-success/10 text-success-dark',
    Icon: CircleCheckIcon,
    iconClass: 'text-success',
  },
  flag: {
    label: 'flag',
    pillClass: 'border-destructive/40 bg-destructive/10 text-destructive-dark',
    Icon: TriangleAlertIcon,
    iconClass: 'text-destructive',
  },
  attention: {
    label: 'attention',
    pillClass: 'border-warning/50 bg-warning/10 text-warning-dark',
    Icon: CircleAlertIcon,
    iconClass: 'text-warning-dark',
  },
}

const StatusPill = ({
  status,
  children,
  className,
}: {
  status: OrdinanceQualityCheckStatus
  children: React.ReactNode
  className?: string
}): React.JSX.Element => (
  <Badge
    variant="outline"
    shape="pill"
    className={cn(
      'font-semibold uppercase',
      STATUS_META[status].pillClass,
      className,
    )}
  >
    {children}
  </Badge>
)

// ofetch puts the parsed error body on error.data; extractApiErrorInfo pulls a
// readable message off it (joining NestJS's string[] validation messages) so an
// actionable API error like "Cannot run quality checks on an empty draft"
// reaches the user instead of a generic string.
const runErrorMessage = (err: unknown): string => {
  const body =
    err && typeof err === 'object' && 'data' in err ? err.data : undefined
  return (
    extractApiErrorInfo(body).message ??
    'Could not run the quality checks. Please try again.'
  )
}

// The quality run is asynchronous server-side: POST returns 202 with the run's
// state and the client polls GET until it leaves 'running'. There is no client
// hard stop — the server heals an interrupted run to 'error' after 10 minutes,
// which ends the poll.
const POLL_MS = 2_000
const POLL_SLOW_AFTER_MS = 180_000
const POLL_SLOW_MS = 10_000
// Transient poll failures (flaky network) don't kill an otherwise-live run;
// only this many consecutive failures surface an error.
const MAX_POLL_FAILURES = 3
const SLOW_NOTE = 'Still working. This is taking longer than usual.'
// Local why-disabled feedback next to the run controls while the background
// improvement loop owns the draft (the loop banner scrolls out of view on a
// long draft, and a disabled button can't carry a tooltip).
const LOOP_NOTE =
  'Improvements are running — these checks refresh when they finish.'
const LOOP_NOTE_ID = 'quality-report-loop-note'

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })

function Check({
  check,
  onDiscuss,
}: {
  check: OrdinanceQualityCheck
  onDiscuss: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const meta = STATUS_META[check.status]
  return (
    <div className="p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        <meta.Icon
          className={cn('size-4 shrink-0', meta.iconClass)}
          aria-hidden
        />
        <span className="text-sm font-semibold text-foreground">
          {check.label}
        </span>
        <StatusPill status={check.status} className="ml-auto">
          {meta.label}
        </StatusPill>
        <ChevronRightIcon
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90',
          )}
          aria-hidden
        />
      </button>

      <p
        className={cn(
          'mt-2 text-xs text-foreground',
          open ? 'whitespace-pre-wrap' : 'line-clamp-1',
        )}
      >
        {check.note}
      </p>

      {check.source ? (
        <div className="mt-2">
          <SourceLine source={check.source} />
        </div>
      ) : null}

      {open ? (
        <div className="mt-3">
          <Button
            type="button"
            variant="outline"
            size="small"
            onClick={onDiscuss}
            className="gap-1.5 rounded-full text-sm"
          >
            <SparklesIcon className="size-3.5" aria-hidden />
            Discuss
          </Button>
        </div>
      ) : null}
    </div>
  )
}

// The quality report, rendered below the draft. Shows the saved six-check report
// handed down by DraftDetail (no fetch of its own) and re-runs it on demand.
// `draftDirty` is true once the draft has been edited this session, so the stale
// banner shows without a refetch; `onReran` clears it after a fresh run.
export default function QualityReport({
  slug,
  initialReport,
  initialRunStatus,
  draftDirty,
  onReran,
  onDiscussFinding,
  onBeforeRun,
  loopRunning,
}: {
  slug: string
  initialReport: OrdinanceQualityReport | null
  // The run's server-side status at load time. 'running' means a check kicked
  // off before this mount (a reload or navigation mid-run) — resume polling
  // instead of asking the user to click again.
  initialRunStatus: OrdinanceQualityRunStatus
  draftDirty: boolean
  onReran: () => void
  onDiscussFinding: (check: OrdinanceQualityCheck) => void
  // Flush any pending draft edits (awaited) before the report is generated, so
  // the LLM grades the just-saved text rather than the stale DB copy.
  onBeforeRun?: () => Promise<void>
  // The background improvement loop has no manual trigger here (design: the
  // panel control only re-grades; the loop auto-starts on draft). While the
  // loop runs the run buttons are disabled — the server 409s a manual run.
  loopRunning?: boolean
}): React.JSX.Element {
  const [report, setReport] = useState(initialReport)
  const [running, setRunning] = useState(initialRunStatus === 'running')
  const [slow, setSlow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // On a terminal run state: commit the fresh report, or surface the error
  // while keeping whatever report was already on screen (a failed re-run never
  // costs the previous results).
  const settle = (run: OrdinanceQualityRun): void => {
    if (run.status === 'done' && run.report) {
      setReport(run.report)
      setRunning(false)
      onReran()
      return
    }
    setError(
      run.status === 'error'
        ? (run.error ?? 'Could not run the quality checks. Please try again.')
        : report
          ? 'The re-run did not return an updated report, so the one below' +
            ' is unchanged. Please try again.'
          : 'The quality report was not returned. Please try again.',
    )
    setRunning(false)
  }

  // Poll until the run leaves 'running', then settle it. Passing null as
  // `first` starts polling blind (the resume-on-mount path).
  const watch = async (
    signal: AbortSignal,
    first: OrdinanceQualityRun | null,
  ): Promise<void> => {
    let current = first
    let failures = 0
    const startedAt = Date.now()
    while (!current || current.status === 'running') {
      const slowNow = Date.now() - startedAt >= POLL_SLOW_AFTER_MS
      if (slowNow) setSlow(true)
      await sleep(slowNow ? POLL_SLOW_MS : POLL_MS, signal)
      if (signal.aborted) return
      try {
        current = await fetchQualityRun(slug, { signal })
        failures = 0
      } catch (err) {
        if (signal.aborted) return
        failures += 1
        if (failures > MAX_POLL_FAILURES) throw err
      }
    }
    if (signal.aborted) return
    settle(current)
  }

  const run = async (): Promise<void> => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setSlow(false)
    setError(null)
    try {
      await onBeforeRun?.()
      const started = await startQualityReport(slug, {
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      if (started.status !== 'running') {
        settle(started)
        return
      }
      await watch(controller.signal, started)
    } catch (err) {
      if (controller.signal.aborted) return
      setError(runErrorMessage(err))
      setRunning(false)
    }
  }

  useEffect(() => {
    if (initialRunStatus === 'running') {
      const controller = new AbortController()
      abortRef.current = controller
      void watch(controller.signal, null).catch((err) => {
        if (controller.signal.aborted) return
        setError(runErrorMessage(err))
        setRunning(false)
      })
    }
    return () => abortRef.current?.abort()
    // Mount-only: resume tracking a run that started before this mount, and
    // abort whatever run is in flight when the component unmounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!report) {
    return (
      <div className="mt-8 flex flex-col items-start gap-3 border-t border-border pt-6">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Quality report
        </p>
        <p className="text-sm text-muted-foreground">
          Run the six-check review to see where the draft is strong and where it
          needs work.
        </p>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {running && slow ? (
          <p className="text-sm text-muted-foreground">{SLOW_NOTE}</p>
        ) : null}
        {loopRunning ? (
          <p id={LOOP_NOTE_ID} className="text-sm text-muted-foreground">
            {LOOP_NOTE}
          </p>
        ) : null}
        <Button
          type="button"
          onClick={run}
          disabled={running || loopRunning}
          aria-describedby={loopRunning ? LOOP_NOTE_ID : undefined}
          className="gap-2 rounded-full text-sm"
        >
          {running ? (
            <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
          ) : (
            <SparklesIcon className="size-4" aria-hidden />
          )}
          {running ? 'Reviewing…' : 'Run quality checks'}
        </Button>
      </div>
    )
  }

  const stale = report.stale || draftDirty

  return (
    <div className="mt-8 flex flex-col gap-4 border-t border-border pt-6">
      <div className="flex items-start gap-3">
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold text-foreground">
            Reviewed by {report.checks.length} checks
          </h3>
          {/* Hide the stale tally while a re-run is in flight — the loading
              state below stands in for the results being redone. */}
          {running ? null : (
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status="pass">{report.tally.pass} pass</StatusPill>
              <StatusPill status="flag">{report.tally.flag} flag</StatusPill>
              <StatusPill status="attention">
                {report.tally.attention} attention
              </StatusPill>
            </div>
          )}
        </div>
        {/* Design (Lovable QualityReport): an icon-only round refresh is the
            panel's single control — it re-grades the draft; improvement is
            never triggered from here. */}
        <IconButton
          type="button"
          variant="outline"
          size="small"
          onClick={run}
          disabled={running || loopRunning}
          aria-label="Re-run quality checks"
          aria-describedby={loopRunning ? LOOP_NOTE_ID : undefined}
          className="ml-auto shrink-0 rounded-full"
        >
          {running ? (
            <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
          ) : (
            <RefreshIcon className="size-4" aria-hidden />
          )}
        </IconButton>
      </div>
      {loopRunning ? (
        <p id={LOOP_NOTE_ID} className="text-xs text-muted-foreground">
          {LOOP_NOTE}
        </p>
      ) : null}

      {running ? (
        // Replace the stale cards with a loading state so re-running never
        // leaves the previous results on screen as if they were current.
        <div
          role="status"
          className="flex flex-col gap-2 rounded-lg border border-border px-4 py-6 text-sm text-muted-foreground"
        >
          <span className="flex items-center gap-2">
            <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
            Reviewing the draft…
          </span>
          {slow ? <span>{SLOW_NOTE}</span> : null}
        </div>
      ) : (
        <>
          {stale ? (
            <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-dark">
              The draft changed since this report ran. Re-run to refresh it.
            </p>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="divide-y divide-border rounded-lg border border-border">
            {report.checks.map((check) => (
              <Check
                key={check.id}
                check={check}
                onDiscuss={() => onDiscussFinding(check)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
