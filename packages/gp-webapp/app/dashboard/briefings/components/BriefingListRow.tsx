'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { Button } from '@styleguide'
import { formatDayTime, formatShortDate } from '@shared/briefings/dateHelpers'
import type { BriefingSummary, BriefingStatus } from '@shared/briefings/types'
import UploadAgendaModal from './UploadAgendaModal'

type Props = {
  summary: BriefingSummary
  /**
   * Offer a "Replace agenda" control on a row that already has a briefing.
   * On by the Upcoming list, off for Past, where re-briefing a meeting that
   * has happened has no use.
   */
  allowReplace?: boolean
}

type PillVariant = {
  label: string
  className: string
}

function pillFor(status: BriefingStatus): PillVariant | null {
  if (status === 'briefing_ready') {
    return {
      label: 'Briefing ready',
      className: 'bg-success-100 text-success-700',
    }
  }
  if (status === 'awaiting_agenda') {
    return {
      label: 'Awaiting agenda',
      className: 'bg-muted text-muted-foreground',
    }
  }
  return null
}

/**
 * One row in the Upcoming list. Open-circle indicator dot, short date,
 * full date + time, meeting name, status pill, chevron.
 *
 * Clicking the row navigates to the briefing detail page. Rows for
 * Awaiting agenda briefings link to the same route; the detail page
 * decides what to render (briefing content vs an awaiting state).
 *
 * A ready row in the Upcoming list also carries a "Replace agenda" control,
 * so a briefing built from the wrong or an outdated packet is not permanent:
 * the official pastes the right link and the new run replaces the row.
 */
export default function BriefingListRow({
  summary,
  allowReplace = false,
}: Props): React.JSX.Element {
  const [replaceOpen, setReplaceOpen] = useState(false)
  const pill = pillFor(summary.status)
  const shortDate = formatShortDate(summary.scheduledAt)
  const dayTime = formatDayTime(summary.scheduledAt)
  const showReplace = allowReplace && summary.status === 'briefing_ready'
  const replaceDisabled = summary.userAgendaStatus === 'processing'
  const meetingName = summary.meetingName || 'Your meeting'

  return (
    <div className="flex w-full items-center gap-2 pr-4 transition-colors hover:bg-muted/60 focus-within:bg-muted/60">
      <Link
        href={`/dashboard/briefings/${summary.slug}`}
        className="group flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left focus:outline-none"
      >
        {/* Indicator dot - open circle for upcoming */}
        <span
          aria-hidden
          className="inline-block size-2.5 shrink-0 rounded-full border-2 border-current text-muted-foreground/60"
        />

        {/* Date column: short on mobile, full on md+ */}
        <span className="shrink-0 text-xs font-medium text-muted-foreground">
          <span className="inline-block w-16 md:hidden">{shortDate}</span>
          <span className="hidden w-52 md:inline-block">
            {shortDate} · {dayTime}
          </span>
        </span>

        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {summary.meetingName}
        </span>

        {pill ? (
          <span
            className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${pill.className}`}
          >
            {pill.label}
          </span>
        ) : null}

        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
      </Link>

      {showReplace ? (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={replaceDisabled}
            aria-label={`Replace agenda for ${meetingName}`}
            onClick={() => setReplaceOpen(true)}
          >
            Replace agenda
          </Button>
          <UploadAgendaModal
            open={replaceOpen}
            onOpenChange={setReplaceOpen}
            meetingDate={summary.slug}
            meetingName={meetingName}
          />
        </>
      ) : null}
    </div>
  )
}
