'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, UserIcon } from '@styleguide'
import { districtStatsQueryOptions } from 'app/dashboard/polls/shared/queries'
import { useContactsTable } from '../ContactsTableProvider'
import { getContactsLabels } from '../../../shared/contactsLabels'
import ListCard from './ListCard'

// The Lovable design's first list row: the whole (unfiltered) universe.
// Count comes from the same GET /v1/contacts/stats query DistrictStatCard
// already holds warm (React Query dedupes on the shared key). No Details
// action: GET /v1/contacts/list-detail requires a saved-segment id, so
// there's nothing to open for the unfiltered universe (deviation noted on
// ENG-10725).
const AllContactsCard = ({ title }: { title: string }) => {
  const query = useQuery(districtStatsQueryOptions)

  return (
    <Card className="w-full gap-2 rounded-2xl p-4 shadow-xs">
      <h3 className="text-base font-semibold">{title}</h3>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <UserIcon className="size-3.5" aria-hidden />
          {query.status !== 'success'
            ? query.isError
              ? 'Unavailable'
              : '—'
            : query.data.totalConstituents.toLocaleString()}
        </span>
        <Button size="small" className="h-8 px-3.5 text-xs" asChild>
          <Link href="/dashboard/outreach">Send outreach</Link>
        </Button>
      </div>
    </Card>
  )
}

// ENG-10725 (Lovable pixel parity): full-width row cards in the page's 560px
// column — an "All voters" universe row first, then one row per saved list.
export default function ListsIndex() {
  const { customSegments, isWinContext } = useContactsTable()
  const labels = getContactsLabels(isWinContext)

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{labels.listsSectionTitle}</h2>
        <p className="text-sm text-muted-foreground">
          {labels.listsSectionSubtitle}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <AllContactsCard title={labels.allContactsTitle} />
        {customSegments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You haven&apos;t created any lists yet.
          </p>
        ) : (
          customSegments.map((segment) => (
            <ListCard key={segment.id} segment={segment} />
          ))
        )}
      </div>
    </section>
  )
}
