'use client'

import { useQuery } from '@tanstack/react-query'
import { Card } from '@styleguide'
import { cn } from '@styleguide/lib/utils'
import { numberFormatter } from 'helpers/numberHelper'
import { districtStatsQueryOptions } from 'app/dashboard/polls/shared/queries'

interface StatRow {
  label: string
  value: number
}

interface DistrictStatCardProps {
  label: string
  // The 2020-census population row rendered above `label`'s row. Win passes
  // no label (no census row at all); Serve passes one, but the row still
  // hides itself when the stats query's districtPopulation is null — a
  // common state (the mart's voter-block allocation legitimately has no
  // coverage for some districts), not an error worth an "Unavailable" or a
  // silent zero.
  populationLabel?: string
  // ENG-10746: Win mode appends the raceTargetMetrics rows (projected
  // turnout, voters needed to win) under the fetched district-total row.
  // These values arrive synchronously from the campaign context, so they
  // carry no loading/error state of their own.
  additionalRows?: StatRow[]
  className?: string
}

// ENG-10721 (locked-prototype parity): the "Total voters/constituents in
// your district" stat card on crm/CrmContactsPage.tsx. Reads the shared
// GET /v1/contacts/stats query (districtStatsQueryOptions, keyed
// 'contacts-stats') — no new endpoint. Split into its own component (rather
// than inlined in CrmContactsPage) so page-level tests that don't care about
// this fetch can mock it away, matching how
// ContactTypeahead/PersonOverlay/CreateListWizard are already mocked there.
// Restyled to the Lovable full-column-width row card (label left, value
// right) in ENG-10725.
export default function DistrictStatCard({
  label,
  populationLabel,
  additionalRows,
  className,
}: DistrictStatCardProps) {
  const query = useQuery(districtStatsQueryOptions)
  const population =
    query.status === 'success' ? query.data.districtPopulation : null
  // Gates the census row's existence AND the border that separates it from
  // the row below. Written once so the two can't drift into a `border-t`
  // with nothing above it.
  const showPopulationRow = Boolean(populationLabel) && population !== null

  return (
    <Card className={cn('w-full gap-0 rounded-lg py-0', className)}>
      {showPopulationRow && (
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <span className="text-sm font-normal">{populationLabel}</span>
          <span className="text-lg font-semibold">
            {numberFormatter(population)}
          </span>
        </div>
      )}
      <div
        className={cn(
          'flex items-center justify-between gap-4 px-4 py-3',
          showPopulationRow && 'border-t border-border',
        )}
      >
        <span className="text-sm font-normal">{label}</span>
        {/* React Query v5's `isLoading` is `isPending && isFetching` — on the
            very first synchronous render `isFetching` is still false, so
            `isLoading` reads false too and this would briefly paint
            numberFormatter(undefined ?? 0) = '0' before the fetch even
            starts. `status !== 'success'` covers pending AND error, so the
            skeleton (not a bogus zero) shows until data actually resolves;
            the error branch below still renders "Unavailable" once
            status flips to 'error'. */}
        {query.status !== 'success' ? (
          query.isError ? (
            <span className="text-lg font-semibold">Unavailable</span>
          ) : (
            <div className="h-6 w-16 animate-pulse rounded bg-muted" />
          )
        ) : (
          <span className="text-lg font-semibold">
            {numberFormatter(query.data.totalConstituents)}
          </span>
        )}
      </div>
      {additionalRows?.map((row) => (
        <div
          key={row.label}
          className="flex items-center justify-between gap-4 border-t border-border px-4 py-3"
        >
          <span className="text-sm font-normal">{row.label}</span>
          <span className="text-lg font-semibold">
            {numberFormatter(row.value)}
          </span>
        </div>
      ))}
    </Card>
  )
}
