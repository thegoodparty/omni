import { type OutreachEventDetails } from '@goodparty_org/contracts'
import { format, parse } from 'date-fns'

const formatEventDate = (date: string): string =>
  format(parse(date, 'yyyy-MM-dd', new Date()), 'EEEE, MMMM d')

const formatEventTime = (time: string): string =>
  format(parse(time, 'HH:mm', new Date()), 'h:mm a')

// The sender is shown every draft before it goes anywhere, and the webapp
// will not send one with a bracket left in it, so a blank to fill is a dead
// end. Without details the logistics are left out instead.
export const NO_EVENT_DETAILS_RULE =
  'No event date, time or place was given. Do not mention when or where ' +
  'the event is, do not invent either, and never leave a placeholder or ' +
  'blank for them.'

// The logistics block for a fresh event-invite draft, shared by every channel
// that drafts one. Empty for any other purpose.
export const eventDetailsContext = (
  purpose: string,
  event: OutreachEventDetails | undefined,
): string[] => {
  if (purpose !== 'event_invite') return []
  if (!event) return [NO_EVENT_DETAILS_RULE]
  return [
    'Event details. Write the date, time and place in exactly as given ' +
      'here, never as a placeholder:',
    `Date: ${formatEventDate(event.date)}`,
    `Time: ${formatEventTime(event.time)}`,
    `Location: ${event.location.replace(/\s+/g, ' ').trim()}`,
  ]
}
