// The server checks that scheduledLocalDate is the Eastern calendar day of
// sendAt, so the new instant is built in ET from the picked day plus the
// row's existing ET time of day — only the day moves; the candidate's
// wall-clock start (scheduledLocalTime) is untouched and Peerly rebooks at it.
const ET_TIME_ZONE = 'America/New_York'

export const etParts = (value: Date): { date: string; time: string } => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ET_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value)
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  }
}

// ET wall time -> instant: guess the wall time as UTC, read the guess back
// in ET, and correct by the difference. A second pass settles a guess that
// crossed a DST boundary.
export const etToInstant = (dateStr: string, timeStr: string): Date => {
  let instant = new Date(`${dateStr}T${timeStr}:00Z`)
  for (let pass = 0; pass < 2; pass++) {
    const seen = etParts(instant)
    const seenAsUtc = new Date(`${seen.date}T${seen.time}:00Z`)
    const target = new Date(`${dateStr}T${timeStr}:00Z`)
    instant = new Date(
      instant.getTime() - (seenAsUtc.getTime() - target.getTime())
    )
  }
  return instant
}
