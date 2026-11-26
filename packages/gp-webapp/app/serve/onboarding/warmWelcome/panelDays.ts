import { addDays, format, isAfter, isWeekend, startOfDay } from 'date-fns'
import { WARM_WELCOME_COPY } from './warmWelcomeConfig'

// When the first Civic Panel invites go out. The rules are gp-api's: a day
// the official picks, tomorrow at the earliest, never a weekend (staff do
// not send then), and no further out than the server allows.

// The waves run for about two weeks from the first send.
const BUILD_DAYS = 14

export type SendChoice = 'first' | 'weekday' | 'sworn' | 'pick'

export interface SendOption {
  key: SendChoice
  label: string
  // "Tue, Nov 24 at 11 am", or "Any day at 11 am" for the picker.
  sub: string
  // Null for "Pick a day", which opens a date field.
  date: Date | null
}

const pastWeekend = (day: Date): Date => {
  let next = day
  while (isWeekend(next)) next = addDays(next, 1)
  return next
}

// Tomorrow, or Monday when tomorrow is a weekend day.
export const earliestSend = (today: Date): Date =>
  pastWeekend(addDays(startOfDay(today), 1))

export const latestSend = (today: Date, maxDaysOut: number): Date =>
  addDays(startOfDay(today), maxDaysOut)

const nextTuesdayOrThursday = (from: Date): Date => {
  let day = startOfDay(from)
  while (day.getDay() !== 2 && day.getDay() !== 4) day = addDays(day, 1)
  return day
}

// "11 am"
export const sendHourLabel = (hour: number): string =>
  `${((hour + 11) % 12) + 1} ${hour < 12 ? 'am' : 'pm'}`

// "Tuesday, November 24"
export const sendDayLong = (day: Date): string => format(day, 'EEEE, MMMM d')

// The Monday of the week the panel should be ready, as "December 7".
export const readyWeekLabel = (firstSend: Date): string => {
  const done = addDays(firstSend, BUILD_DAYS)
  return format(addDays(done, -((done.getDay() + 6) % 7)), 'MMMM d')
}

// The days most officials would want: the earliest, the next Tuesday or
// Thursday (those get the most replies), after they take office, and any
// day they choose. "After I'm sworn in" is offered when their first day in
// office is known, later than the weekday on offer, and within reach; a
// weekend moves to the Monday after.
export const sendOptions = ({
  today,
  swornIn,
  sendHour,
  maxDaysOut,
}: {
  today: Date
  swornIn: Date | null
  sendHour: number
  maxDaysOut: number
}): SendOption[] => {
  const copy = WARM_WELCOME_COPY.residents
  const at = ` at ${sendHourLabel(sendHour)}`
  const short = (day: Date): string => `${format(day, 'EEE, MMM d')}${at}`
  const first = earliestSend(today)
  const weekday = nextTuesdayOrThursday(addDays(first, 1))
  const sworn = swornIn ? pastWeekend(startOfDay(swornIn)) : null
  const tomorrow = first.getTime() === addDays(startOfDay(today), 1).getTime()
  return [
    {
      key: 'first',
      label: tomorrow ? copy.tomorrow : copy.monday,
      sub: short(first),
      date: first,
    },
    {
      key: 'weekday',
      label: format(weekday, 'EEEE'),
      sub: short(weekday),
      date: weekday,
    },
    ...(sworn &&
    isAfter(sworn, weekday) &&
    !isAfter(sworn, latestSend(today, maxDaysOut))
      ? [
          {
            key: 'sworn' as const,
            label: copy.sworn,
            sub: short(sworn),
            date: sworn,
          },
        ]
      : []),
    { key: 'pick', label: copy.pick, sub: `${copy.anyDay}${at}`, date: null },
  ]
}

// Whether a day typed into the date field is one the invites can start on.
export const canSendOn = (
  day: Date,
  today: Date,
  maxDaysOut: number,
): boolean =>
  !isWeekend(day) &&
  !isAfter(earliestSend(today), day) &&
  !isAfter(day, latestSend(today, maxDaysOut))
