'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type {
  PriorityResults,
  PriorityTheme,
  ThemeVoices,
} from '@goodparty_org/contracts'
import {
  Badge,
  Button,
  cn,
  Progress,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@styleguide'
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  InfoIcon,
} from '@styleguide/components/ui/icons'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { RESULTS_COPY } from '../resultsCopy'
import {
  READ_STATUS_COPY,
  READ_PROGRESS_TONE,
  READ_STATUS_DOT,
  getAnswersHref,
  readPercent,
} from '../../readStatusCopy'
import { AnswerSeatsArc, AnswerSeatsLegend } from '../../components/AnswerSeats'
import { READ_STATUS_PROPERTY } from '../../readStatusProperty'
import { CivicPanelBloom } from 'app/dashboard/contacts/citizens-panel/components/CivicPanelBloom'
import { useServePlace } from 'app/dashboard/contacts/citizens-panel/managedPanelCopy'
import { PollThemeDetail } from 'app/dashboard/outreach/v2/poll/results/PollThemeDetail'
import { SERVE_POLL_RESULTS_COPY } from 'app/dashboard/outreach/v2/poll/results/pollResultsCopy'
import { RespondentHeatGrid } from './RespondentHeatGrid'
import {
  PriorityCommentsDownload,
  PriorityThemeComments,
} from './PriorityThemeComments'

const Section = ({
  title,
  caption,
  children,
}: {
  title: string
  caption?: string
  children: React.ReactNode
}) => (
  <section className="flex flex-col gap-3 rounded-xl border border-border bg-background p-5">
    <div>
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {caption && (
        <p className="mt-0.5 text-sm text-muted-foreground">{caption}</p>
      )}
    </div>
    {children}
  </section>
)

const Stat = ({
  label,
  value,
  detail,
}: {
  label: string
  value: number
  detail?: string | null
}) => (
  <div className="rounded-lg border border-border bg-background p-4">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
      {value.toLocaleString()}
    </p>
    {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
  </div>
)

export const PriorityResultsView = ({
  priorityId,
  title,
  results,
}: {
  priorityId: string
  title: string
  results: PriorityResults
}) => {
  const { respondents, readStatus } = results
  const [openTheme, setOpenTheme] = useState<PriorityTheme | null>(null)
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [openTheme])
  useEffect(() => {
    trackEvent(EVENTS.Priorities.ResultsViewed, {
      priorityId,
      heldBack: !readStatus.good,
      readStatus: READ_STATUS_PROPERTY[readStatus.status],
      answers: readStatus.answers,
      answersFloor: readStatus.needed,
      groupsHeard: readStatus.groupsHeard,
      groupsTotal: readStatus.groupsTotal,
      respondentCount: respondents.total,
      joinedCivicPanel: respondents.joinedCivicPanel,
      representationShown: results.groups.length > 0,
      ...(readStatus.good ? { themes: results.themes.length } : {}),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priorityId])
  if (openTheme && readStatus.good) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 lg:p-6">
        <PollThemeDetail
          title={openTheme.title}
          summary={openTheme.summary}
          count={RESULTS_COPY.people(openTheme.people)}
          onBack={() => setOpenTheme(null)}
          action={
            <PriorityCommentsDownload
              priorityId={priorityId}
              themeId={openTheme.id}
            />
          }
        >
          <PriorityThemeComments
            priorityId={priorityId}
            themeId={openTheme.id}
          />
        </PollThemeDetail>
      </div>
    )
  }
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 lg:p-6">
      <div className="flex flex-col gap-1">
        <Link
          href={`/dashboard/priorities/${encodeURIComponent(priorityId)}`}
          className="flex items-center gap-1 text-sm text-muted-foreground no-underline hover:underline"
        >
          <ArrowLeftIcon className="size-4" aria-hidden />
          {RESULTS_COPY.backToPriority}
        </Link>
        <h1 className="text-xl font-semibold text-foreground">
          {RESULTS_COPY.pageTitle(title)}
        </h1>
        <p className="text-sm text-muted-foreground">{RESULTS_COPY.caption}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat
          label={RESULTS_COPY.answered}
          value={respondents.total}
          detail={RESULTS_COPY.byChannel(respondents.byChannel)}
        />
        <Stat
          label={RESULTS_COPY.joinedPanel}
          value={respondents.joinedCivicPanel}
        />
      </div>

      {readStatus.good ? (
        <HeardSections
          priorityId={priorityId}
          results={results}
          onOpenTheme={setOpenTheme}
        />
      ) : (
        <section
          data-testid="results-held-back"
          className="flex flex-col gap-3 rounded-xl border border-border bg-background p-5"
        >
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <span
              aria-hidden
              className={`size-2 shrink-0 rounded-full ${READ_STATUS_DOT[readStatus.status]}`}
            />
            {READ_STATUS_COPY.label(readStatus)}
          </h2>
          {readStatus.groupsTotal > 0 ? (
            <div className="flex flex-col gap-2 lg:items-center">
              {/* Seats on a computer, the bar below lg, by CSS alone so the
                  card never jumps. */}
              <AnswerSeatsArc
                readStatus={readStatus}
                className="hidden max-w-80 lg:block"
              />
              <AnswerSeatsLegend
                readStatus={readStatus}
                className="hidden justify-center lg:flex"
              />
              <p className="text-sm font-semibold text-foreground">
                {READ_STATUS_COPY.progress(readStatus)}.
              </p>
              <Progress
                value={readPercent(readStatus)}
                aria-label={READ_STATUS_COPY.progress(readStatus)}
                className={cn(
                  'h-2 lg:hidden',
                  READ_PROGRESS_TONE[readStatus.status],
                )}
              />
            </div>
          ) : null}
          <p className="text-sm text-muted-foreground">
            {READ_STATUS_COPY.heldBack(readStatus)}
          </p>
          {readStatus.checkOut && READ_STATUS_COPY.namesGroups(readStatus) ? (
            <p className="text-sm text-foreground">
              {readStatus.status === 'gettingClose'
                ? READ_STATUS_COPY.statusLine(readStatus)
                : READ_STATUS_COPY.stillNeed(readStatus)}
            </p>
          ) : null}
          {READ_STATUS_COPY.canGetAnswers(readStatus) ? (
            <Button asChild size="small" className="self-start rounded-full">
              <Link href={getAnswersHref(priorityId)}>
                {READ_STATUS_COPY.getAnswers}
              </Link>
            </Button>
          ) : null}
        </section>
      )}
    </div>
  )
}

const SIGNAL_TONE: Record<ThemeVoices, string> = {
  strong: 'bg-success-background text-success-dark',
  fair: 'bg-warning-background text-warning-dark',
  thin: 'bg-error-background text-error-dark',
}

// openOnClick so the meaning is one tap away on a phone, not hover only.
const ThemeSignal = ({ voices }: { voices: ThemeVoices }) => {
  const place = useServePlace()
  const label = RESULTS_COPY.signal[voices]
  return (
    <div className="mt-1 flex items-center gap-1">
      <Badge className={SIGNAL_TONE[voices]}>{label}</Badge>
      <Tooltip openOnClick>
        <TooltipTrigger
          aria-label={RESULTS_COPY.signalInfo(label)}
          className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <InfoIcon className="size-4" aria-hidden />
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          {RESULTS_COPY.signalMeaning(place)[voices]}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

// Themes, the map and the census comparison: only once the answers are
// enough to say what the community thinks.
const HeardSections = ({
  priorityId,
  results,
  onOpenTheme,
}: {
  priorityId: string
  results: PriorityResults
  onOpenTheme: (theme: PriorityTheme) => void
}) => (
  <>
    <Section
      title={RESULTS_COPY.themesTitle}
      caption={
        results.themes.length > 0 ? RESULTS_COPY.themesCaption : undefined
      }
    >
      {results.summarizing && results.themes.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {RESULTS_COPY.themesUpdating}
        </p>
      )}
      {results.themes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {results.summarizing
            ? RESULTS_COPY.themesProcessing
            : RESULTS_COPY.themesEmpty}
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {results.themes.map((theme, index) => (
            <li
              key={theme.id}
              className="flex gap-3 rounded-lg border border-border p-4"
            >
              <div
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-info-background text-sm font-semibold text-foreground"
                aria-label={RESULTS_COPY.themeRank(index + 1)}
              >
                #{index + 1}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-semibold text-foreground">
                    {theme.title}
                  </h3>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {RESULTS_COPY.people(theme.people)}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{theme.summary}</p>
                {theme.voices && <ThemeSignal voices={theme.voices} />}
                <div className="mt-2 flex justify-end">
                  <Button type="button" onClick={() => onOpenTheme(theme)}>
                    {SERVE_POLL_RESULTS_COPY.viewResponses}
                    <ChevronRightIcon aria-hidden />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {results.themes.length > 0 && (
        <div>
          <PriorityCommentsDownload priorityId={priorityId} />
        </div>
      )}
    </Section>

    <Section
      title={RESULTS_COPY.mapTitle}
      caption={results.points.length > 0 ? RESULTS_COPY.mapCaption : undefined}
    >
      {results.points.length === 0 ? (
        <p className="text-sm text-muted-foreground">{RESULTS_COPY.mapEmpty}</p>
      ) : (
        <RespondentHeatGrid points={results.points} />
      )}
    </Section>

    <Section title={RESULTS_COPY.representationTitle}>
      {results.groups.length > 0 ? (
        <CivicPanelBloom
          groups={results.groups.map(
            ({ group, districtShare, answerShare }) => ({
              group,
              districtShare,
              memberShare: answerShare,
            }),
          )}
          showNext={false}
          summary={RESULTS_COPY.groupsSummary}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          {RESULTS_COPY.representationUnavailable}
        </p>
      )}
    </Section>
  </>
)
