import { useState } from 'react'
import Link from 'next/link'
import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import {
  cn,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@styleguide'
import {
  ArchiveIcon,
  BellIcon,
  XCircleIcon,
} from '@styleguide/components/ui/icons'
import { useOrganization } from '@shared/organization-picker'
import { cardCategory } from './cardCategory'
import { useDashboardCards, useDismissCard } from '../data/use-dashboard'
import type { DashboardCard } from '../data/contracts'

// The heads-up inbox. The conversation replaced the card stack on the home, and
// these are the things that used to live there: a briefing for an upcoming
// meeting, a single agenda item worth reading before it, and a new or trending
// community issue. Every one is an event with a place to go, which is why it
// reads as a row that navigates rather than a card with an action.
//
// Built on DashboardCard, which was already a notifications table in all but
// name: typed source, title, summary, a destination, a due date, a dismissal
// timestamp, and a unique key per source item so a regenerated card updates
// instead of duplicating. `active` is the inbox, `skipped` is the archive.

// Relative where it reads better than a date, absolute past a week. An overdue
// item says so rather than quietly showing a date that has gone by.
const dueLabel = (iso: string): string => {
  const due = parseISO(iso)
  const days = differenceInCalendarDays(due, new Date())
  if (days < -1) return `${Math.abs(days)} days ago`
  if (days === -1) return 'Yesterday'
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days <= 6) return format(due, 'EEEE')
  return format(due, 'MMM d')
}

const NotificationRow = ({
  card,
  onOpen,
  onDismiss,
}: {
  card: DashboardCard
  onOpen: () => void
  onDismiss?: (id: string) => void
}): React.JSX.Element => {
  const { label, Icon } = cardCategory(card.type)
  const overdue =
    differenceInCalendarDays(parseISO(card.dueDate), new Date()) < 0

  return (
    <div className="group relative">
      <Link
        href={card.ctaHref}
        onClick={onOpen}
        className="flex gap-3 px-3 py-3 transition-colors hover:bg-muted focus-visible:bg-muted"
      >
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[11px] font-semibold tracking-[.04em] text-muted-foreground">
            {label}
          </span>
          <span className="text-sm font-semibold leading-snug text-foreground">
            {card.title}
          </span>
          {/* Clamped: these summaries are agent-written and run several
              sentences, which turns a scannable row into a paragraph. */}
          <span className="line-clamp-2 text-[13px] leading-[1.45] text-muted-foreground">
            {card.summary}
          </span>
          <span
            className={cn(
              'text-xs font-semibold',
              overdue ? 'text-destructive' : 'text-primary',
            )}
          >
            {dueLabel(card.dueDate)}
          </span>
        </span>
      </Link>
      {/* Outside the Link, not inside it: a button nested in an anchor is
          invalid and the click would navigate as well as dismiss. */}
      {onDismiss && (
        <IconButton
          aria-label={`Dismiss ${card.title}`}
          variant="ghost"
          className="absolute top-2 right-2 !h-7 !w-7 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => onDismiss(card.id)}
        >
          <XCircleIcon className="size-4" aria-hidden />
        </IconButton>
      )}
    </div>
  )
}

const EmptyState = ({ archived }: { archived: boolean }): React.JSX.Element => (
  <p className="px-3 py-8 text-center text-sm text-muted-foreground">
    {archived
      ? 'Nothing archived yet.'
      : 'No new briefings or issues right now.'}
  </p>
)

/**
 * Serve-only. The bell rides in the shell chrome, which Win renders too, and
 * the cards endpoint is scoped to an elected office: a Win user calling it
 * would get a 4xx for rows they can never have. Gating in a wrapper rather
 * than inside the panel keeps the data hooks from mounting at all, and keeps
 * every call site from having to remember the check.
 */
export default function NotificationsInbox(): React.JSX.Element | null {
  const organization = useOrganization()
  return organization?.electedOfficeId ? <Inbox /> : null
}

function Inbox(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [archived, setArchived] = useState(false)
  const { data: active } = useDashboardCards('active')
  // Only fetched once the archive tab is actually opened.
  const { data: skipped } = useDashboardCards(archived ? 'skipped' : 'active')
  const dismiss = useDismissCard()

  const unread = active?.length ?? 0
  const rows = (archived ? skipped : active) ?? []

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          aria-label={
            unread > 0 ? `Notifications, ${unread} new` : 'Notifications'
          }
          variant="ghost"
          className="relative !h-8 !w-8"
        >
          <BellIcon className="size-[18px]" aria-hidden />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold">
            {archived ? 'Archive' : 'Notifications'}
          </span>
          <IconButton
            aria-label={archived ? 'Back to notifications' : 'View archive'}
            variant="ghost"
            className="!h-7 !w-7"
            onClick={() => setArchived((v) => !v)}
          >
            {archived ? (
              <BellIcon className="size-4" aria-hidden />
            ) : (
              <ArchiveIcon className="size-4" aria-hidden />
            )}
          </IconButton>
        </div>
        <div className="max-h-[26rem] divide-y divide-border overflow-y-auto">
          {rows.length === 0 ? (
            <EmptyState archived={archived} />
          ) : (
            rows.map((card) => (
              <NotificationRow
                key={card.id}
                card={card}
                onOpen={() => setOpen(false)}
                // An archived row has nowhere further to go: dismissing is
                // what put it here.
                onDismiss={archived ? undefined : (id) => dismiss.mutate(id)}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
