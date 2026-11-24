import { addHours, format, isValid, parse, startOfDay } from 'date-fns'

// The send date an agent card suggested ("YYYY-MM-DD"), as the local day the
// schedule step's picker holds. Undefined for a string that is not a real
// calendar day and for a day the picker would disable: the earliest day is the
// one the 48-hour floor lands on, which also rules out every past day. The
// official picks the day instead, as they would with no suggestion.
export const seedSendDate = (
  raw: string | undefined,
  now: number = Date.now(),
): Date | undefined => {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined
  const day = parse(raw, 'yyyy-MM-dd', new Date(now))
  // parse() rolls nothing over, but guard the round trip anyway.
  if (!isValid(day) || format(day, 'yyyy-MM-dd') !== raw) return undefined
  return day.getTime() < startOfDay(addHours(now, 48)).getTime()
    ? undefined
    : day
}
