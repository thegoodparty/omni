'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import {
  MIN_RESPONDENTS_FOR_REPRESENTATION,
  type CivicPanelRepresentation,
  type CivicPanelSummary,
} from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import { ArrowLeftIcon } from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'
import { RepresentationBars } from 'app/dashboard/priorities/[priorityId]/results/components/RepresentationBars'
import { CIVIC_PANEL_FILTER_KEY } from '../../crm/shared/recommendedListFilters.config'
import { SERVE_CITIZENS_PANEL_COPY as COPY } from '../citizensPanelCopy'
import { CitizensPanelEmpty, CitizensPanelStats } from './CitizensPanelStats'

// Reuses the panel list this button saved before, so pressing it twice never
// leaves two copies in the lists index.
const findOrCreatePanelList = async (): Promise<number> => {
  const { data: lists } = await clientRequest(
    'GET /v1/voters/voter-file/filters',
    {},
  )
  const existing = lists.find(
    (list) =>
      list.name === COPY.listName && list[CIVIC_PANEL_FILTER_KEY] === true,
  )
  if (existing) return existing.id
  const { data: created } = await clientRequest(
    'POST /v1/voters/voter-file/filter',
    { name: COPY.listName, [CIVIC_PANEL_FILTER_KEY]: true },
  )
  return created.id
}

export const CitizensPanelView = ({
  summary,
  representation,
}: {
  summary: CivicPanelSummary
  // Null when the comparison could not be read; its own `representation` is
  // null below the minimum number of members.
  representation: CivicPanelRepresentation | null
}) => {
  const router = useRouter()
  const seeMembers = useMutation({
    mutationFn: findOrCreatePanelList,
    onSuccess: (listId) => router.push(`/dashboard/contacts/lists/${listId}`),
  })
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
          <div className="flex flex-col gap-2">
            <Button
              className="self-start"
              loading={seeMembers.isPending || seeMembers.isSuccess}
              onClick={() => seeMembers.mutate()}
            >
              {COPY.seeMembers}
            </Button>
            {seeMembers.isError && (
              <p className="text-sm text-destructive">{COPY.seeMembersError}</p>
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
                {COPY.representationEmpty(MIN_RESPONDENTS_FOR_REPRESENTATION)}
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
