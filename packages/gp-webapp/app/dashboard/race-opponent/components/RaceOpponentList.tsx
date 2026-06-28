'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, cn } from '@styleguide'
import {
  CheckCircleIcon,
  CircleIcon,
  ExternalLinkIcon,
  Loader2Icon,
  RefreshIcon,
  SearchIcon,
  XCircleIcon,
} from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'
import { useSnackbar } from 'helpers/useSnackbar'
import type {
  RaceOpponentItem,
  RaceOpponentResponse,
  RaceOpponentSummary,
  RaceOpponentSummaryKeyPosition,
  RaceOpponentSummarySection,
  RaceOpponentSummarySourceRef,
} from 'gpApi/api-endpoints'
import type { RaceOpponentSourceType } from '@goodparty_org/contracts'
import OpponentSection from './OpponentSection'
import SourceAttribution from './SourceAttribution'

const SOURCE_TYPE_LABELS: Record<RaceOpponentSourceType, string> = {
  ballotpedia: 'Ballotpedia',
  opponent_website: 'Opponent website',
  campaign_plan_db: 'Campaign plan',
}

type CollectionStatus = RaceOpponentResponse['collectionStatus']

type StatusDescriptor = {
  label: string
  Icon: typeof CircleIcon
  // Container tone classes for the styled indicator pill.
  className: string
  spin?: boolean
}

const STATUS_DESCRIPTORS: Record<CollectionStatus, StatusDescriptor> = {
  idle: {
    label: 'Idle',
    Icon: CircleIcon,
    className: 'bg-muted text-muted-foreground border-border',
  },
  discovering: {
    label: 'Discovering opponents',
    Icon: SearchIcon,
    className: 'bg-info-50 text-info-600 border-info-600/20',
    spin: false,
  },
  running: {
    label: 'Running',
    Icon: Loader2Icon,
    className: 'bg-info-50 text-info-600 border-info-600/20',
    spin: true,
  },
  completed: {
    label: 'Completed',
    Icon: CheckCircleIcon,
    className: 'bg-success-light text-success-dark border-success/20',
  },
  failed: {
    label: 'Failed',
    Icon: XCircleIcon,
    className: 'bg-destructive/10 text-destructive border-destructive/20',
  },
}

const CollectionStatusIndicator = ({
  status,
}: {
  status: CollectionStatus
}): React.JSX.Element => {
  const { label, Icon, className, spin } = STATUS_DESCRIPTORS[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        className,
      )}
    >
      <Icon
        className={cn('size-3.5 shrink-0', spin && 'animate-spin')}
        aria-hidden
      />
      {label}
    </span>
  )
}

const formatTimestamp = (iso: string | null): string => {
  if (!iso) {
    return 'never'
  }
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? 'never' : date.toLocaleString()
}

// Renders the source citations attached to a summary section/item. The contract
// guarantees sources.min(1), so this always has at least one to show.
const SummarySources = ({
  sources,
}: {
  sources: RaceOpponentSummarySourceRef[]
}): React.JSX.Element => (
  <div className="flex flex-col gap-1">
    {sources.map((source) => (
      <SourceAttribution
        key={`${source.sourceType}-${source.sourceUrl}`}
        sourceUrl={source.sourceUrl}
        sourceType={SOURCE_TYPE_LABELS[source.sourceType]}
        label={source.sourceUrl}
      />
    ))}
  </div>
)

const SummaryProseSection = ({
  heading,
  section,
}: {
  heading: string
  section: RaceOpponentSummarySection
}): React.JSX.Element => (
  <section className="flex w-full min-w-0 flex-col gap-2">
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {heading}
    </h3>
    <p className="w-full min-w-0 whitespace-pre-wrap break-words text-sm text-foreground">
      {section.text}
    </p>
    <SummarySources sources={section.sources} />
  </section>
)

const KeyPositionItem = ({
  position,
}: {
  position: RaceOpponentSummaryKeyPosition
}): React.JSX.Element => (
  <li className="flex w-full min-w-0 flex-col gap-1 rounded-md border border-border bg-card p-3">
    <span className="text-sm font-semibold text-foreground">
      {position.label}
    </span>
    <p className="w-full min-w-0 whitespace-pre-wrap break-words text-sm text-muted-foreground">
      {position.detail}
    </p>
    <SummarySources sources={position.sources} />
  </li>
)

const OpponentSummaryView = ({
  summary,
}: {
  summary: RaceOpponentSummary
}): React.JSX.Element => (
  <div className="flex w-full min-w-0 flex-col gap-5">
    {summary.overview && (
      <SummaryProseSection heading="Overview" section={summary.overview} />
    )}
    {summary.background && (
      <SummaryProseSection heading="Background" section={summary.background} />
    )}
    {summary.keyPositions.length > 0 && (
      <section className="flex w-full min-w-0 flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Key positions
        </h3>
        <ul className="flex w-full min-w-0 flex-col gap-2">
          {summary.keyPositions.map((position) => (
            <KeyPositionItem key={position.label} position={position} />
          ))}
        </ul>
      </section>
    )}
  </div>
)

const groupBySourceType = (
  items: RaceOpponentItem[],
): Array<{ sourceType: RaceOpponentSourceType; items: RaceOpponentItem[] }> => {
  const order: RaceOpponentSourceType[] = [
    'ballotpedia',
    'opponent_website',
    'campaign_plan_db',
  ]
  return order
    .map((sourceType) => ({
      sourceType,
      items: items.filter((item) => item.sourceType === sourceType),
    }))
    .filter((group) => group.items.length > 0)
}

// The as-collected payload is unstructured: a plain string for scraped text, or
// an object for structured sources. Render strings as prose and objects as
// readable key/value lines rather than a raw JSON blob.
const RawContent = ({ content }: { content: unknown }): React.JSX.Element => {
  if (typeof content === 'string') {
    return (
      <p className="w-full min-w-0 whitespace-pre-wrap break-words text-sm text-foreground">
        {content}
      </p>
    )
  }
  if (content && typeof content === 'object') {
    return (
      <dl className="flex w-full min-w-0 flex-col gap-1.5">
        {Object.entries(content).map(([key, value]) => (
          <div key={key} className="flex w-full min-w-0 flex-col gap-0.5">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {key}
            </dt>
            <dd className="w-full min-w-0 whitespace-pre-wrap break-words text-sm text-foreground">
              {typeof value === 'string' ? value : JSON.stringify(value)}
            </dd>
          </div>
        ))}
      </dl>
    )
  }
  return <p className="text-sm text-muted-foreground">No content collected.</p>
}

const RawSourceGroup = ({
  sourceType,
  items,
}: {
  sourceType: RaceOpponentSourceType
  items: RaceOpponentItem[]
}): React.JSX.Element => (
  <section className="flex w-full min-w-0 flex-col gap-2">
    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {SOURCE_TYPE_LABELS[sourceType]}
    </h4>
    {items.map((item) => (
      <div
        key={item.id}
        className="flex w-full min-w-0 flex-col gap-2 rounded-md border border-border bg-card p-3"
      >
        {item.sourceUrl ? (
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-semibold text-info-600 hover:underline"
          >
            <span className="break-all">{item.sourceUrl}</span>
            <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden />
          </a>
        ) : (
          <span className="text-sm text-muted-foreground">No source URL</span>
        )}
        <RawContent content={item.content} />
      </div>
    ))}
  </section>
)

const RawResearch = ({
  items,
}: {
  items: RaceOpponentItem[]
}): React.JSX.Element => (
  <div className="flex w-full min-w-0 flex-col gap-4">
    {groupBySourceType(items).map((group) => (
      <RawSourceGroup
        key={group.sourceType}
        sourceType={group.sourceType}
        items={group.items}
      />
    ))}
  </div>
)

// How often to poll status while discovery/collection is in flight.
const POLL_INTERVAL_MS = 5000

type Props = {
  initialData: RaceOpponentResponse
}

const RaceOpponentList = ({ initialData }: Props): React.JSX.Element => {
  const { errorSnackbar } = useSnackbar()
  const [data, setData] = useState<RaceOpponentResponse>(initialData)
  const [refreshing, setRefreshing] = useState(false)
  const [collecting, setCollecting] = useState(false)
  // Synchronous in-flight guard. `collecting` state is stale in the auto-fire
  // effect's closure and doesn't disable the button until React re-renders, so
  // the effect and a user click could both fire a (paid) collect. The ref is
  // set before the await, so any concurrent caller sees it immediately.
  const collectingRef = useRef(false)

  const loadStatus = useCallback(async (): Promise<void> => {
    const { data: latest } = await clientRequest(
      'GET /v1/campaigns/mine/race-opponent',
      {},
    )
    setData(latest)
  }, [])

  const refresh = async () => {
    setRefreshing(true)
    try {
      await loadStatus()
    } catch {
      errorSnackbar('Failed to refresh opponent data. Please try again.')
    } finally {
      setRefreshing(false)
    }
  }

  const collect = useCallback(async () => {
    if (collectingRef.current) return
    collectingRef.current = true
    setCollecting(true)
    try {
      const { data: result } = await clientRequest(
        'POST /v1/campaigns/mine/race-opponent/collect',
        {},
      )
      setData((prev) => ({
        ...prev,
        collectionStatus: result.status,
      }))
    } catch {
      errorSnackbar('Failed to start collection. Please try again.')
    } finally {
      collectingRef.current = false
      setCollecting(false)
    }
  }, [errorSnackbar])

  const status = data.collectionStatus

  // Two-call discovery: collect() dispatches opposition_research and returns
  // 'discovering'; the collection run is deferred until opponent names exist.
  // While discovery or collection is in flight, poll status. After a few
  // consecutive poll failures, stop and notify rather than silently spinning on
  // 'discovering' forever with the Collect button locked.
  useEffect(() => {
    if (status !== 'discovering' && status !== 'running') return
    let consecutiveErrors = 0
    const id = setInterval(() => {
      void loadStatus()
        .then(() => {
          consecutiveErrors = 0
        })
        .catch(() => {
          consecutiveErrors += 1
          if (consecutiveErrors >= 3) {
            clearInterval(id)
            errorSnackbar(
              'Lost contact with the server while checking status. Refresh to try again.',
            )
          }
        })
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [status, loadStatus, errorSnackbar])

  // When discovery succeeds (status goes 'discovering' -> 'idle'), auto-fire
  // collect once to dispatch the deferred collection run. This can't loop: a
  // FAILED discovery reports 'failed' (not 'idle'), so it never re-triggers
  // here; an uncontested race settles collect() to idle without re-dispatching;
  // and a successful discovery's completed run is never re-dispatched.
  const prevStatus = useRef(status)
  useEffect(() => {
    const wasDiscovering = prevStatus.current === 'discovering'
    prevStatus.current = status
    if (wasDiscovering && status === 'idle') {
      void collect()
    }
  }, [status, collect])

  // Discovery (opposition_research) and collection both keep the run busy, so
  // both disable a fresh Collect to avoid stacking paid runs.
  const isBusy = status === 'running' || status === 'discovering'

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-6 pb-28 pt-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
          <CollectionStatusIndicator status={data.collectionStatus} />
          {data.lastCollectedAt && (
            <span>Last collected {formatTimestamp(data.lastCollectedAt)}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={collect}
            disabled={collecting || isBusy}
            className="flex items-center gap-1.5"
          >
            <RefreshIcon className="size-4" aria-hidden />
            Collect now
          </Button>
          <Button
            variant="outline"
            onClick={refresh}
            disabled={refreshing}
            className="flex items-center gap-1.5"
          >
            <RefreshIcon className="size-4" aria-hidden />
            Refresh
          </Button>
        </div>
      </header>

      {data.opponents.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No opponent data collected yet. Click &quot;Collect now&quot; to
          start.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {data.opponents.map((opponent) => (
            <section
              key={opponent.opponentName}
              className="flex w-full min-w-0 flex-col gap-4"
            >
              <h2 className="text-base font-semibold text-foreground">
                {opponent.opponentName}
              </h2>

              {opponent.summary ? (
                <OpponentSummaryView summary={opponent.summary} />
              ) : (
                <RawResearch items={opponent.items} />
              )}

              {opponent.summary && opponent.items.length > 0 && (
                <OpponentSection
                  title="View source research"
                  defaultOpen={false}
                >
                  <RawResearch items={opponent.items} />
                </OpponentSection>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

export default RaceOpponentList
