'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import type { PriorityResults } from '@goodparty_org/contracts'
import { Button, cn, Progress } from '@styleguide'
import { ArrowLeftIcon } from '@styleguide/components/ui/icons'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { RESULTS_COPY } from '../resultsCopy'
import {
  READ_STATUS_COPY,
  READ_PROGRESS_TONE,
  READ_STATUS_DOT,
  getAnswersHref,
  readPercent,
} from '../../readStatusCopy'
import { READ_STATUS_PROPERTY } from '../../readStatusProperty'
import { CivicPanelBloom } from 'app/dashboard/contacts/citizens-panel/components/CivicPanelBloom'
import { RespondentHeatGrid } from './RespondentHeatGrid'

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
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priorityId])
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
        <HeardSections results={results} />
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
            <>
              <p className="text-sm text-foreground">
                {READ_STATUS_COPY.progress(readStatus)}
              </p>
              <Progress
                value={readPercent(readStatus)}
                aria-label={READ_STATUS_COPY.progress(readStatus)}
                className={cn('h-2', READ_PROGRESS_TONE[readStatus.status])}
              />
            </>
          ) : null}
          <p className="text-sm text-muted-foreground">
            {readStatus.status === 'gettingClose'
              ? READ_STATUS_COPY.unsureGroups
              : READ_STATUS_COPY.missingGroups}
          </p>
          {readStatus.underrepresented.length > 0 ? (
            <div data-testid="results-hear-from-more">
              <h3 className="text-sm font-semibold text-foreground">
                {READ_STATUS_COPY.hearFromMoreHeading}
              </h3>
              <ul className="mt-1 list-disc pl-5 text-sm text-foreground">
                {readStatus.underrepresented.map((group) => (
                  <li key={group}>
                    {READ_STATUS_COPY.groupName(group, readStatus)}
                  </li>
                ))}
              </ul>
            </div>
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

// Themes, the map and the census comparison: only once the answers are
// enough to say what the community thinks.
const HeardSections = ({ results }: { results: PriorityResults }) => (
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
        <div className="flex flex-col gap-3">
          {results.themes.map((theme) => (
            <div
              key={theme.id}
              className="flex flex-col gap-1 rounded-lg border border-border p-4"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">
                  {theme.title}
                </h3>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {RESULTS_COPY.people(theme.people)}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">{theme.summary}</p>
            </div>
          ))}
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
