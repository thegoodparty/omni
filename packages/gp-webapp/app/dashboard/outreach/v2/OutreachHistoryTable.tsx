'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
import type { MembershipState } from 'app/dashboard/shared/membership/deriveMembershipState'
import {
  fetchOutreachDetail,
  useOutreachDetail,
  type OutreachDetailFetcher,
} from './useOutreachDetail'
import { useSmsResults } from './useOutreachResults'

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
  // The candidate's membership state, read once by the hub — threaded down
  // only so a draft row's status can name the next step (draftLabelFor).
  // Omitted callers (constituent-outreach: no draft rows exist there) get
  // the same null default getHistoryStatusLabel already carries.
  membership?: MembershipState | null
  // "Campaign" is fine on both surfaces here — these ARE outreach campaigns,
  // not a run for office. An election CYCLE is not: an elected official
  // archives outreach across a term, so Serve names the shelf, not the cycle.
  isServe?: boolean
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
// "called" is a past tense: a call campaign that is still scheduled reaches
// people, the same way a scheduled text does, and only reads as called once
// it has run. Texting never changes tense (its count is people, not sends).
const peopleUnit = (
  type: HistoryRow['outreachType'],
  status: HistoryRow['status'],
): string =>
  (type === OUTREACH_TYPES.robocall || type === OUTREACH_TYPES.phoneBanking) &&
  status === 'completed'
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

// A robocall's count lives on its satellite, not the spine's text counts,
// so like phone banking it comes off the detail fetch. A draft has not been
// priced yet and reads n/a until it is.
const RobocallPeopleMetric = ({
  row,
  compact,
  detailFetcher,
}: {
  row: HistoryRow
  compact?: boolean
  detailFetcher: OutreachDetailFetcher
}) => {
  const { data } = useOutreachDetail(row.id, true, detailFetcher)
  const count = data?.robocall?.billableCount
  if (count === undefined) {
    return <span className="text-muted-foreground">—</span>
  }
  if (count === null) {
    return <span className="text-muted-foreground">n/a</span>
  }
  const unit = peopleUnit(row.outreachType, row.status)
  if (compact) {
    return (
      <>
        {count.toLocaleString()} {unit}
      </>
    )
  }
  return (
    <>
      <span className="text-sm">{count.toLocaleString()}</span>{' '}
      <span className="text-xs">{unit}</span>
    </>
  )
}

// Every door-knocking row carries one, a single turf included. The count is
// what the row's name is hiding: a campaign is many turfs collapsed onto
// their anchor, so without it "Elm St walk" reads as one list whatever it
// holds. Shown at one turf too, because a badge that appears only sometimes
// makes its absence look like missing data rather than a count of one.
//
// Door knocking only. `turfCount` is attached by
// `collapseDoorKnockingCampaigns` and no other channel has one, so gating on
// the type rather than on the number is what stops an SMS row reading
// "1 turf".
const TurfBadge = ({ row }: { row: HistoryRow }) => {
  if (row.outreachType !== OUTREACH_TYPES.nativeDoorKnocking) return null
  const count = row.turfCount ?? 1
  return (
    <Badge shape="pill" variant="soft" className="shrink-0">
      {count} {count === 1 ? 'turf' : 'turfs'}
    </Badge>
  )
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
    // Solo campaigns only. `OutreachDetail.doorKnocking` carries the ANCHOR
    // turf's figures, not an aggregate across siblings, so a collapsed
    // multi-turf row would print one turf's people under the whole
    // campaign's name. Same guard and same reason as the drawer's Overview
    // cells and progress bar; per-turf figures live on the sibling list.
    if ((row.turfCount ?? 1) > 1) {
      return <span className="text-muted-foreground">—</span>
    }
    return (
      <DoorKnockingPeopleMetric
        id={row.id}
        compact={compact}
        detailFetcher={detailFetcher}
      />
    )
  }
  if (row.outreachType === OUTREACH_TYPES.robocall) {
    return (
      <RobocallPeopleMetric
        row={row}
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
          {sent.toLocaleString()} {peopleUnit(row.outreachType, row.status)}
        </>
      )
    }
    return (
      <>
        <span className="text-sm">{sent.toLocaleString()}</span>{' '}
        <span className="text-xs">
          {peopleUnit(row.outreachType, row.status)}
        </span>
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
// A completed SMS row on the SERVE surface fills it too — see below.

// The design's collapsed SMS row: "{responses} responses · {unsub} unsub",
// off the same three numbers the Statistics card reads.
//
// Serve-only, and that is a scope line rather than a design one. Win's
// Results column is still the placeholder described above, and filling it
// would add a results fetch per completed text row to a surface that has not
// asked for one. Give this the Win fetcher the day Win's column should fill.
const ServeSmsResponsesMetric = ({ id }: { id: number }) => {
  const { data } = useSmsResults(id, true, 'serve')
  if (!data) {
    return <span className="text-muted-foreground">—</span>
  }
  return (
    <>
      {data.responded.toLocaleString()} responses ·{' '}
      {data.optedOut.toLocaleString()} unsub
    </>
  )
}

// Which result metric a row shows, by channel and by surface.
const RowResults = ({
  row,
  detailFetcher,
  isServe,
}: {
  row: HistoryRow
  detailFetcher: OutreachDetailFetcher
  isServe?: boolean
}) => {
  if (
    isServe &&
    row.status === 'completed' &&
    (row.outreachType === OUTREACH_TYPES.text ||
      row.outreachType === OUTREACH_TYPES.p2p)
  ) {
    return <ServeSmsResponsesMetric id={row.id} />
  }
  if (row.outreachType === OUTREACH_TYPES.nativePhoneBanking) {
    return (
      <PhoneBankingSupportersMetric id={row.id} detailFetcher={detailFetcher} />
    )
  }
  if (row.outreachType === OUTREACH_TYPES.nativeDoorKnocking) {
    // Anchor-only, exactly as above — and the dash is already this
    // function's answer for a row with nothing to report.
    if ((row.turfCount ?? 1) > 1) {
      return <span className="text-muted-foreground">—</span>
    }
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
const BASE_STATUS_FILTERS = [
  'Draft',
  'In review',
  'Denied',
  'Scheduled',
  'Sending',
  'In progress',
  'Done',
  'Pending payment',
  'Canceled',
] as const

// The five names a saved draft's status can take (historyStatus.util.ts's
// DRAFT_LABELS). They are offered only when the caller passes a membership:
// with the flag off the hub passes none AND filters every draft row out, so
// these would be five checkboxes matching nothing.
const DRAFT_STATUS_FILTERS = [
  'Pro needed',
  'Verification needed',
  'Verification in review',
  'PIN needed',
  'Ready to schedule',
] as const

type StatusFilterKey =
  | (typeof BASE_STATUS_FILTERS)[number]
  | (typeof DRAFT_STATUS_FILTERS)[number]

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
  membership = null,
  isServe = false,
}: OutreachHistoryTableProps) => {
  const [page, setPage] = useState(1)
  const [showArchive, setShowArchive] = useState(false)
  const [channelFilter, setChannelFilter] = useState<Set<ChannelFilterKey>>(
    () => new Set(CHANNEL_FILTERS.map((c) => c.key)),
  )
  // Keyed on WHETHER there is a membership, never on the object: the hub
  // re-renders often (rows refetch, window focus, a sheet opening) and a
  // membership identity in the dependency list re-seeded the filter set on
  // every one of them, restoring every box the candidate had unchecked.
  const hasMembership = membership !== null
  const statusFilters: readonly StatusFilterKey[] = useMemo(
    () =>
      hasMembership
        ? [...BASE_STATUS_FILTERS, ...DRAFT_STATUS_FILTERS]
        : BASE_STATUS_FILTERS,
    [hasMembership],
  )
  const [statusFilter, setStatusFilter] = useState<Set<StatusFilterKey>>(
    () => new Set(statusFilters),
  )
  // Membership arrives after the flag read settles, so the five draft names
  // can join the set mid-mount; they start checked like every other filter.
  // Once only — a second widening would undo the candidate's own unchecking.
  const draftFiltersWidenedRef = useRef(hasMembership)
  useEffect(() => {
    if (!hasMembership || draftFiltersWidenedRef.current) return
    draftFiltersWidenedRef.current = true
    setStatusFilter((prev) => new Set([...prev, ...DRAFT_STATUS_FILTERS]))
  }, [hasMembership])

  const displayStatusLabel = (row: HistoryRow): string | null => {
    // An archived row reads "Archived" no matter what state it was shelved
    // in (prototype: effStatus) — the underlying status is a detail the
    // archive view doesn't relitigate.
    if (row.archivedAt) {
      return 'Archived'
    }
    return getHistoryStatusLabel(row, membership, isServe)
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
            !(statusFilters as readonly string[]).includes(status) ||
            statusFilter.has(status as StatusFilterKey)
          )
        })
        .sort((a, b) => rowTime(b) - rowTime(a)),
    [rows, showArchive, channelFilter, statusFilter, statusFilters],
  )

  const activeFilterCount =
    CHANNEL_FILTERS.length -
    channelFilter.size +
    (statusFilters.length - statusFilter.size)

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

  const toggleStatus = (key: StatusFilterKey, on: boolean) =>
    setStatusFilter((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })

  const clearFilters = () => {
    setChannelFilter(new Set(CHANNEL_FILTERS.map((c) => c.key)))
    setStatusFilter(new Set(statusFilters))
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
            {showArchive ? 'Archived campaigns' : 'Active campaigns'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {showArchive
              ? isServe
                ? 'Completed and cancelled campaigns you have archived.'
                : 'Completed and cancelled campaigns from earlier cycles.'
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
                {statusFilters.map((s) => (
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
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 truncate">
                          {row.name || row.title || 'Untitled campaign'}
                        </span>
                        <TurfBadge row={row} />
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      <RowMetric row={row} detailFetcher={detailFetcher} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      <RowResults
                        row={row}
                        detailFetcher={detailFetcher}
                        isServe={isServe}
                      />
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
                <span className="flex items-center gap-2 text-base font-medium text-foreground">
                  <span className="min-w-0 truncate">
                    {row.name || row.title || 'Untitled campaign'}
                  </span>
                  <TurfBadge row={row} />
                </span>
                <span className="text-xs text-muted-foreground">
                  <RowMetric row={row} compact detailFetcher={detailFetcher} />{' '}
                  ·{' '}
                  <RowResults
                    row={row}
                    detailFetcher={detailFetcher}
                    isServe={isServe}
                  />
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
