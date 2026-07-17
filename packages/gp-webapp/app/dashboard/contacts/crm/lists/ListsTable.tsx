'use client'

import { useRouter } from 'next/navigation'
import {
  ChevronRightIcon,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@styleguide'
import { dateUsHelper } from 'helpers/dateHelper'
import { useContactsTable } from '../ContactsTableProvider'
import type { SegmentResponse } from '../shared/contacts-types'
import {
  OUTREACH_CHANNEL_ICONS,
  OUTREACH_CHANNEL_LABELS,
} from '../shared/outreachChannelLabels'
import { useListRowDetail } from './useListRowDetail'

// Renders as its own component (not inline in a .map) because each row needs
// its own useListRowDetail() call — hooks can't run a variable number of
// times inside a loop.
const ListRow = ({ segment }: { segment: SegmentResponse }) => {
  const router = useRouter()
  const { peopleCount, lastOutreach, isLoading, isError } = useListRowDetail(
    segment.id,
  )

  return (
    <TableRow
      className="cursor-pointer"
      onClick={() => router.push(`/dashboard/contacts/lists/${segment.id}`)}
    >
      <TableCell className="font-medium">
        {segment.name || 'Untitled list'}
      </TableCell>
      <TableCell>
        {isLoading ? (
          <span className="text-muted-foreground">Loading…</span>
        ) : isError ? (
          <span className="text-muted-foreground">Unavailable</span>
        ) : (
          (peopleCount?.toLocaleString() ?? '—')
        )}
      </TableCell>
      <TableCell>
        {isLoading ? (
          <span className="text-muted-foreground">Loading…</span>
        ) : isError ? (
          <span className="text-muted-foreground">Unavailable</span>
        ) : lastOutreach?.date ? (
          dateUsHelper(lastOutreach.date)
        ) : (
          <span className="text-muted-foreground">No outreach yet</span>
        )}
      </TableCell>
      <TableCell>
        {!isLoading && !isError && lastOutreach ? (
          <span className="flex items-center gap-1.5">
            {OUTREACH_CHANNEL_ICONS[lastOutreach.outreachType]}
            {OUTREACH_CHANNEL_LABELS[lastOutreach.outreachType]}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="w-8">
        <ChevronRightIcon className="size-4 text-muted-foreground" />
      </TableCell>
    </TableRow>
  )
}

export default function ListsTable() {
  const { customSegments } = useContactsTable()

  if (customSegments.length === 0) {
    return (
      <p className="mt-6 text-sm text-muted-foreground">
        You haven&apos;t created any lists yet.
      </p>
    )
  }

  return (
    <Table className="mt-6">
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>People</TableHead>
          <TableHead>Last Outreach</TableHead>
          <TableHead>Method</TableHead>
          <TableHead className="w-8" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {customSegments.map((segment) => (
          <ListRow key={segment.id} segment={segment} />
        ))}
      </TableBody>
    </Table>
  )
}
