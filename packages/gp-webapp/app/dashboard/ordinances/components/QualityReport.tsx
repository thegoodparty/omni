'use client'

import { useState } from 'react'
import { Badge, Button, cn } from '@styleguide'
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
} from '@goodparty_org/contracts'
import { extractApiErrorInfo } from 'helpers/extractApiErrorInfo'
import { generateQualityReport } from '../data/ordinances-api'
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
  draftDirty,
  onReran,
  onDiscussFinding,
  onBeforeRun,
}: {
  slug: string
  initialReport: OrdinanceQualityReport | null
  draftDirty: boolean
  onReran: () => void
  onDiscussFinding: (check: OrdinanceQualityCheck) => void
  // Flush any pending draft edits (awaited) before the report is generated, so
  // the LLM grades the just-saved text rather than the stale DB copy.
  onBeforeRun?: () => Promise<void>
}): React.JSX.Element {
  const [report, setReport] = useState(initialReport)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (): Promise<void> => {
    setRunning(true)
    setError(null)
    try {
      await onBeforeRun?.()
      const updated = await generateQualityReport(slug)
      // A 2xx with a null report shouldn't happen (the endpoint always saves
      // one). If it does, keep any report already on screen rather than wiping
      // the user's visible results, and say so plainly so the shown report and
      // the error don't read as contradictory.
      if (!updated.qualityReport) {
        setError(
          report
            ? 'The re-run did not return an updated report, so the one below' +
                ' is unchanged. Please try again.'
            : 'The quality report was not returned. Please try again.',
        )
        return
      }
      setReport(updated.qualityReport)
      onReran()
    } catch (err) {
      setError(runErrorMessage(err))
    } finally {
      setRunning(false)
    }
  }

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
        <Button
          type="button"
          onClick={run}
          disabled={running}
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
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status="pass">{report.tally.pass} pass</StatusPill>
            <StatusPill status="flag">{report.tally.flag} flag</StatusPill>
            <StatusPill status="attention">
              {report.tally.attention} attention
            </StatusPill>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="small"
          onClick={run}
          disabled={running}
          aria-label="Re-run quality checks"
          className="ml-auto gap-1.5 rounded-full text-sm"
        >
          {running ? (
            <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <RefreshIcon className="size-3.5" aria-hidden />
          )}
          Re-run
        </Button>
      </div>

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
    </div>
  )
}
