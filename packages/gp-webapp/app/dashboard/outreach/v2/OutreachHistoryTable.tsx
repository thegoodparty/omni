'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Card,
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@styleguide'
import { dateUsHelper } from 'helpers/dateHelper'
import { OUTREACH_TYPES } from 'app/dashboard/outreach/constants'
import { ChannelBadge, HistoryStatusText } from './channelMeta'
import { getHistoryStatusLabel, type HistoryRow } from './historyStatus.util'
import { useOutreachDetail } from './useOutreachDetail'

const PAGE_SIZE = 10

interface OutreachHistoryTableProps {
  rows: HistoryRow[]
  onRowClick: (row: HistoryRow) => void
}

// Social rows carry no send counts on the list payload — the platform count
// lives on the detail (assets.length). One cached detail fetch per social
// row, shared with the drawer via the query key.
const SocialPlatformsMetric = ({ id }: { id: number }) => {
  const { data } = useOutreachDetail(id)
  const count = data?.social?.assets.length
  if (count === undefined) {
    return <span className="text-muted-foreground">—</span>
  }
  return (
    <>
      {count} platform{count === 1 ? '' : 's'}
    </>
  )
}

const RowMetric = ({ row }: { row: HistoryRow }) => {
  if (row.outreachType === OUTREACH_TYPES.socialMedia) {
    return <SocialPlatformsMetric id={row.id} />
  }
  const sent = row.textCount ?? row.billableTextCount
  if (typeof sent === 'number') {
    return (
      <>
        {sent.toLocaleString()} text{sent === 1 ? '' : 's'}
      </>
    )
  }
  return <span className="text-muted-foreground">n/a</span>
}

// Representative timestamp for newest-first sorting: the row's own date,
// falling back to createdAt (social rows never set the spine date).
const rowTime = (row: HistoryRow): number => {
  const raw = row.date ?? row.createdAt
  if (!raw) return 0
  const time = new Date(raw).getTime()
  return Number.isNaN(time) ? 0 : time
}

const rowDisplayDate = (row: HistoryRow): string | null => {
  const raw = row.date ?? row.createdAt
  return raw ? dateUsHelper(raw, 'long') : null
}

export const OutreachHistoryTable = ({
  rows,
  onRowClick,
}: OutreachHistoryTableProps) => {
  const [page, setPage] = useState(1)

  const sorted = useMemo(
    () => [...rows].sort((a, b) => rowTime(b) - rowTime(a)),
    [rows],
  )

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const paged = useMemo(
    () => sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [sorted, currentPage],
  )

  // A new save prepends a row; snap back so it's visible.
  useEffect(() => {
    setPage(1)
  }, [rows.length])

  return (
    <section className="space-y-3 mt-10 mb-32">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          Outreach history
        </h2>
        <p className="text-sm text-muted-foreground">
          Every campaign you&apos;ve sent, most recent first.
        </p>
      </div>

      {/* Desktop table */}
      <Card className="hidden overflow-hidden p-0 lg:block">
        <Table className="w-full">
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">Date</TableHead>
              <TableHead className="whitespace-nowrap">Channel</TableHead>
              <TableHead className="w-full">Campaign</TableHead>
              <TableHead className="whitespace-nowrap">Reach</TableHead>
              <TableHead className="text-right whitespace-nowrap">
                Status
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-24 text-center text-sm text-muted-foreground"
                >
                  No campaigns yet. Pick a channel above to create your first.
                </TableCell>
              </TableRow>
            ) : (
              paged.map((row) => (
                <TableRow
                  key={row.id}
                  id={`outreach-row-${row.id}`}
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer"
                  onClick={() => onRowClick(row)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onRowClick(row)
                    }
                  }}
                >
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {rowDisplayDate(row) ?? (
                      <span className="text-muted-foreground">n/a</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <ChannelBadge type={row.outreachType} />
                  </TableCell>
                  <TableCell className="max-w-0 font-medium">
                    <span className="block truncate">
                      {row.name || row.title || 'Untitled campaign'}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    <RowMetric row={row} />
                  </TableCell>
                  <TableCell className="text-right">
                    <HistoryStatusText label={getHistoryStatusLabel(row)} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Mobile cards */}
      <div className="space-y-2 lg:hidden">
        {sorted.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            No campaigns yet. Pick a channel above to create your first.
          </Card>
        ) : (
          paged.map((row) => (
            <Card
              key={row.id}
              role="button"
              tabIndex={0}
              onClick={() => onRowClick(row)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onRowClick(row)
                }
              }}
              className="cursor-pointer gap-1.5 p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{rowDisplayDate(row) ?? 'n/a'}</span>
                  <ChannelBadge type={row.outreachType} />
                </div>
                <HistoryStatusText label={getHistoryStatusLabel(row)} />
              </div>
              <span className="truncate text-base font-medium text-foreground">
                {row.name || row.title || 'Untitled campaign'}
              </span>
              <span className="text-xs text-muted-foreground">
                <RowMetric row={row} />
              </span>
            </Card>
          ))
        )}
      </div>

      {pageCount > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                className={cn(
                  currentPage === 1 && 'pointer-events-none opacity-50',
                )}
                onClick={(e) => {
                  e.preventDefault()
                  if (currentPage > 1) setPage(currentPage - 1)
                }}
              />
            </PaginationItem>
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
              <PaginationItem key={p}>
                <PaginationLink
                  href="#"
                  isActive={p === currentPage}
                  onClick={(e) => {
                    e.preventDefault()
                    setPage(p)
                  }}
                >
                  {p}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                href="#"
                className={cn(
                  currentPage === pageCount && 'pointer-events-none opacity-50',
                )}
                onClick={(e) => {
                  e.preventDefault()
                  if (currentPage < pageCount) setPage(currentPage + 1)
                }}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </section>
  )
}
