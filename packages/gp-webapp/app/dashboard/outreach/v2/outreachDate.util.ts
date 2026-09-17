import { format, parseISO } from 'date-fns'

// Prototype date display ("Sent Sep 8") — short month, no year.
//
// Not dateUsHelper: its +8h shim exists for date-only values parsed as UTC
// midnight, and applied to the real send instants v2 rows carry it pushes any
// send scheduled in the evening onto the next calendar day (Sep 7 23:00Z
// rendered "Sep 8"). Format real instants in the viewer's timezone; a
// midnight-UTC timestamp is a legacy date-only value, so keep its UTC
// calendar day instead of letting western timezones shift it a day back.
export const shortOutreachDate = (raw: string | Date): string => {
  if (typeof raw !== 'string') return format(raw, 'MMM d')
  const dateOnly = /^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.000)?Z)?$/.exec(raw)
  return format(parseISO(dateOnly?.[1] ?? raw), 'MMM d')
}
