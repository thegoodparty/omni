'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  cn,
} from '@styleguide'
import {
  CheckCircleIcon,
  CircleIcon,
  ExternalLinkIcon,
  InfoIcon,
  Loader2Icon,
  RefreshIcon,
  SearchIcon,
  SwordsIcon,
  TriangleAlertIcon,
  XCircleIcon,
} from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useCampaign } from '@shared/hooks/useCampaign'
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
import OpponentPageHeader from './OpponentPageHeader'
import OpponentOverviewCard from './OpponentOverviewCard'
import SourceAttribution from './SourceAttribution'
import IssueContrastCard from './IssueContrastCard'
import OpponentResearchProgress from './OpponentResearchProgress'
import AddOpponentsForm from './AddOpponentsForm'
import type { ManualOpponentInput } from './AddOpponentsForm'

const initialsFor = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?'

// The opponent whose panel opens by default: the primary threat (the Lovable
// design opens it on load), else the first. '' when there are none.
const defaultOpenFor = (opponents: RaceOpponentResponse['opponents']): string =>
  opponents.find((opponent) => opponent.threatTier === 'primary_threat')
    ?.opponentName ??
  opponents[0]?.opponentName ??
  ''

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

// Phase 3: the "why they matter most" callout, a tinted info block shown under
// the opponent header. Hidden when the analysis has no whyTheyMatter.
const WhyTheyMatterCallout = ({
  text,
}: {
  text: string
}): React.JSX.Element => (
  <section className="flex w-full min-w-0 flex-col gap-1 rounded-md border border-info-600/20 bg-info-50 p-4">
    <h3 className="text-xs font-semibold uppercase tracking-wide text-info-600">
      Why they matter most
    </h3>
    <p className="w-full min-w-0 whitespace-pre-wrap break-words text-sm text-foreground">
      {text}
    </p>
  </section>
)

// Phase 3: the "what you need to know" takeaways list, with an item count in
// the section header. Hidden when the list is empty/absent.
const WhatYouNeedToKnow = ({
  items,
}: {
  items: string[]
}): React.JSX.Element => (
  <OpponentSection
    title="What you need to know"
    icon={<InfoIcon className="size-4" aria-hidden />}
    meta={`${items.length} ${items.length === 1 ? 'item' : 'items'}`}
  >
    <ul className="flex w-full min-w-0 list-none flex-col gap-2">
      {items.map((item) => (
        <li
          key={item}
          className="flex w-full min-w-0 items-start gap-2 text-sm text-foreground"
        >
          <span
            className="mt-1.5 size-1.5 shrink-0 rounded-full bg-info-600"
            aria-hidden
          />
          <span className="w-full min-w-0 break-words">{item}</span>
        </li>
      ))}
    </ul>
  </OpponentSection>
)

// Phase 3: the "where they're soft" vulnerability list, with an openings count.
// Relaxed sourcing — an item renders whether or not it carries a source. Hidden
// when there are no items.
const WhereTheySoft = ({
  items,
}: {
  items: NonNullable<RaceOpponentSummary['whereSoft']>
}): React.JSX.Element => (
  <OpponentSection
    title="Where they're soft"
    icon={<TriangleAlertIcon className="size-4" aria-hidden />}
    meta={`${items.length} ${items.length === 1 ? 'opening' : 'openings'}`}
  >
    <ul className="flex w-full min-w-0 list-none flex-col gap-3">
      {items.map((item) => (
        <li
          key={item.text}
          className="flex w-full min-w-0 flex-col gap-1 rounded-md border border-border bg-card p-3"
        >
          <p className="w-full min-w-0 whitespace-pre-wrap break-words text-sm text-foreground">
            {item.text}
          </p>
          {item.sources && item.sources.length > 0 && (
            <SummarySources sources={item.sources} />
          )}
        </li>
      ))}
    </ul>
  </OpponentSection>
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
    {summary.whyTheyMatter && (
      <WhyTheyMatterCallout text={summary.whyTheyMatter} />
    )}
    {summary.whatYouNeedToKnow && summary.whatYouNeedToKnow.length > 0 && (
      <WhatYouNeedToKnow items={summary.whatYouNeedToKnow} />
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
    {summary.whereSoft && summary.whereSoft.length > 0 && (
      <WhereTheySoft items={summary.whereSoft} />
    )}
    {summary.issueContrasts && summary.issueContrasts.length > 0 && (
      <section className="flex w-full min-w-0 flex-col gap-3">
        <div className="flex w-full min-w-0 flex-col gap-1">
          <h3 className="text-base font-semibold text-foreground">
            Where you contrast
          </h3>
          <p className="text-sm text-muted-foreground">
            How your positions differ from theirs on the issues voters care
            about.
          </p>
        </div>
        {summary.issueContrasts.map((contrast) => (
          <IssueContrastCard key={contrast.issue} contrast={contrast} />
        ))}
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

// The expanded detail for an opponent, rendered inline inside its accordion
// panel. Identity (avatar, name, party/incumbency, threat tier) lives in the
// accordion trigger row, so this body omits a header and shows only the
// structured summary (or readable raw-text fallback), with the raw scrape tucked
// into a collapsible when a summary exists.
const OpponentDetailBody = ({
  opponent,
}: {
  opponent: RaceOpponentResponse['opponents'][number]
}): React.JSX.Element => (
  <div className="flex w-full min-w-0 flex-col gap-5 pt-1">
    {opponent.summary ? (
      <OpponentSummaryView summary={opponent.summary} />
    ) : (
      <RawResearch items={opponent.items} />
    )}

    {opponent.summary && opponent.items.length > 0 && (
      <OpponentSection title="View source research" defaultOpen={false}>
        <RawResearch items={opponent.items} />
      </OpponentSection>
    )}
  </div>
)

// How often to poll status while discovery/collection is in flight.
const POLL_INTERVAL_MS = 5000

// How long to hold the "report is ready" terminal state after the real run
// completes, before revealing the report. A brief beat so the snap to ready is
// visible rather than an abrupt jump from step 4 to the report.
const READY_HOLD_MS = 1500

// Deadline for the collect POST. The processing screen treats an in-flight
// collect as "still running" (idleMidRun), and the status poll is paused during
// that window, so a collect that never resolves would trap the user on the
// progress screen with no escape. Bounding it lets the catch/finally fire,
// resetting `collecting` so the screen gives way and the error surfaces.
const COLLECT_TIMEOUT_MS = 30_000

type Props = {
  initialData: RaceOpponentResponse
  raceContext?: string
}

const RaceOpponentList = ({
  initialData,
  raceContext,
}: Props): React.JSX.Element => {
  const { errorSnackbar } = useSnackbar()
  const [data, setData] = useState<RaceOpponentResponse>(initialData)
  const [refreshing, setRefreshing] = useState(false)
  const [collecting, setCollecting] = useState(false)
  // Synchronous in-flight guard. `collecting` state is stale in the auto-fire
  // effect's closure and doesn't disable the button until React re-renders, so
  // the effect and a user click could both fire a (paid) collect. The ref is
  // set before the await, so any concurrent caller sees it immediately.
  const collectingRef = useRef(false)
  // Which opponent's accordion panel is open. '' means all collapsed, so the
  // user can close the open panel by clicking its row (type=single +
  // collapsible). Opens the primary threat by default (Lovable opens it on load).
  const [openName, setOpenName] = useState<string>(() =>
    defaultOpenFor(initialData.opponents),
  )

  const [campaign] = useCampaign()

  // One-shot auto-open for the empty -> populated transition (e.g. a fresh
  // Collect that polls in the first opponents): open the default once when data
  // first arrives. Guarded so it never re-opens after the user collapses.
  const autoOpenedRef = useRef(initialData.opponents.length > 0)
  useEffect(() => {
    if (autoOpenedRef.current || data.opponents.length === 0) return
    autoOpenedRef.current = true
    setOpenName(defaultOpenFor(data.opponents))
  }, [data.opponents])

  // Fire one Opponent Profile Viewed per distinct opponent panel opened. The ref
  // set dedups so re-opening an already-viewed opponent doesn't re-fire; closing
  // a panel (openName === '') fires nothing.
  const viewedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!openName || viewedRef.current.has(openName)) return
    viewedRef.current.add(openName)
    trackEvent(EVENTS.RaceOpponent.OpponentProfileViewed, {
      campaignId: campaign?.id,
    })
  }, [openName, campaign?.id])

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
    let deadlineId: ReturnType<typeof setTimeout> | undefined
    try {
      const deadline = new Promise<never>((_, reject) => {
        deadlineId = setTimeout(
          () => reject(new Error('collect timed out')),
          COLLECT_TIMEOUT_MS,
        )
      })
      const { data: result } = await Promise.race([
        clientRequest('POST /v1/campaigns/mine/race-opponent/collect', {}),
        deadline,
      ])
      setData((prev) => ({
        ...prev,
        collectionStatus: result.status,
      }))
    } catch {
      errorSnackbar('Failed to start collection. Please try again.')
      // The POST may have reached the server and started a run before the
      // client deadline fired, leaving collectionStatus stale at 'idle'. Re-sync
      // from the server so the poll re-activates on a real 'running' rather than
      // dropping to the list view where a second click double-dispatches a run.
      // A failed re-sync is non-actionable here — the collect failure already
      // surfaced — so the snackbar isn't fired twice. If the re-sync ITSELF fails
      // (transient network as the deadline fired), one delayed retry recovers it;
      // dropping both would strand the user exactly as the re-sync was added to
      // prevent.
      void loadStatus().catch(() => {
        setTimeout(
          () => void loadStatus().catch(() => undefined),
          POLL_INTERVAL_MS,
        )
      })
    } finally {
      clearTimeout(deadlineId)
      collectingRef.current = false
      setCollecting(false)
    }
  }, [errorSnackbar, loadStatus])

  const [submittingManual, setSubmittingManual] = useState(false)
  // Synchronous in-flight guard, mirroring collectingRef: setSubmittingManual
  // only disables the button after a re-render, so two rapid clicks could both
  // fire a (paid) manual run before React repaints. The ref is set before the
  // await, so the second synchronous call sees it and bails immediately.
  const submittingManualRef = useRef(false)

  const submitManualOpponents = useCallback(
    async (opponents: ManualOpponentInput[]) => {
      if (submittingManualRef.current) return
      submittingManualRef.current = true
      setSubmittingManual(true)
      try {
        const { data: result } = await clientRequest(
          'POST /v1/campaigns/mine/race-opponent/opponents/manual',
          { opponents },
        )
        // The candidate hand-entered the field — the activation moment the
        // empty-state form exists to drive. Fired here (not on the status
        // transition) so the count reflects what they submitted; the run-start
        // event below is the separate "a run began" signal.
        trackEvent(EVENTS.RaceOpponent.OpponentsManuallyAdded, {
          campaignId: campaign?.id,
          opponentCount: opponents.length,
        })
        setData((prev) => ({
          ...prev,
          collectionStatus: result.status,
        }))
      } catch {
        errorSnackbar('Failed to start the analysis. Please try again.')
      } finally {
        submittingManualRef.current = false
        setSubmittingManual(false)
      }
    },
    [errorSnackbar, campaign?.id],
  )

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

  // Two-call discovery briefly reports 'idle' between discovery finishing and
  // the auto-fired collect flipping the run to 'running'. Treating that gap as
  // not-processing would flicker the screen out to the empty/report view and
  // snap back. The gap is exactly the window where the auto-fired collect is
  // pending or in flight, so key "idle still processing" off that — NOT a sticky
  // session flag, which would also wedge the screen when collect legitimately
  // settles to a terminal 'idle' (uncontested/unavailable race, where no
  // collection run is dispatched). `justLeftDiscovery` covers the one render
  // before the auto-fire effect flips `collecting` on; `collecting` covers the
  // in-flight collect. A brand-new 'idle' user (never discovered, never
  // collecting) stays out of the processing screen.
  const justLeftDiscovery = prevStatus.current === 'discovering'
  const idleMidRun = status === 'idle' && (justLeftDiscovery || collecting)
  const isProcessing = isBusy || idleMidRun

  // Fire one Opponent Research Started per run, keyed off isProcessing (not the
  // raw busy status) so the transient idle-mid-run gap of the two-call discovery
  // flow doesn't release the guard and re-fire. One ref-guarded fire covers
  // every entry point — Collect (idle -> discovering -> running), manual submit
  // (-> running), and the auto-fired collection after discovery — counting the
  // whole run once. The guard releases only when the run truly settles
  // (completed/failed/idle with no in-flight collect), so a later run fires
  // again. Seeded from initialData so a page that loads mid-run (reload, or a
  // just-upgraded candidate whose run is already in flight) does NOT fire — only
  // a start observed in THIS session counts; otherwise every mid-run reload
  // would over-count the event.
  const researchStartedRef = useRef(
    initialData.collectionStatus === 'running' ||
      initialData.collectionStatus === 'discovering',
  )
  useEffect(() => {
    if (isProcessing && !researchStartedRef.current) {
      researchStartedRef.current = true
      trackEvent(EVENTS.RaceOpponent.ResearchStarted, {
        campaignId: campaign?.id,
      })
    } else if (!isProcessing) {
      researchStartedRef.current = false
    }
  }, [isProcessing, campaign?.id])

  // While the real run is processing, show the cosmetic 4-step progress screen
  // instead of the bare empty/status row. The steps advance on their own timer
  // (inside OpponentResearchProgress) and are decoupled from this real status —
  // the timer only drives the label/counter; this real status decides when to
  // leave the screen, so a fast fake timer can't transition before data lands.
  //
  // On the processing -> completed transition, hold the progress screen in its
  // "ready" terminal state briefly so the user sees it snap to "report is ready"
  // before the report (or, for zero opponents, ENG-10609's manual form) replaces
  // it.
  //
  // The hold is latched in state on the render where 'completed' first lands
  // after a real run (prevProcessing was true), using the "store previous value
  // in state, update during render" pattern. That detection is pure render
  // logic with no ref mutation, so it is Strict-Mode safe — the double-invoked
  // setup/cleanup of the dismissal timer below re-arms the same timer rather
  // than skipping the hold, and the latch stays set across re-renders until the
  // timer dismisses it.
  const [readyHold, setReadyHold] = useState(false)
  const [prevProcessing, setPrevProcessing] = useState(isProcessing)
  if (prevProcessing !== isProcessing) {
    setPrevProcessing(isProcessing)
    if (prevProcessing && !isProcessing && status === 'completed') {
      setReadyHold(true)
    }
  }
  useEffect(() => {
    if (!readyHold) return
    const id = setTimeout(() => setReadyHold(false), READY_HOLD_MS)
    return () => clearTimeout(id)
  }, [readyHold])

  // Page-state precedence ladder (flag-off and !isPro are resolved upstream in
  // page.tsx, so by here the candidate is flag-on + Pro). This component owns
  // the remaining four states, in strict precedence:
  //   1. processing  — a run is in flight (running/discovering, or the
  //      transient idle-mid-run gap). Checked FIRST so a just-upgraded
  //      candidate with an in-flight run paints the progress screen on first
  //      render, never flickering through the empty/manual state below.
  //   2. report      — opponents.length > 0 (the accordion of findings).
  //   3. manual form — settled completed with zero opponents (ran, found none).
  //   4. failed / idle prompts — the remaining settled-empty branches.
  // readyHold piggybacks on (1) to hold the "ready" terminal beat before the
  // report or manual form takes over.
  if (isProcessing || readyHold) {
    return (
      <>
        <div className="border-b border-border bg-background">
          <div className="mx-auto w-full max-w-[1120px] px-6 py-5">
            <OpponentPageHeader
              title="Know your opponent"
              raceContext={raceContext}
            />
          </div>
        </div>
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-6 pb-28 pt-6">
          <OpponentResearchProgress ready={readyHold} />
        </div>
      </>
    )
  }

  return (
    <>
      {/* Full-bleed white header band (title + race context + Export brief),
          matching the Lovable design; the dev controls and the field sit below
          on the gray content background. */}
      <div className="border-b border-border bg-background">
        <div className="mx-auto w-full max-w-[1120px] px-6 py-5">
          <OpponentPageHeader
            title="Know your opponent"
            raceContext={raceContext}
            actions={
              <Button
                variant="outline"
                disabled
                title="Export brief — coming soon"
              >
                Export brief
              </Button>
            }
          />
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-6 pb-28 pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
            <CollectionStatusIndicator status={data.collectionStatus} />
            {data.lastCollectedAt && (
              <span>
                Last collected {formatTimestamp(data.lastCollectedAt)}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={collect}
              disabled={collecting || isBusy || submittingManual}
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
        </div>

        {data.opponents.length === 0 ? (
          // No opponents yet — the branch depends on collection status. A run in
          // flight (running/discovering/idle-mid-run) is handled above by the
          // processing screen early return, so this block only reaches the
          // settled states: a failed run shows a failure/retry message;
          // completed-with-zero is the "we ran it and found nobody" case, so the
          // form acknowledges the prior run (ranAlready) and gates a fresh submit
          // behind a disclosure rather than inviting indefinite (paid) re-runs;
          // idle/never-run prompts to start collection. The full status
          // state-machine is ENG-10611.
          status === 'failed' ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-destructive/20 bg-destructive/10 px-6 py-12 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <TriangleAlertIcon className="size-6" aria-hidden />
              </span>
              <div className="flex flex-col gap-1">
                <h2 className="text-base font-semibold text-foreground">
                  Collection failed
                </h2>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Something went wrong gathering research on your race. Use
                  &quot;Collect now&quot; above to try again.
                </p>
              </div>
            </div>
          ) : status === 'completed' ? (
            <AddOpponentsForm
              submitting={submittingManual || collecting}
              onSubmit={submitManualOpponents}
              ranAlready
            />
          ) : (
            // idle / never-run: no collection has fired yet, so don't claim "no
            // opponents found" — prompt the candidate to start collection.
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-12 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <SwordsIcon className="size-6" aria-hidden />
              </span>
              <div className="flex flex-col gap-1">
                <h2 className="text-base font-semibold text-foreground">
                  No opponent research yet
                </h2>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Hit &quot;Collect now&quot; to gather sourced research on the
                  candidates in your race.
                </p>
              </div>
            </div>
          )
        ) : (
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <SwordsIcon className="size-3.5 shrink-0" aria-hidden />
                The field
              </span>
              <h2 className="text-lg font-semibold text-foreground">
                {data.opponents.length}{' '}
                {data.opponents.length === 1 ? 'candidate' : 'candidates'} filed
                for this seat
              </h2>
              <p className="text-sm text-muted-foreground">
                Focus on the candidate most likely to take votes from you.
                Usually the incumbent or a party-backed challenger.
              </p>
            </div>
            {/* type=single + collapsible: one opponent open at a time, and
                clicking the open row collapses it. Opens the primary threat by
                default (see openName + the auto-open effect). */}
            <Accordion
              type="single"
              collapsible
              value={openName}
              onValueChange={setOpenName}
              aria-label="Select an opponent to view their research"
              className="flex flex-col gap-3"
            >
              {data.opponents.map((opponent) => (
                <AccordionItem
                  key={opponent.opponentName}
                  value={opponent.opponentName}
                  className={cn(
                    'rounded-lg border border-border bg-card px-4 transition last:border-b',
                    'hover:border-info-600/40',
                    'data-[state=open]:border-info-600 data-[state=open]:ring-1 data-[state=open]:ring-info-600/20',
                    // Emphasize the primary threat (Lovable highlights it). The
                    // open-state variants are re-specified for the destructive
                    // emphasis, or the unconditional data-[state=open]:*-info-600
                    // rules above win and the highlight vanishes when open.
                    opponent.threatTier === 'primary_threat' &&
                      'border-destructive/40 ring-1 ring-destructive/20 hover:border-destructive/60 data-[state=open]:border-destructive data-[state=open]:ring-destructive/20',
                  )}
                >
                  <AccordionTrigger className="items-center hover:no-underline focus-visible:no-underline">
                    <OpponentOverviewCard
                      name={opponent.opponentName}
                      initials={initialsFor(opponent.opponentName)}
                      party={opponent.party}
                      isIncumbent={opponent.isIncumbent}
                      threatTier={opponent.threatTier}
                    />
                  </AccordionTrigger>
                  <AccordionContent className="border-t border-border">
                    <OpponentDetailBody opponent={opponent} />
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>
        )}
      </div>
    </>
  )
}

export default RaceOpponentList
