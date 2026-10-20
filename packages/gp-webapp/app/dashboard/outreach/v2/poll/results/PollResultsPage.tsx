'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  OutreachDetail,
  PollExpansionSummary,
  PollResults,
} from '@goodparty_org/contracts'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  ArrowLeftIcon,
  Button,
  Card,
  CircleAlertIcon,
  InfoIcon,
  Loader2Icon,
  PlusIcon,
  ShieldCheckIcon,
  Spinner,
} from '@styleguide'
import Paper from '@shared/utils/Paper'
import DashboardLayout from 'app/dashboard/shared/DashboardLayout'
import { NAV_LABELS } from 'app/dashboard/shared/navLabels'
import { GatherMoreFlow } from '../gather/GatherMoreFlow'
import { PollCommentList } from './PollCommentList'
import { PollThemeDetail } from './PollThemeDetail'
import { PollThemeList } from './PollThemeList'
import { SERVE_POLL_RESULTS_COPY } from './pollResultsCopy'
import {
  pollDetailQueryOptions,
  pollHasSent,
  pollPhase,
  pollResultsQueryOptions,
  type ReplyScope,
} from './queries'

type View =
  | { kind: 'overview' }
  | {
      kind: 'replies'
      scope: ReplyScope
      title: string
      summary: string | null
      count: string
    }

// An expansion holds the next one off until it has been sent, which is the
// same rule gp-api applies when it refuses a second.
const OPEN_EXPANSION_STATUSES = ['pending_payment', 'pending', 'in_progress']

const percent = (fraction: number): string =>
  `${(fraction * 100).toFixed(1).replace(/\.0$/, '')}%`

const dateLabel = (value: Date | string | null): string | null => {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-xl font-semibold text-foreground">{value}</p>
  </div>
)

const StatsCard = ({ results }: { results: PollResults }) => (
  <Card className="grid grid-cols-2 gap-4 p-4 md:grid-cols-4">
    <Stat
      label={SERVE_POLL_RESULTS_COPY.stats.sent}
      value={results.sent.toLocaleString()}
    />
    <Stat
      label={SERVE_POLL_RESULTS_COPY.stats.responses}
      value={results.responses.toLocaleString()}
    />
    <Stat
      label={SERVE_POLL_RESULTS_COPY.stats.responseRate}
      value={percent(results.responseRate)}
    />
    <Stat
      label={SERVE_POLL_RESULTS_COPY.stats.optOutRate}
      value={percent(results.optOutRate)}
    />
  </Card>
)

const ExpansionsCard = ({
  expansions,
}: {
  expansions: PollExpansionSummary[]
}) => (
  <Card className="gap-2 p-4">
    <h2 className="font-medium text-foreground">
      {SERVE_POLL_RESULTS_COPY.expansionsTitle}
    </h2>
    <ul>
      {expansions.map((expansion) => (
        <li
          key={expansion.sendSeq}
          className="flex justify-between gap-4 py-1 text-sm"
        >
          <span className="text-foreground">
            {SERVE_POLL_RESULTS_COPY.expansionRow(expansion.textCount)}
          </span>
          <span className="text-muted-foreground">
            {SERVE_POLL_RESULTS_COPY.expansionStatus[expansion.status] ??
              SERVE_POLL_RESULTS_COPY.expansionStatusFallback}
          </span>
        </li>
      ))}
    </ul>
  </Card>
)

const GatherButton = ({
  onClick,
  variant,
}: {
  onClick: () => void
  variant?: 'outline'
}) => (
  <Button type="button" variant={variant} onClick={onClick}>
    <PlusIcon />
    {SERVE_POLL_RESULTS_COPY.gather}
  </Button>
)

const ResultsBody = ({
  outreachId,
  detail,
  results,
  onOpenView,
}: {
  outreachId: number
  detail: OutreachDetail
  results: PollResults
  onOpenView: (view: View) => void
}) => {
  const [gatherOpen, setGatherOpen] = useState(false)
  const queryClient = useQueryClient()
  const phase = pollPhase(detail.status)
  const canGather =
    !results.expansions.some((expansion) =>
      OPEN_EXPANSION_STATUSES.includes(expansion.status),
    ) &&
    (phase === 'in_progress' || phase === 'done')
  const gather = (
    <GatherMoreFlow
      open={gatherOpen}
      onClose={() => setGatherOpen(false)}
      outreachId={outreachId}
      sent={results.sent}
      responses={results.responses}
      onPaid={() =>
        queryClient.invalidateQueries({ queryKey: ['poll-results'] })
      }
    />
  )
  const gatherButton = canGather ? (
    <GatherButton onClick={() => setGatherOpen(true)} />
  ) : null
  const analysis = results.analysis.status
  const grouped = results.themes.length > 0

  return (
    <>
      {phase === 'in_progress' && (
        <Alert
          variant="info"
          icon={<Loader2Icon className="size-4 animate-spin" />}
        >
          <AlertTitle>{SERVE_POLL_RESULTS_COPY.inProgress.title}</AlertTitle>
          <AlertDescription>
            {SERVE_POLL_RESULTS_COPY.inProgress.body}
          </AlertDescription>
        </Alert>
      )}
      <StatsCard results={results} />
      {results.notEnoughResponses ? (
        <Alert
          variant="destructive"
          icon={<CircleAlertIcon className="size-4" />}
        >
          <AlertTitle>{SERVE_POLL_RESULTS_COPY.notEnough.title}</AlertTitle>
          <AlertDescription>
            <p>{SERVE_POLL_RESULTS_COPY.notEnough.body}</p>
            {gatherButton && <div className="mt-3">{gatherButton}</div>}
          </AlertDescription>
        </Alert>
      ) : results.isHighConfidence ? (
        <Alert variant="success" icon={<ShieldCheckIcon className="size-4" />}>
          <AlertTitle>
            {SERVE_POLL_RESULTS_COPY.confidenceHigh.title}
          </AlertTitle>
          <AlertDescription>
            {SERVE_POLL_RESULTS_COPY.confidenceHigh.body}
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="info" icon={<InfoIcon className="size-4" />}>
          <AlertTitle>{SERVE_POLL_RESULTS_COPY.confidenceLow.title}</AlertTitle>
          <AlertDescription>
            <p>{SERVE_POLL_RESULTS_COPY.confidenceLow.body}</p>
            {gatherButton && <div className="mt-3">{gatherButton}</div>}
          </AlertDescription>
        </Alert>
      )}
      {results.expansions.length > 0 && (
        <ExpansionsCard expansions={results.expansions} />
      )}
      {!results.notEnoughResponses && analysis === 'running' && !grouped && (
        <Alert
          variant="info"
          icon={<Loader2Icon className="size-4 animate-spin" />}
        >
          <AlertTitle>{SERVE_POLL_RESULTS_COPY.analyzing.title}</AlertTitle>
          <AlertDescription>
            {SERVE_POLL_RESULTS_COPY.analyzing.body}
          </AlertDescription>
        </Alert>
      )}
      {!results.notEnoughResponses && analysis === 'failed' && (
        <Alert
          variant="destructive"
          icon={<CircleAlertIcon className="size-4" />}
        >
          <AlertDescription>
            {SERVE_POLL_RESULTS_COPY.analysisFailed}
          </AlertDescription>
        </Alert>
      )}
      {!results.notEnoughResponses && grouped && (
        <PollThemeList
          themes={results.themes}
          nonClusteredCount={results.nonClustered.count}
          onOpenTheme={(theme) =>
            onOpenView({
              kind: 'replies',
              scope: { kind: 'theme', themeId: theme.id },
              title: theme.label,
              summary: theme.summary,
              count: SERVE_POLL_RESULTS_COPY.mentions(theme.mentionCount),
            })
          }
          onOpenNonClustered={() =>
            onOpenView({
              kind: 'replies',
              scope: { kind: 'nonClustered' },
              title: SERVE_POLL_RESULTS_COPY.nonClustered.title,
              summary: SERVE_POLL_RESULTS_COPY.nonClustered.body,
              count: SERVE_POLL_RESULTS_COPY.nonClustered.count(
                results.nonClustered.count,
              ),
            })
          }
        />
      )}
      {!results.notEnoughResponses && !grouped && analysis !== 'running' && (
        <PollCommentList outreachId={outreachId} scope={{ kind: 'all' }} />
      )}
      {gather}
    </>
  )
}

const MessageCard = ({ message }: { message: string }) => (
  <Card className="gap-1 p-4">
    <h2 className="text-sm font-medium text-muted-foreground">
      {SERVE_POLL_RESULTS_COPY.messageTitle}
    </h2>
    <p className="whitespace-pre-line text-sm text-foreground">{message}</p>
  </Card>
)

const PhaseAlert = ({ detail }: { detail: OutreachDetail }) => {
  const phase = pollPhase(detail.status)
  const when = dateLabel(detail.date)
  if (phase === 'review') {
    return (
      <Alert variant="default" icon={<InfoIcon className="size-4" />}>
        <AlertTitle>{SERVE_POLL_RESULTS_COPY.review.title}</AlertTitle>
        <AlertDescription>
          {SERVE_POLL_RESULTS_COPY.review.body(when)}
        </AlertDescription>
      </Alert>
    )
  }
  if (phase === 'scheduled') {
    return (
      <Alert variant="default" icon={<InfoIcon className="size-4" />}>
        <AlertTitle>{SERVE_POLL_RESULTS_COPY.scheduled.title}</AlertTitle>
        <AlertDescription>
          {SERVE_POLL_RESULTS_COPY.scheduled.body(when)}
        </AlertDescription>
      </Alert>
    )
  }
  if (phase === 'closed') {
    const text =
      detail.status === 'denied'
        ? SERVE_POLL_RESULTS_COPY.closed.denied
        : detail.status === 'canceled'
          ? SERVE_POLL_RESULTS_COPY.closed.canceled
          : SERVE_POLL_RESULTS_COPY.closed.failed
    return (
      <Alert
        variant="destructive"
        icon={<CircleAlertIcon className="size-4" />}
      >
        <AlertDescription>{text}</AlertDescription>
      </Alert>
    )
  }
  return null
}

export const PollResultsPage = ({ outreachId }: { outreachId: number }) => {
  const detailQuery = useQuery(pollDetailQueryOptions(outreachId))
  const detail = detailQuery.data
  const status = detail?.status ?? null
  const resultsQuery = useQuery({
    ...pollResultsQueryOptions(outreachId, status),
    enabled: detail !== undefined && pollHasSent(status),
  })
  const results = resultsQuery.data
  const [view, setView] = useState<View>({ kind: 'overview' })

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [view])

  const failed =
    detailQuery.isError ||
    (detail !== undefined && pollHasSent(status) && resultsQuery.isError)
  const ready =
    detail !== undefined && (!pollHasSent(status) || results !== undefined)

  return (
    <DashboardLayout
      pathname="/dashboard/constituent-outreach"
      showAlert={false}
      navHeader={{ icon: 'megaphone', label: NAV_LABELS.constituentOutreach }}
    >
      <Paper className="min-h-full">
        {view.kind === 'replies' && ready ? (
          <PollThemeDetail
            outreachId={outreachId}
            scope={view.scope}
            title={view.title}
            summary={view.summary}
            count={view.count}
            onBack={() => setView({ kind: 'overview' })}
          />
        ) : (
          <div className="flex flex-col gap-6">
            <Link
              href="/dashboard/constituent-outreach"
              className="inline-flex w-fit items-center gap-2 text-sm text-foreground underline-offset-4 hover:underline"
            >
              <ArrowLeftIcon size={16} />
              {SERVE_POLL_RESULTS_COPY.back}
            </Link>
            {failed ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>
                  {SERVE_POLL_RESULTS_COPY.loadFailed}
                </AlertDescription>
              </Alert>
            ) : ready && detail ? (
              <>
                <h1 className="text-2xl font-semibold text-foreground">
                  {detail.name ?? SERVE_POLL_RESULTS_COPY.untitled}
                </h1>
                <PhaseAlert detail={detail} />
                {results && pollHasSent(status) && (
                  <ResultsBody
                    outreachId={outreachId}
                    detail={detail}
                    results={results}
                    onOpenView={setView}
                  />
                )}
                {detail.message && <MessageCard message={detail.message} />}
              </>
            ) : (
              <div className="flex items-center justify-center gap-3 py-20">
                <Spinner />
                <p className="text-base text-foreground">
                  {SERVE_POLL_RESULTS_COPY.loading}
                </p>
              </div>
            )}
          </div>
        )}
      </Paper>
    </DashboardLayout>
  )
}
