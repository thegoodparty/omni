'use client'

import Link from 'next/link'
import {
  MIN_RESPONDENTS_FOR_REPRESENTATION,
  type PriorityResults,
} from '@goodparty_org/contracts'
import { ArrowLeftIcon } from '@styleguide/components/ui/icons'
import { RESULTS_COPY } from '../resultsCopy'
import { RepresentationBars } from './RepresentationBars'
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
  const { respondents } = results
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

      <Section
        title={RESULTS_COPY.themesTitle}
        caption={
          results.themes.length > 0 ? RESULTS_COPY.themesCaption : undefined
        }
      >
        {results.summarizing && (
          <p className="text-xs text-muted-foreground">
            {RESULTS_COPY.themesUpdating}
          </p>
        )}
        {results.themes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {RESULTS_COPY.themesEmpty}
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
        caption={
          results.points.length > 0 ? RESULTS_COPY.mapCaption : undefined
        }
      >
        {results.points.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {RESULTS_COPY.mapEmpty}
          </p>
        ) : (
          <RespondentHeatGrid points={results.points} />
        )}
      </Section>

      <Section
        title={RESULTS_COPY.representationTitle}
        caption={
          results.representation
            ? RESULTS_COPY.representationCaption
            : undefined
        }
      >
        {results.representation ? (
          <RepresentationBars representation={results.representation} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {RESULTS_COPY.representationEmpty(
              MIN_RESPONDENTS_FOR_REPRESENTATION,
            )}
          </p>
        )}
      </Section>
    </div>
  )
}
