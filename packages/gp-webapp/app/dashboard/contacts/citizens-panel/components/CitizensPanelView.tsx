'use client'

import Link from 'next/link'
import {
  MIN_RESPONDENTS_FOR_REPRESENTATION,
  type CivicPanelRepresentation,
  type CivicPanelSummary,
} from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import { ArrowLeftIcon } from '@styleguide/components/ui/icons'
import { RepresentationBars } from 'app/dashboard/priorities/[priorityId]/results/components/RepresentationBars'
import {
  CITIZENS_PANEL_LIST_PATH,
  SERVE_CITIZENS_PANEL_COPY as COPY,
} from '../citizensPanelCopy'
import { CitizensPanelEmpty, CitizensPanelStats } from './CitizensPanelStats'
import { newListHref } from '../../crm/wizard/newListPresets'

export const CitizensPanelView = ({
  summary,
  representation,
}: {
  summary: CivicPanelSummary
  // Null when the comparison could not be read; its own `representation` is
  // null below the minimum number of members.
  representation: CivicPanelRepresentation | null
}) => {
  const hasMembers = summary.members > 0

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 lg:p-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/dashboard/contacts"
          className="flex items-center gap-1 text-sm text-muted-foreground no-underline hover:underline"
        >
          <ArrowLeftIcon className="size-4" aria-hidden />
          {COPY.backToContacts}
        </Link>
        <h1 className="text-xl font-semibold text-foreground">{COPY.title}</h1>
        <p className="text-sm text-muted-foreground">
          {hasMembers ? COPY.pageCaption : COPY.caption}
        </p>
      </div>

      {hasMembers ? (
        <>
          <CitizensPanelStats summary={summary} />
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href={CITIZENS_PANEL_LIST_PATH}>{COPY.seeMembers}</Link>
            </Button>
            {summary.askableNow > 0 && (
              <Button asChild variant="outline">
                <Link href={newListHref('askableNow')}>
                  {COPY.askableNowList}
                </Link>
              </Button>
            )}
          </div>
          <section className="flex flex-col gap-3 rounded-xl border border-border bg-background p-5">
            <div>
              <h2 className="text-base font-semibold text-foreground">
                {COPY.representationTitle}
              </h2>
              {representation?.representation && (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {COPY.representationCaption}
                </p>
              )}
            </div>
            {representation === null ? (
              <p className="text-sm text-muted-foreground">
                {COPY.representationError}
              </p>
            ) : representation.representation ? (
              <RepresentationBars
                representation={representation.representation}
                shares={COPY.shares}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {summary.members < MIN_RESPONDENTS_FOR_REPRESENTATION
                  ? COPY.representationEmpty(MIN_RESPONDENTS_FOR_REPRESENTATION)
                  : COPY.representationUnmapped}
              </p>
            )}
          </section>
        </>
      ) : (
        <CitizensPanelEmpty />
      )}
    </div>
  )
}
