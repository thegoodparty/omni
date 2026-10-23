'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowRightIcon, Skeleton } from '@styleguide'
import { useOrganization } from '@shared/organization-picker'
import { useServeCitizenPanelsFlag } from '@shared/experiments/serveCitizenPanelsFlag'
import { useContactsTable } from '../../crm/ContactsTableProvider'
import {
  civicPanelHref,
  SERVE_CITIZENS_PANEL_COPY as COPY,
} from '../citizensPanelCopy'
import { civicPanelSummaryQueryOptions } from '../civicPanelSummary.query'
import { CitizensPanelEmpty, CitizensPanelStats } from './CitizensPanelStats'
import { CivicPanelSeats } from './CivicPanelSeats'

export const CitizensPanelSection = () => {
  const { isWinContext, isWinContextReady } = useContactsTable()
  const flag = useServeCitizenPanelsFlag()
  const orgSlug = useOrganization()?.slug
  const show = isWinContextReady && !isWinContext && flag.ready && flag.enabled

  const query = useQuery({
    ...civicPanelSummaryQueryOptions(orgSlug),
    enabled: show && Boolean(orgSlug),
  })

  if (!show) return null

  // The same seats the panel page draws, from the same summary read.
  const composition = query.data?.composition ?? null
  // Like the panel page, no seats before anyone joins.
  const hasMembers = (query.data?.members ?? 0) > 0

  const body =
    query.status === 'pending' ? (
      <Skeleton
        className="h-40 w-full rounded-lg"
        data-testid="citizens-panel-loading"
      />
    ) : query.status === 'error' ? (
      <p className="text-sm text-muted-foreground">{COPY.loadError}</p>
    ) : query.data.members === 0 ? (
      <CitizensPanelEmpty />
    ) : (
      <>
        <CitizensPanelStats summary={query.data} />
        <Link
          href={civicPanelHref('contacts')}
          className="flex items-center gap-1 self-start text-sm font-semibold text-link no-underline hover:underline"
        >
          {COPY.seePanel}
          <ArrowRightIcon className="size-4" aria-hidden />
        </Link>
      </>
    )

  return (
    <section className="flex flex-col gap-4" aria-labelledby="citizens-panel">
      <div>
        <h2 id="citizens-panel" className="text-lg font-semibold">
          {COPY.title}
        </h2>
        <p className="text-sm text-muted-foreground">{COPY.caption}</p>
      </div>
      {hasMembers && composition && composition.places.length > 0 ? (
        <CivicPanelSeats
          placeKind={composition.placeKind}
          places={composition.places}
          members={query.data?.progress.members ?? 0}
          goal={query.data?.progress.goal ?? 0}
        />
      ) : null}
      {body}
    </section>
  )
}
