'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  IconButton,
  cn,
} from '@styleguide'
import {
  DownloadIcon,
  ExternalLinkIcon,
  RefreshIcon,
  TriangleAlertIcon,
} from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useCampaign } from '@shared/hooks/useCampaign'
import type {
  RaceOpponentItem,
  RaceOpponentResponse,
  RaceOpponentSummary,
  RaceOpponentSummarySection,
} from 'gpApi/api-endpoints'
import type { RaceOpponentSourceType } from '@goodparty_org/contracts'
import DashboardNavHeaderAction from '../../shared/DashboardNavHeaderAction'
import OpponentOverviewCard from './OpponentOverviewCard'
import SourceRow from './SourceRow'
import OpponentResearchProgress from './OpponentResearchProgress'
import AddOpponentsForm from './AddOpponentsForm'
import type { ManualOpponentInput } from './AddOpponentsForm'
import { downloadOpponentBriefsPdf } from '../pdf/downloadOpponentBriefPdf'
import StandoutActionsSection from './StandoutActionsSection'

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

// The overview section (no heading, per the Lovable design): the opponent's
// overview prose, then an optional "Campaign website" link, then its
// citations. Background no longer merges in here — it's its own flat section
// below (see DetailSection usages in OpponentSummaryView).
const OverviewSection = ({
  overview,
  websiteUrl,
}: {
  overview: RaceOpponentSummarySection
  websiteUrl?: string | null
}): React.JSX.Element => {
  // websiteUrl is not always a full URL: gp-api's GET falls back to the roster
  // hint, which the manual-entry path persists as a bare apex domain (e.g.
  // 'janerival.com'). A schemeless href renders as a relative link and
  // navigates in-app to a 404, so prepend a scheme when one is missing.
  const websiteHref =
    websiteUrl && !/^https?:\/\//.test(websiteUrl)
      ? `https://${websiteUrl}`
      : websiteUrl
  return (
    <section className="flex w-full min-w-0 flex-col gap-2">
      <p className="w-full min-w-0 whitespace-pre-wrap break-words text-sm text-foreground">
        {overview.text}
      </p>
      {websiteHref && (
        <a
          href={websiteHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-info hover:underline"
        >
          <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden />
          Campaign website
        </a>
      )}
      <SourceRow sources={overview.sources} />
    </section>
  )
}

// A flat detail section: an uppercase blue label plus its body. Card v2
// (ENG-10635) drops the nested accordion/collapsible structure the detail body
// used to have — every section here is a plain stack, no
// Accordion/Collapsible inside.
const DetailSection = ({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element => (
  <section className="flex w-full min-w-0 flex-col gap-2">
    <h3 className="text-xs font-bold uppercase tracking-wide text-primary">
      {label}
    </h3>
    {children}
  </section>
)

// The four v2 sections, each rendered only when its data is present
// (sourced-or-silent) — a legacy-only summary (no whyTheyreRunning/
// issuesThatMatter) falls back to just overview + background.
const OpponentSummaryView = ({
  summary,
  websiteUrl,
}: {
  summary: RaceOpponentSummary
  websiteUrl?: string | null
}): React.JSX.Element => (
  <div className="flex w-full min-w-0 flex-col gap-6">
    {summary.overview && (
      <OverviewSection overview={summary.overview} websiteUrl={websiteUrl} />
    )}
    {summary.whyTheyreRunning && (
      <DetailSection label="Why they're running">
        <p className="w-full min-w-0 whitespace-pre-wrap break-words text-sm text-foreground">
          {summary.whyTheyreRunning.text}
        </p>
      </DetailSection>
    )}
    {summary.background && (
      <DetailSection label="Their background">
        <p className="w-full min-w-0 whitespace-pre-wrap break-words text-sm text-foreground">
          {summary.background.text}
        </p>
        <SourceRow sources={summary.background.sources} />
      </DetailSection>
    )}
    {summary.issuesThatMatter && (
      <DetailSection label="Issues that matter most to them">
        <ul className="mt-2 space-y-2 text-sm text-foreground">
          {summary.issuesThatMatter.items.map((item, index) => (
            <li
              key={`${item}-${index}`}
              className="list-disc list-outside ml-5"
            >
              {item}
            </li>
          ))}
        </ul>
        <SourceRow sources={summary.issuesThatMatter.sources} />
      </DetailSection>
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
}): React.JSX.Element => {
  // A rostered opponent (from campaign_strategy_opponent, seeded by discovery
  // or the manual-entry form) can be surfaced with no collected rows and no
  // structured summary when the collection agent found no public sources
  // (ENG-10893). Render a placeholder so the expanded card is not visually
  // empty and matches the Executive Summary's inclusion of the same opponent.
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        We haven&apos;t found public info on this opponent yet.
      </p>
    )
  }
  return (
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
}

// The expanded detail for an opponent, rendered inline inside its accordion
// panel. Identity (avatar, name, party/incumbency, threat tier) lives in the
// accordion trigger row, so this body omits a header and shows only the
// structured summary (or a readable raw-text fallback when no summary exists).
// Card v2 (ENG-10635): flat sections, no nested Accordion/Collapsible.
const OpponentDetailBody = ({
  opponent,
}: {
  opponent: RaceOpponentResponse['opponents'][number]
}): React.JSX.Element => (
  <div className="flex w-full min-w-0 flex-col gap-6 p-4 md:p-6">
    {opponent.summary ? (
      <OpponentSummaryView
        summary={opponent.summary}
        websiteUrl={opponent.websiteUrl}
      />
    ) : (
      <RawResearch items={opponent.items ?? []} />
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
  // Office/district + election date — feeds the PDF export header.
  raceContext?: string
  // Office/district only — feeds the field-header subtitle.
  racePlace?: string
}

const RaceOpponentList = ({
  initialData,
  raceContext,
  racePlace,
}: Props): React.JSX.Element => {
  const { errorSnackbar } = useSnackbar()
  const [data, setData] = useState<RaceOpponentResponse>(initialData)
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

  // Export the on-screen briefs to a PDF (one section per opponent that has a
  // structured summary).
  const [exporting, setExporting] = useState(false)
  // Synchronous in-flight guard, mirroring collectingRef: setExporting only
  // disables the button after a re-render, so two rapid clicks could both fire
  // before React repaints. The ref is set before the await, so the second
  // synchronous call sees it and bails immediately.
  const exportingRef = useRef(false)
  const hasExportableBrief = data.opponents.some((opponent) => opponent.summary)
  const exportBriefs = useCallback(async () => {
    if (exportingRef.current) return
    exportingRef.current = true
    setExporting(true)
    try {
      await downloadOpponentBriefsPdf(data.opponents, raceContext)
    } catch {
      errorSnackbar('Failed to export the brief. Please try again.')
    } finally {
      exportingRef.current = false
      setExporting(false)
    }
  }, [data.opponents, raceContext, errorSnackbar])

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

  // Discovery (opposition_research) and collection both keep the run busy.
  const isBusy = status === 'running' || status === 'discovering'

  // A Pro user reaches this page with the agent never having run (idle + no
  // prior collection) when the pro-upgrade auto-dispatch didn't fire — e.g. a
  // legacy Pro who upgraded before that shipped. Rather than a manual "start"
  // prompt, kick off the agentic flow automatically and drop them on the
  // processing screen. `/collect` is idempotent against the server-side discovery
  // marker: for an already-discovered uncontested race (also idle +
  // lastCollectedAt null) it returns idle WITHOUT dispatching a fresh paid run,
  // so firing this blind can't stack paid runs. Ref-guarded to once per mount so
  // an uncontested race that settles back to idle can't re-fire into a loop.
  //
  // Seeded true for ANY non-idle initial status: non-idle means a run already
  // ran or is running (never-ran is idle-only), so the auto-start must stay
  // disarmed. Otherwise a manual action from a non-idle state (the failed card's
  // "Try again", or a manual-form submit) that resolves to a terminal `idle`
  // (the uncontested server path patches only collectionStatus, leaving
  // lastCollectedAt null) would flip `neverRan` true with the guard down and
  // fire a second (paid) collect().
  const neverRan = status === 'idle' && data.lastCollectedAt === null
  const autoStartedRef = useRef(initialData.collectionStatus !== 'idle')
  useEffect(() => {
    if (autoStartedRef.current || !neverRan) return
    autoStartedRef.current = true
    void collect()
  }, [neverRan, collect])

  // Two-call discovery briefly reports 'idle' between discovery finishing and the
  // auto-fired collect flipping the run to 'running'; treating that gap as
  // not-processing would flicker the screen out and snap back. `justLeftDiscovery`
  // covers the one render before the auto-fire effect flips `collecting` on;
  // `collecting` covers the in-flight collect. `autoStartPending` extends the same
  // idea to the initial mount: hold the processing screen while the never-ran
  // auto-start is pending/in flight so a fresh Pro user never flashes the empty
  // state. Once auto-start has fired (ref set) and an uncontested race settles
  // back to idle, this drops so the manual form takes over — it does NOT wedge on
  // a terminal idle.
  const justLeftDiscovery = prevStatus.current === 'discovering'
  const autoStartPending = neverRan && !autoStartedRef.current
  const idleMidRun = status === 'idle' && (justLeftDiscovery || collecting)
  const isProcessing = isBusy || idleMidRun || autoStartPending
  // Analytics-only variant: the run-start event must fire only once a run is
  // SERVER-confirmed — status is discovering/running (isBusy), or the transient
  // post-discovery idle gap (justLeftDiscovery) where the auto-fired collect is
  // flipping to running. It deliberately EXCLUDES both autoStartPending (the
  // pre-dispatch render) and the bare `collecting` window (the auto-start POST in
  // flight while status is still idle): those cover collects that may fail or
  // return a terminal idle (uncontested race) WITHOUT a run ever starting. Firing
  // during that window would count a run that never began — and if the collect
  // then fails, the guard resets and a later manual submit re-counts it.
  const isConfirmedProcessing =
    isBusy || (status === 'idle' && justLeftDiscovery)

  // Fire one Opponent Research Started per run, keyed off isConfirmedProcessing
  // (not the raw busy status) so the transient idle-mid-run gap of the two-call
  // discovery flow doesn't release the guard and re-fire. One ref-guarded fire covers
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
    if (isConfirmedProcessing && !researchStartedRef.current) {
      researchStartedRef.current = true
      trackEvent(EVENTS.RaceOpponent.ResearchStarted, {
        campaignId: campaign?.id,
      })
    } else if (!isConfirmedProcessing) {
      researchStartedRef.current = false
    }
  }, [isConfirmedProcessing, campaign?.id])

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
    return <OpponentResearchProgress ready={readyHold} />
  }

  return (
    <div className="mx-auto flex w-full max-w-[608px] flex-col gap-6 pb-28">
      {data.opponents.length === 0 ? (
        // No opponents and not processing — a run in flight (incl. the never-ran
        // auto-start and the idle-mid-run gap) is handled above by the processing
        // screen early return, so this block only reaches the SETTLED-empty
        // states. A failed run shows a retry card; every other settled-empty case
        // (completed-with-zero, or an uncontested race that ran discovery and
        // settled back to idle) means "we looked and found nobody", so the
        // manual-entry form is shown directly for the candidate to add opponents
        // by hand. The full status state-machine is ENG-10611.
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
                Something went wrong gathering research on your race.
              </p>
            </div>
            <Button
              onClick={collect}
              disabled={collecting || isBusy}
              icon={<RefreshIcon className="size-4" aria-hidden />}
            >
              Try again
            </Button>
          </div>
        ) : (
          <AddOpponentsForm
            submitting={submittingManual || collecting}
            onSubmit={submitManualOpponents}
          />
        )
      ) : (
        <section className="flex flex-col gap-3">
          {/* The page's primary action, so it sits top right in the title bar
              (DashboardLayout's navHeader) rather than beside the field header
              — the same place Voter Data puts its primary action. Sized
              !h-8/!w-8 to clear the bar's fixed h-14. */}
          <DashboardNavHeaderAction>
            <IconButton
              variant="outline"
              className="!h-8 !w-8"
              onClick={exportBriefs}
              disabled={!hasExportableBrief || exporting}
              aria-label="Export brief"
            >
              <DownloadIcon className="h-4 w-4" aria-hidden />
            </IconButton>
          </DashboardNavHeaderAction>
          <div className="flex flex-col gap-0.5">
            <h2 className="text-lg font-semibold text-foreground">
              {data.opponents.length}{' '}
              {data.opponents.length === 1 ? 'candidate' : 'candidates'} filed
              for this seat
            </h2>
            <p className="text-sm text-muted-foreground">
              We identified and ranked every candidate running{' '}
              {racePlace ? <>for {racePlace}</> : 'in your race'}.
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
                  'overflow-hidden rounded-xl border bg-card transition-all',
                  'data-[state=closed]:border-border data-[state=closed]:hover:border-foreground/30',
                  'data-[state=open]:border-primary data-[state=open]:ring-2 data-[state=open]:ring-primary/30',
                )}
              >
                <AccordionTrigger className="items-center gap-3 px-3 py-2.5 hover:bg-muted/30 hover:no-underline focus-visible:no-underline md:px-4 md:py-3">
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
      {data.opponents.length > 0 && (
        <StandoutActionsSection standoutActions={data.standoutActions} />
      )}
    </div>
  )
}

export default RaceOpponentList
