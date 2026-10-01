import { LoaderCircleIcon } from '@styleguide'
import type { BriefingSummary } from '@shared/briefings/types'

type PillVariant = {
  label: string
  className: string
  icon?: React.ReactNode
}

// Explicit switch keeps every userAgendaStatus enum value handled. The
// 'completed' case happens in the brief window between the agent finishing
// and the MeetingBriefing row landing locally — without the explicit branch
// the surface defaults to "Awaiting agenda" which is a misleading label.
// Shared by AwaitingAgendaRow (list) and UpcomingCountdownCard (landing) so
// both surfaces label an in-progress user agenda identically.
/**
 * Turn gp-api's machine reason for a rejected agenda into words. The reason
 * is a short prefixed string; anything unrecognized gets the generic label.
 */
export const labelForRejection = (
  reason: string | null | undefined,
): string => {
  if (!reason) return "Couldn't use that agenda"
  const [kind, ...rest] = reason.split(':')
  if (kind === 'packet_date_mismatch') {
    const stated = rest[0]
    return stated && stated !== 'unknown'
      ? `Agenda is for a different meeting (dated ${stated})`
      : 'Agenda is for a different meeting'
  }
  if (kind === 'agenda_unavailable') return 'Agenda not available yet'
  return "Couldn't use that agenda"
}

export const pillForAgendaStatus = (
  status: BriefingSummary['userAgendaStatus'],
  reason?: BriefingSummary['userAgendaReason'],
): PillVariant => {
  switch (status) {
    case 'rejected':
      return {
        label: labelForRejection(reason),
        className: 'bg-destructive/10 text-destructive',
      }
    case 'processing':
      return {
        label: 'Processing your agenda…',
        className: 'bg-primary/10 text-primary',
        icon: <LoaderCircleIcon className="size-3 animate-spin" aria-hidden />,
      }
    case 'failed':
      return {
        label: 'Briefing failed',
        className: 'bg-destructive/10 text-destructive',
      }
    case 'completed':
      // Race window: agent finished, briefing row not yet upserted into
      // local DB. Render a brief "Finishing up" pill instead of bouncing
      // back to "Awaiting agenda."
      return {
        label: 'Finishing up…',
        className: 'bg-primary/10 text-primary',
        icon: <LoaderCircleIcon className="size-3 animate-spin" aria-hidden />,
      }
    case 'unknown':
    case null:
    case undefined:
      return {
        label: 'Awaiting agenda',
        className: 'bg-muted text-muted-foreground',
      }
  }
}

export default function AgendaStatusPill({
  status,
  reason,
}: {
  status: BriefingSummary['userAgendaStatus']
  reason?: BriefingSummary['userAgendaReason']
}): React.JSX.Element {
  const pill = pillForAgendaStatus(status, reason)
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${pill.className}`}
    >
      {pill.icon}
      {pill.label}
    </span>
  )
}
