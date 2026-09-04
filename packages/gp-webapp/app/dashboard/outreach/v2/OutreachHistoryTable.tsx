'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  CheckboxLabel,
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@styleguide'
import {
  ArchiveIcon,
  SlidersHorizontalIcon,
} from '@styleguide/components/ui/icons'
import { shortOutreachDate } from './outreachDate.util'
import { OUTREACH_TYPES } from 'app/dashboard/outreach/constants'
import { ChannelBadge, HistoryStatusText } from './channelMeta'
import { getHistoryStatusLabel, type HistoryRow } from './historyStatus.util'
import {
  fetchOutreachDetail,
  useOutreachDetail,
  type OutreachDetailFetcher,
} from './useOutreachDetail'

const PAGE_SIZE = 10

interface OutreachHistoryTableProps {
  rows: HistoryRow[]
  // Optional: a caller with no row-click destination omits it, and rows
  // render as plain, non-interactive content instead of faking a clickable
  // row that does nothing.
  onRowClick?: (row: HistoryRow) => void
  // Per-row gate on top of `onRowClick`, for a caller whose drawer only
  // covers some row types (constituent-outreach: social rows only, since no
  // other Serve channel exists yet). Defaults to every row being clickable,
  // matching every existing caller's byte-identical behavior.
  rowClickable?: (row: HistoryRow) => boolean
  // Detail fetch used by the social/phone-banking metric cells above.
  // Defaults to Win's campaign-scoped read; the Serve caller threads its
  // org-scoped sibling the same bound-function way SocialFlow's `surface`
  // does, so this table never forks per surface.
  detailFetcher?: OutreachDetailFetcher
}

// Social rows carry no send counts on the list payload — the platform count
// lives on the detail (assets.length). One cached detail fetch per social
// row, shared with the drawer via the query key.
const SocialPlatformsMetric = ({
  id,
  detailFetcher,
}: {
  id: number
  detailFetcher: OutreachDetailFetcher
}) => {
  const { data } = useOutreachDetail(id, true, detailFetcher)
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

// Prototype unit: "people called" for the phone channels, "people" elsewhere.
const peopleUnit = (type: HistoryRow['outreachType']): string =>
  type === OUTREACH_TYPES.robocall || type === OUTREACH_TYPES.phoneBanking
    ? 'people called'
    : 'people'

// nativePhoneBanking carries no send counts on the list payload either — the
// live-called count lives on the detail's phoneBanking block, same pattern
// as SocialPlatformsMetric.
const PhoneBankingCalledMetric = ({
  id,
  detailFetcher,
}: {
  id: number
  detailFetcher: OutreachDetailFetcher
}) => {
  const { data } = useOutreachDetail(id, true, detailFetcher)
  const count = data?.phoneBanking?.peopleCalled
  if (count === undefined) {
    return <span className="text-muted-foreground">—</span>
  }
  return <>{count.toLocaleString()} people called</>
}

const PhoneBankingSupportersMetric = ({
  id,
  detailFetcher,
}: {
  id: number
  detailFetcher: OutreachDetailFetcher
}) => {
  const { data } = useOutreachDetail(id, true, detailFetcher)
  const count = data?.phoneBanking?.supporters
  if (count === undefined) {
    return <span className="text-muted-foreground">—</span>
  }
  return (
    <>
      {count.toLocaleString()} supporter{count === 1 ? '' : 's'}
    </>
  )
}

// A door-knocking envelope carries no send counts either, and unlike a text
// blast its figures do not stop moving when the campaign is created: doors get
// logged for as long as the walk runs. So both cells read the SAME live
// aggregate the rail and the details drawer read, rather than a snapshot taken
// at knock time that would disagree with them by the end of the first evening.
const DoorKnockingPeopleMetric = ({
  id,
  compact,
  detailFetcher,
}: {
  id: number
  compact?: boolean
  detailFetcher: OutreachDetailFetcher
}) => {
  const { data } = useOutreachDetail(id, true, detailFetcher)
  const count = data?.doorKnocking?.peopleCount
  if (count === undefined) {
    return <span className="text-muted-foreground">—</span>
  }
  if (compact) {
    return <>{count.toLocaleString()} people</>
  }
  return (
    <>
      <span className="text-sm">{count.toLocaleString()}</span>{' '}
      <span className="text-xs">people</span>
    </>
  )
}

// "Logged", not "responses": a knock is logged whether or not anyone answered,
// and the drawer already says "N of M people logged" off this same number.
const DoorKnockingLoggedMetric = ({
  id,
  detailFetcher,
}: {
  id: number
  detailFetcher: OutreachDetailFetcher
}) => {
  const { data } = useOutreachDetail(id, true, detailFetcher)
  const count = data?.doorKnocking?.loggedCount
  if (count === undefined) {
    return <span className="text-muted-foreground">—</span>
  }
  return <>{count.toLocaleString()} logged</>
}

// compact = the mobile card's flat text-xs line; the table cell splits the
// number (text-sm) from the unit (text-xs) per the prototype.
const RowMetric = ({
  row,
  compact,
  detailFetcher,
}: {
  row: HistoryRow
  compact?: boolean
  detailFetcher: OutreachDetailFetcher
}) => {
  if (row.outreachType === OUTREACH_TYPES.socialMedia) {
    return <SocialPlatformsMetric id={row.id} detailFetcher={detailFetcher} />
  }
  if (row.outreachType === OUTREACH_TYPES.nativePhoneBanking) {
    return (
      <PhoneBankingCalledMetric id={row.id} detailFetcher={detailFetcher} />
    )
  }
  if (row.outreachType === OUTREACH_TYPES.nativeDoorKnocking) {
    return (
      <DoorKnockingPeopleMetric
        id={row.id}
        compact={compact}
        detailFetcher={detailFetcher}
      />
    )
  }
  const sent = row.textCount ?? row.billableTextCount
  if (typeof sent === 'number') {
    if (compact) {
      return (
        <>
          {sent.toLocaleString()} {peopleUnit(row.outreachType)}
        </>
      )
    }
    return (
      <>
        <span className="text-sm">{sent.toLocaleString()}</span>{' '}
        <span className="text-xs">{peopleUnit(row.outreachType)}</span>
      </>
    )
  }
  return <span className="text-muted-foreground">n/a</span>
}

// Result metrics (responses, answers, supporters) arrive with the per-channel
// result sweeps in phases 2-4; until then every row shows the prototype's
// missing-results placeholder. Social keeps it permanently (engagements are
// cut from v1 by the social channel spec). nativePhoneBanking's results
// (supporter count) are already computed on the detail, so it fills the slot.
const RowResults = ({
  row,
  detailFetcher,
}: {
  row: HistoryRow
  detailFetcher: OutreachDetailFetcher
}) => {
  if (row.outreachType === OUTREACH_TYPES.nativePhoneBanking) {
    return (
      <PhoneBankingSupportersMetric id={row.id} detailFetcher={detailFetcher} />
    )
  }
  if (row.outreachType === OUTREACH_TYPES.nativeDoorKnocking) {
    return (
      <DoorKnockingLoggedMetric id={row.id} detailFetcher={detailFetcher} />
    )
  }
  return <span className="text-muted-foreground">—</span>
}

// Filter vocabulary: one entry per channel pill (text and p2p are both "SMS").
const CHANNEL_FILTERS = [
  { key: 'social', label: 'Social media', types: [OUTREACH_TYPES.socialMedia] },
  {
    key: 'sms',
    label: 'SMS',
    types: [OUTREACH_TYPES.text, OUTREACH_TYPES.p2p],
  },
  { key: 'robocall', label: 'Robocall', types: [OUTREACH_TYPES.robocall] },
  {
    key: 'phone-bank',
    label: 'Phone banking',
    types: [OUTREACH_TYPES.phoneBanking, OUTREACH_TYPES.nativePhoneBanking],
  },
  {
    key: 'door',
    label: 'Door knocking',
    types: [OUTREACH_TYPES.doorKnocking, OUTREACH_TYPES.nativeDoorKnocking],
  },
] as const

type ChannelFilterKey = (typeof CHANNEL_FILTERS)[number]['key']

const channelFilterKey = (
  type: HistoryRow['outreachType'],
): ChannelFilterKey | null =>
  CHANNEL_FILTERS.find((c) =>
    (c.types as readonly string[]).includes(type ?? ''),
  )?.key ?? null

// The unified label vocabulary across both legacy status maps.
const STATUS_FILTERS = [
  'Draft',
  'In review',
  'Denied',
  'Scheduled',
  'In progress',
  'Done',
  'Pending payment',
  'Canceled',
] as const

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
  return raw ? shortOutreachDate(raw) : null
}

export const OutreachHistoryTable = ({
  rows,
  onRowClick,
  rowClickable = () => true,
  detailFetcher = fetchOutreachDetail,
}: OutreachHistoryTableProps) => {
  const [page, setPage] = useState(1)
  const [showArchive, setShowArchive] = useState(false)
  const [channelFilter, setChannelFilter] = useState<Set<ChannelFilterKey>>(
    () => new Set(CHANNEL_FILTERS.map((c) => c.key)),
  )
  const [statusFilter, setStatusFilter] = useState<
    Set<(typeof STATUS_FILTERS)[number]>
  >(() => new Set(STATUS_FILTERS))

  const displayStatusLabel = (row: HistoryRow): string | null => {
    // An archived row reads "Archived" no matter what state it was shelved
    // in (prototype: effStatus) — the underlying status is a detail the
    // archive view doesn't relitigate.
    if (row.archivedAt) {
      return 'Archived'
    }
    return getHistoryStatusLabel(row)
  }

  const visible = useMemo(
    () =>
      [...rows]
        .filter((row) => {
          if (Boolean(row.archivedAt) !== showArchive) return false
          // Rows outside both vocabularies (odd legacy types, null statuses)
          // always show — filters only subtract what they can name.
          const channel = channelFilterKey(row.outreachType)
          if (channel !== null && !channelFilter.has(channel)) return false
          const status = displayStatusLabel(row)
          return (
            status === null ||
            !(STATUS_FILTERS as readonly string[]).includes(status) ||
            statusFilter.has(status as (typeof STATUS_FILTERS)[number])
          )
        })
        .sort((a, b) => rowTime(b) - rowTime(a)),
    [rows, showArchive, channelFilter, statusFilter],
  )

  const activeFilterCount =
    CHANNEL_FILTERS.length -
    channelFilter.size +
    (STATUS_FILTERS.length - statusFilter.size)

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const paged = useMemo(
    () => visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [visible, currentPage],
  )

  // A new save prepends a row; snap back so it's visible.
  useEffect(() => {
    setPage(1)
  }, [rows.length])

  useEffect(() => {
    setPage(1)
  }, [showArchive, channelFilter, statusFilter])

  const toggleChannel = (key: ChannelFilterKey, on: boolean) =>
    setChannelFilter((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })

  const toggleStatus = (key: (typeof STATUS_FILTERS)[number], on: boolean) =>
    setStatusFilter((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })

  const clearFilters = () => {
    setChannelFilter(new Set(CHANNEL_FILTERS.map((c) => c.key)))
    setStatusFilter(new Set(STATUS_FILTERS))
  }

  const activeRowCount = rows.filter((row) => !row.archivedAt).length

  const emptyMessage =
    visible.length === 0 && activeFilterCount > 0
      ? 'No campaigns match your filters.'
      : showArchive
        ? 'No archived campaigns.'
        : activeRowCount === 0 && rows.length > 0
          ? 'All your campaigns are archived. Click “Archive” to view them.'
          : activeRowCount === 0
            ? 'No campaigns yet. Pick a channel above to create your first.'
            : 'No campaigns match your filters.'

  return (
    <section className="space-y-3 mt-10 mb-32">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">
            {showArchive
              ? 'Archived outreach campaigns'
              : 'Outreach campaign history'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {showArchive
              ? 'Completed and cancelled campaigns from earlier cycles.'
              : "Every campaign you've sent, most recent first."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="small">
                <SlidersHorizontalIcon className="size-4" />
                Filters
                {activeFilterCount > 0 && (
                  <Badge shape="pill" className="ml-1">
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Channel
                </p>
                {CHANNEL_FILTERS.map((c) => (
                  <CheckboxLabel
                    key={c.key}
                    id={`channel-${c.key}`}
                    label={c.label}
                    checked={channelFilter.has(c.key)}
                    onCheckedChange={(on) => toggleChannel(c.key, on === true)}
                  />
                ))}
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Status
                </p>
                {STATUS_FILTERS.map((s) => (
                  <CheckboxLabel
                    key={s}
                    id={`status-${s}`}
                    label={s}
                    checked={statusFilter.has(s)}
                    onCheckedChange={(on) => toggleStatus(s, on === true)}
                  />
                ))}
              </div>
              {activeFilterCount > 0 && (
                <Button
                  variant="link"
                  size="small"
                  className="h-auto px-0"
                  onClick={clearFilters}
                >
                  Clear filters
                </Button>
              )}
            </PopoverContent>
          </Popover>
          <Button
            variant="outline"
            size="small"
            onClick={() => setShowArchive((v) => !v)}
            aria-pressed={showArchive}
          >
            <ArchiveIcon className="size-4" />
            {showArchive ? 'Back to active' : 'Archive'}
          </Button>
        </div>
      </div>

      {/* Desktop table */}
      <Card className="hidden overflow-hidden p-0 lg:block">
        {/* Prototype table metrics: muted header labels, 44px data rows
            (vs the styleguide's 56px default), 16px first/last padding. */}
        <Table className="w-full [&_th]:text-muted-foreground [&_td]:h-11 [&_th:first-child]:!pl-4 [&_td:first-child]:!pl-4 [&_th:last-child]:!pr-4 [&_td:last-child]:!pr-4">
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">Date</TableHead>
              <TableHead className="whitespace-nowrap">Channel</TableHead>
              <TableHead className="w-full">Campaign</TableHead>
              <TableHead className="whitespace-nowrap">People</TableHead>
              <TableHead className="whitespace-nowrap">Results</TableHead>
              <TableHead className="text-right whitespace-nowrap">
                Status
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="!h-24 text-center text-sm text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              paged.map((row) => {
                const clickable = Boolean(onRowClick) && rowClickable(row)
                return (
                  <TableRow
                    key={row.id}
                    id={`outreach-row-${row.id}`}
                    role={clickable ? 'button' : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    className={clickable ? 'cursor-pointer' : undefined}
                    onClick={clickable ? () => onRowClick?.(row) : undefined}
                    onKeyDown={
                      clickable
                        ? (e: React.KeyboardEvent<HTMLTableRowElement>) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              onRowClick?.(row)
                            }
                          }
                        : undefined
                    }
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
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      <RowMetric row={row} detailFetcher={detailFetcher} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      <RowResults row={row} detailFetcher={detailFetcher} />
                    </TableCell>
                    <TableCell className="text-right">
                      <HistoryStatusText label={displayStatusLabel(row)} />
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Mobile cards */}
      <div className="space-y-2 lg:hidden">
        {visible.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </Card>
        ) : (
          paged.map((row) => {
            const clickable = Boolean(onRowClick) && rowClickable(row)
            return (
              <Card
                key={row.id}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                onClick={clickable ? () => onRowClick?.(row) : undefined}
                onKeyDown={
                  clickable
                    ? (e: React.KeyboardEvent<HTMLDivElement>) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onRowClick?.(row)
                        }
                      }
                    : undefined
                }
                className={cn('gap-1.5 p-4', clickable && 'cursor-pointer')}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{rowDisplayDate(row) ?? 'n/a'}</span>
                    <ChannelBadge type={row.outreachType} />
                  </div>
                  <HistoryStatusText label={displayStatusLabel(row)} />
                </div>
                <span className="truncate text-base font-medium text-foreground">
                  {row.name || row.title || 'Untitled campaign'}
                </span>
                <span className="text-xs text-muted-foreground">
                  <RowMetric row={row} compact detailFetcher={detailFetcher} />{' '}
                  · <RowResults row={row} detailFetcher={detailFetcher} />
                </span>
              </Card>
            )
          })
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
