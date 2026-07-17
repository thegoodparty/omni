'use client'

import { useQuery } from '@tanstack/react-query'
import { Card } from '@styleguide'
import { numberFormatter } from 'helpers/numberHelper'
import { districtStatsQueryOptions } from 'app/dashboard/polls/shared/queries'

interface DistrictStatCardProps {
  label: string
}

// ENG-10721 (locked-prototype parity): the "Total voters/constituents in
// your district" stat card on crm/CrmContactsPage.tsx. Reuses the exact
// GET /v1/contacts/stats query the legacy ContactsStatsSection.tsx already
// fetches (districtStatsQueryOptions, keyed 'contacts-stats') — no new
// endpoint. Split into its own component (rather than inlined in
// CrmContactsPage) so page-level tests that don't care about this fetch can
// mock it away, matching how ContactTypeahead/PersonOverlay/CreateListWizard
// are already mocked there.
export default function DistrictStatCard({ label }: DistrictStatCardProps) {
  const query = useQuery(districtStatsQueryOptions)

  return (
    <Card className="w-full max-w-sm p-4">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium text-muted-foreground">
          {label}
        </span>
        {/* React Query v5's `isLoading` is `isPending && isFetching` — on the
            very first synchronous render `isFetching` is still false, so
            `isLoading` reads false too and this would briefly paint
            numberFormatter(undefined ?? 0) = '0' before the fetch even
            starts. `status !== 'success'` covers pending AND error, so the
            skeleton (not a bogus zero) shows until data actually resolves;
            the error branch below still renders "Unavailable" once
            status flips to 'error'. Same guard ContactsStatsSection.tsx
            uses for this identical query. */}
        {query.status !== 'success' ? (
          query.isError ? (
            <span className="text-xl font-semibold">Unavailable</span>
          ) : (
            <div className="h-6 w-16 animate-pulse rounded bg-muted" />
          )
        ) : (
          <span className="text-xl font-semibold">
            {numberFormatter(query.data.totalConstituents)}
          </span>
        )}
      </div>
    </Card>
  )
}
