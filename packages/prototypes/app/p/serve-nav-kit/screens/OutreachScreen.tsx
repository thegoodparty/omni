'use client'

import { useEffect, useMemo, useState } from 'react'
import { SlidersHorizontal, Archive } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CheckboxLabel,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  cn,
} from '@goodparty_org/styleguide'
import { ScreenLayout } from '../components/ScreenLayout'
import { ChannelCard } from '../components/ChannelCard'
import { CampaignDetailsDrawer } from './outreach/CampaignDetailsDrawer'
import { ChannelBadge } from './outreach/ChannelBadge'
import { StatusIndicator } from './outreach/StatusIndicator'
import { SmsCampaignFlow, type ScheduledSms } from './outreach/SmsCampaignFlow'
import {
  EmailCampaignFlow,
  type ScheduledEmail,
} from './outreach/EmailCampaignFlow'
import {
  RobocallCampaignFlow,
  type ScheduledRobocall,
} from './outreach/RobocallCampaignFlow'
import {
  PollsCampaignFlow,
  type ScheduledPoll,
} from './outreach/PollsCampaignFlow'
import {
  type ChannelKey,
  type HistoryRow,
  type HistoryStatus,
  CHANNELS,
  CHANNEL_ICON,
  CHANNEL_ICON_TINT,
  CHANNEL_LABEL,
  HISTORY,
  STATUS_META,
  STATUSES,
  peopleLabel,
  resultsText,
} from './outreach/data'

const PAGE_SIZE = 10

// Representative timestamp for sorting the history newest-first: the row's own
// Date field, falling back to parsing the display date string.
const rowTime = (h: HistoryRow) => {
  const d = h.scheduledAt ?? h.completedAt ?? h.startedAt
  if (d) return d.getTime()
  const parsed = new Date(`${h.date}, 2026`)
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime()
}

type OutreachScreenProps = {
  title: string
  aiPlaceholder?: string
}

export const OutreachScreen = ({
  title,
  aiPlaceholder,
}: OutreachScreenProps) => {
  const [history, setHistory] = useState<HistoryRow[]>(HISTORY)
  const [smsOpen, setSmsOpen] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [robocallOpen, setRobocallOpen] = useState(false)
  const [pollOpen, setPollOpen] = useState(false)
  const [showArchive, setShowArchive] = useState(false)
  const [channelFilter, setChannelFilter] = useState<Set<ChannelKey>>(
    () => new Set(CHANNELS),
  )
  const [statusFilter, setStatusFilter] = useState<Set<HistoryStatus>>(
    () => new Set(STATUSES),
  )
  const [page, setPage] = useState(1)
  const [openRow, setOpenRow] = useState<HistoryRow | null>(null)

  const visible = useMemo(
    () =>
      history
        .filter(
          (h) =>
            Boolean(h.archived) === showArchive &&
            channelFilter.has(h.channel) &&
            statusFilter.has(h.status),
        )
        // Most recent first, by the row's representative date.
        .sort((a, b) => rowTime(b) - rowTime(a)),
    [history, showArchive, channelFilter, statusFilter],
  )

  const activeFilterCount =
    CHANNELS.length - channelFilter.size + (STATUSES.length - statusFilter.size)

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const paged = useMemo(
    () => visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [visible, currentPage],
  )

  useEffect(() => {
    setPage(1)
  }, [showArchive, channelFilter, statusFilter])

  const toggleChannel = (key: ChannelKey, on: boolean) =>
    setChannelFilter((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })

  const toggleStatus = (key: HistoryStatus, on: boolean) =>
    setStatusFilter((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })

  const clearFilters = () => {
    setChannelFilter(new Set(CHANNELS))
    setStatusFilter(new Set(STATUSES))
  }

  return (
    <ScreenLayout title={title} aiPlaceholder={aiPlaceholder} width="wide">
      {/* Create a campaign */}
      <section className="space-y-3">
        <div>
          <h2 className="text-foreground text-lg font-semibold">
            Create an outreach campaign
          </h2>
          <p className="text-muted-foreground text-sm">
            Pick a channel to draft and send a new campaign.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {CHANNELS.map((key) => (
            <ChannelCard
              key={key}
              label={CHANNEL_LABEL[key]}
              icon={CHANNEL_ICON[key]}
              tint={CHANNEL_ICON_TINT[key]}
              locked={
                !['social', 'sms', 'email', 'robocall', 'polls'].includes(key)
              }
              onClick={
                key === 'sms'
                  ? () => setSmsOpen(true)
                  : key === 'email'
                    ? () => setEmailOpen(true)
                    : key === 'robocall'
                      ? () => setRobocallOpen(true)
                      : key === 'polls'
                        ? () => setPollOpen(true)
                        : undefined
              }
            />
          ))}
        </div>
      </section>

      {/* History */}
      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-foreground text-lg font-semibold">
              {showArchive ? 'Archived outreach' : 'Outreach history'}
            </h2>
            <p className="text-muted-foreground text-sm">
              {showArchive
                ? 'Completed and cancelled campaigns from earlier cycles.'
                : "Every campaign you've sent, most recent first."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="small">
                  <SlidersHorizontal className="size-4" />
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
                  <p className="text-muted-foreground text-xs font-medium">
                    Channel
                  </p>
                  {CHANNELS.map((key) => (
                    <CheckboxLabel
                      key={key}
                      id={`channel-${key}`}
                      label={CHANNEL_LABEL[key]}
                      checked={channelFilter.has(key)}
                      onCheckedChange={(c) => toggleChannel(key, c === true)}
                    />
                  ))}
                </div>
                <div className="space-y-2">
                  <p className="text-muted-foreground text-xs font-medium">
                    Status
                  </p>
                  {STATUSES.map((key) => (
                    <CheckboxLabel
                      key={key}
                      id={`status-${key}`}
                      label={STATUS_META[key].label}
                      checked={statusFilter.has(key)}
                      onCheckedChange={(c) => toggleStatus(key, c === true)}
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
              <Archive className="size-4" />
              {showArchive ? 'Back to active' : 'Archive'}
            </Button>
          </div>
        </div>

        {/* Desktop table */}
        <Card className="hidden overflow-hidden p-0 lg:block">
          <Table className="w-full">
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
                    className="text-muted-foreground h-24 text-center text-sm"
                  >
                    No campaigns match your filters.
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((h) => (
                  <TableRow
                    key={h.id}
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer"
                    onClick={() => setOpenRow(h)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setOpenRow(h)
                      }
                    }}
                  >
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {h.date}
                    </TableCell>
                    <TableCell>
                      <ChannelBadge channel={h.channel} />
                    </TableCell>
                    <TableCell className="max-w-0 font-medium">
                      <span className="block truncate">{h.name}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      <span className="text-sm">
                        {h.people.toLocaleString()}
                      </span>{' '}
                      <span className="text-xs">{peopleLabel(h.channel)}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap text-sm">
                      {resultsText(h)}
                    </TableCell>
                    <TableCell className="text-right">
                      <StatusIndicator status={h.status} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>

        {/* Mobile cards */}
        <div className="space-y-2 lg:hidden">
          {visible.length === 0 ? (
            <Card className="text-muted-foreground p-6 text-center text-sm">
              No campaigns match your filters.
            </Card>
          ) : (
            paged.map((h) => (
              <Card
                key={h.id}
                role="button"
                tabIndex={0}
                onClick={() => setOpenRow(h)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setOpenRow(h)
                  }
                }}
                className="cursor-pointer gap-1.5 p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-muted-foreground flex items-center gap-2 text-xs">
                    <span>{h.date}</span>
                    <ChannelBadge channel={h.channel} />
                  </div>
                  <StatusIndicator status={h.status} />
                </div>
                <span className="text-foreground truncate text-base font-medium">
                  {h.name}
                </span>
                <span className="text-muted-foreground text-xs">
                  {h.people.toLocaleString()} {peopleLabel(h.channel)} ·{' '}
                  {resultsText(h)}
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
                    currentPage === pageCount &&
                      'pointer-events-none opacity-50',
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

      <CampaignDetailsDrawer
        open={openRow !== null}
        onOpenChange={(o) => !o && setOpenRow(null)}
        row={openRow}
        onDelete={() => {
          if (!openRow) return
          setHistory((prev) => prev.filter((h) => h.id !== openRow.id))
          setOpenRow(null)
        }}
      />

      <SmsCampaignFlow
        open={smsOpen}
        onOpenChange={setSmsOpen}
        onScheduled={(r: ScheduledSms) => {
          const row: HistoryRow = {
            id: `sms-${r.sendAt.getTime()}`,
            date: r.sendAt.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            }),
            scheduledAt: r.sendAt,
            name: r.name,
            channel: 'sms',
            status: 'scheduled',
            people: r.audience.count,
            responses: 0,
            unsubscribes: 0,
            audienceName: r.audience.name,
            audienceFilters: r.audience.filters,
            cost: r.cost,
            costPerOutreach: 0.035,
            receiptId: `rcpt_sms_${r.sendAt.getTime()}`,
          }
          setHistory((prev) => [row, ...prev])
        }}
      />

      <EmailCampaignFlow
        open={emailOpen}
        onOpenChange={setEmailOpen}
        onScheduled={(r: ScheduledEmail) => {
          const row: HistoryRow = {
            id: `email-${r.sendAt.getTime()}`,
            date: r.sendAt.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            }),
            scheduledAt: r.sendAt,
            name: r.name,
            channel: 'email',
            status: 'scheduled',
            people: r.audience.count,
            responses: 0,
            unsubscribes: 0,
            audienceName: r.audience.name,
            audienceFilters: r.audience.filters,
            cost: r.cost,
            costPerOutreach: 0,
            receiptId: null,
          }
          setHistory((prev) => [row, ...prev])
        }}
      />

      <RobocallCampaignFlow
        open={robocallOpen}
        onOpenChange={setRobocallOpen}
        onScheduled={(r: ScheduledRobocall) => {
          const row: HistoryRow = {
            id: `robocall-${r.sendAt.getTime()}`,
            date: r.sendAt.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            }),
            scheduledAt: r.sendAt,
            name: r.name,
            channel: 'robocall',
            status: 'scheduled',
            people: r.audience.count,
            responses: 0,
            unsubscribes: 0,
            answers: 0,
            audienceName: r.audience.name,
            audienceFilters: r.audience.filters,
            cost: r.cost,
            costPerOutreach: 0.045,
            receiptId: `rcpt_robo_${r.sendAt.getTime()}`,
          }
          setHistory((prev) => [row, ...prev])
        }}
      />

      <PollsCampaignFlow
        open={pollOpen}
        onOpenChange={setPollOpen}
        onScheduled={(r: ScheduledPoll) => {
          const row: HistoryRow = {
            id: `poll-${r.sendAt.getTime()}`,
            date: r.sendAt.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            }),
            scheduledAt: r.sendAt,
            name: r.name,
            channel: 'polls',
            status: 'scheduled',
            people: r.audience.count,
            responses: 0,
            unsubscribes: 0,
            audienceName: r.audience.name,
            audienceFilters: r.audience.filters,
            cost: r.cost,
            costPerOutreach: 0.035,
            receiptId: `rcpt_poll_${r.sendAt.getTime()}`,
          }
          setHistory((prev) => [row, ...prev])
        }}
      />
    </ScreenLayout>
  )
}
