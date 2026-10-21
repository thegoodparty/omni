import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  OutreachEventDetailsSchema,
  type OutreachEventDetails,
  type ProposalEvent,
} from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'

// Every channel's event-invite slug, on Win and Serve alike.
export const EVENT_INVITE_PURPOSE = 'event_invite'

export const isEventInvite = (purpose: string | null): boolean =>
  purpose === EVENT_INVITE_PURPOSE

export interface EventDetailsDraft {
  date: string
  time: string
  location: string
}

export const EMPTY_EVENT_DETAILS: EventDetailsDraft = {
  date: '',
  time: '',
  location: '',
}

export const EVENT_DETAILS_TITLE = 'When and where is the event?'

const todayIso = (): string => format(new Date(), 'yyyy-MM-dd')

export const eventDateHasPassed = (date: string): boolean =>
  date !== '' && date < todayIso()

// The request shape, or null while anything is missing or the day has passed.
export const completeEventDetails = (
  draft: EventDetailsDraft,
): OutreachEventDetails | null => {
  if (eventDateHasPassed(draft.date)) return null
  const parsed = OutreachEventDetailsSchema.safeParse(draft)
  return parsed.success ? parsed.data : null
}

interface Prefill {
  details: EventDetailsDraft
  note: string | null
}

const NO_PREFILL: Prefill = { details: EMPTY_EVENT_DETAILS, note: null }

const fromProposal = (proposed: ProposalEvent | undefined): Prefill | null =>
  proposed && (proposed.date || proposed.time || proposed.location)
    ? {
        details: {
          date: proposed.date ?? '',
          time: proposed.time ?? '',
          location: proposed.location ?? '',
        },
        note: "We filled in what we know, so change anything that's different.",
      }
    : null

// An official's next public meeting is the event they most often invite
// constituents to, and the meetings list already carries its date, time and
// place. Serve only: a candidate has no meeting schedule.
const useNextMeeting = (enabled: boolean) => {
  const { data } = useQuery({
    queryKey: ['outreach', 'event-details', 'meetings'],
    queryFn: () =>
      clientRequest('GET /v1/meetings', {}).then((res) => res.data),
    enabled,
    retry: false,
    staleTime: 5 * 60 * 1000,
  })
  if (!enabled || !data) return null
  const today = todayIso()
  return (
    [...data.meetings]
      .filter((m) => m.meetingDate >= today)
      .sort((a, b) => a.meetingDate.localeCompare(b.meetingDate))[0] ?? null
  )
}

/**
 * The event invite's date, time and place, as the flow's details step shows
 * them. Until the official types, the fields follow the best source there is:
 * what an agent handed in, else (Serve) the next public meeting.
 */
export const useEventDetails = ({
  enabled,
  isServe,
  proposed,
}: {
  enabled: boolean
  isServe: boolean
  proposed?: ProposalEvent
}) => {
  const fromAgent = fromProposal(proposed)
  const meeting = useNextMeeting(enabled && isServe && fromAgent === null)
  const [typed, setTyped] = useState<EventDetailsDraft | null>(null)

  const prefill: Prefill =
    fromAgent ??
    (meeting
      ? {
          details: {
            date: meeting.meetingDate,
            time: /^\d{2}:\d{2}$/.test(meeting.meetingTime)
              ? meeting.meetingTime
              : '',
            location: meeting.location ?? '',
          },
          note: `We filled in your next ${meeting.meetingName || 'meeting'}, so change anything that's different.`,
        }
      : NO_PREFILL)

  const details = typed ?? prefill.details
  const reset = useCallback(() => setTyped(null), [])
  return {
    details,
    setDetails: setTyped,
    prefillNote: typed === null ? prefill.note : null,
    event: completeEventDetails(details),
    reset,
  }
}
