'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowRightIcon, Skeleton } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import { useServeCitizenPanelsFlag } from '@shared/experiments/serveCitizenPanelsFlag'
import { useContactsTable } from '../../crm/ContactsTableProvider'
import {
  CITIZENS_PANEL_PATH,
  SERVE_CITIZENS_PANEL_COPY as COPY,
} from '../citizensPanelCopy'
import { CitizensPanelEmpty, CitizensPanelStats } from './CitizensPanelStats'

export const CitizensPanelSection = () => {
  const { isWinContext, isWinContextReady } = useContactsTable()
  const flag = useServeCitizenPanelsFlag()
  const orgSlug = useOrganization()?.slug
  const show = isWinContextReady && !isWinContext && flag.ready && flag.enabled

  const query = useQuery({
    queryKey: ['civic-panel-summary', orgSlug],
    queryFn: async () => {
      const { data } = await clientRequest('GET /v1/contacts/civic-panel', {})
      return data
    },
    enabled: show && Boolean(orgSlug),
  })

  if (!show) return null

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
          href={CITIZENS_PANEL_PATH}
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
      {body}
    </section>
  )
}
