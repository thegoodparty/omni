'use client'

import { useEffect, useState } from 'react'
import { Badge, Button, Skeleton, cn } from '@styleguide'
import {
  CircleAlertIcon,
  CircleCheckIcon,
  LoaderCircleIcon,
  RefreshIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from '@styleguide/components/ui/icons'
import type {
  Ordinance,
  OrdinanceQualityCheck,
  OrdinanceQualityCheckStatus,
} from '@goodparty_org/contracts'
import {
  fetchOrdinanceBySlug,
  generateQualityReport,
} from '../data/ordinances-api'
import SourceLine from './SourceLine'

type StatusMeta = {
  label: string
  pillClass: string
  Icon: typeof CircleCheckIcon
}

const STATUS_META: Record<OrdinanceQualityCheckStatus, StatusMeta> = {
  pass: {
    label: 'Pass',
    pillClass: 'border-success/40 bg-success/10 text-success-dark',
    Icon: CircleCheckIcon,
  },
  flag: {
    label: 'Flag',
    pillClass: 'border-destructive/40 bg-destructive/10 text-destructive-dark',
    Icon: TriangleAlertIcon,
  },
  attention: {
    label: 'Attention',
    pillClass: 'border-warning/40 bg-warning/10 text-warning-dark',
    Icon: CircleAlertIcon,
  },
}

// A slim chat about the draft is offered per finding: clicking "Discuss" opens
// the review chat seeded with the finding, so the user can act on it.
export default function QualityReport({
  slug,
  onDiscussFinding,
}: {
  slug: string
  onDiscussFinding: (check: OrdinanceQualityCheck) => void
}): React.JSX.Element {
  const [ordinance, setOrdinance] = useState<Ordinance | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchOrdinanceBySlug(slug)
      .then((o) => {
        if (!cancelled) setOrdinance(o)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the quality report.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  const report = ordinance?.qualityReport ?? null

  const run = async (): Promise<void> => {
    setRunning(true)
    setError(null)
    try {
      setOrdinance(await generateQualityReport(slug))
    } catch {
      setError('Could not run the quality checks. Please try again.')
    } finally {
      setRunning(false)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-6">
        <Skeleton className="h-6 w-48" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  if (!report) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col items-start gap-3 p-6">
        <h2 className="text-base font-semibold text-foreground">
          Quality report
        </h2>
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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-base font-semibold text-foreground">
          Reviewed by {report.checks.length} checks
        </h2>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{report.tally.pass} pass</span>
          <span>·</span>
          <span>{report.tally.flag} flag</span>
          <span>·</span>
          <span>{report.tally.attention} attention</span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="small"
          onClick={run}
          disabled={running}
          className="ml-auto gap-1.5 rounded-full text-sm"
        >
          {running ? (
            <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <RefreshIcon className="size-3.5" aria-hidden />
          )}
          {running ? 'Reviewing…' : 'Re-run'}
        </Button>
      </div>

      {report.stale ? (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-dark">
          The draft changed since this report ran. Re-run to refresh it.
        </p>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-col gap-3">
        {report.checks.map((check) => {
          const meta = STATUS_META[check.status]
          return (
            <div
              key={check.id}
              className="flex flex-col gap-2 rounded-lg border border-border p-4"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">
                  {check.label}
                </span>
                <Badge
                  className={cn(
                    'gap-1 rounded-full border text-xs',
                    meta.pillClass,
                  )}
                >
                  <meta.Icon className="size-3.5" aria-hidden />
                  {meta.label}
                </Badge>
              </div>
              <p className="text-sm text-foreground">{check.note}</p>
              {check.source ? <SourceLine source={check.source} /> : null}
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="small"
                  onClick={() => onDiscussFinding(check)}
                  className="gap-1.5 rounded-full text-sm"
                >
                  <SparklesIcon className="size-3.5" aria-hidden />
                  Discuss
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
