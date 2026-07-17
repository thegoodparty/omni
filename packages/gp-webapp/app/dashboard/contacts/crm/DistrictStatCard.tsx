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
        {query.isLoading ? (
          <div className="h-6 w-16 animate-pulse rounded bg-muted" />
        ) : (
          <span className="text-xl font-semibold">
            {query.isError
              ? 'Unavailable'
              : numberFormatter(query.data?.totalConstituents ?? 0)}
          </span>
        )}
      </div>
    </Card>
  )
}
