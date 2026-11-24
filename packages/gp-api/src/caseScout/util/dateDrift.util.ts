import { formatInTimeZone } from 'date-fns-tz'

// The drafter invents event dates to de-identify a case, and can move a past
// event into the future ("the 2028 general election" for a 2026 chat). The
// agent under test is told the real date every turn, so such a case tests
// nothing. A person decides what to do with one; this only finds it.

// A standalone 19xx or 20xx. Not one inside a money amount or a decimal, and
// not the year half of a short hyphenated identifier (an ordinance number
// such as 245-2028, or a phone line such as 555-2028), which the drafter
// invents and the agent cannot check. A year range (2026-2028) still counts.
const YEAR = /(?<![$.]|(?:^|\D)\d{1,3}-)\b(?:19|20)\d{2}\b(?!\.\d)/g

const yearsIn = (texts: string[]): number[] =>
  texts.flatMap((text) => [...text.matchAll(YEAR)].map(([y]) => Number(y)))

export type DateDrift = { years: number[]; sessionYear: number; reason: string }

// Flags a draft whose user turns name a year after the chat's own (UTC) year
// when nothing in the chat named one. A future year the user really asked
// about is in the source, so a draft that moves it further out still passes.
export const findDateDrift = ({
  userTurns,
  sourceTexts,
  sessionStartedAt,
}: {
  userTurns: string[]
  sourceTexts: string[]
  sessionStartedAt: Date
}): DateDrift | undefined => {
  const sessionYear = Number(formatInTimeZone(sessionStartedAt, 'UTC', 'yyyy'))
  if (yearsIn(sourceTexts).some((year) => year > sessionYear)) return undefined
  const years = [
    ...new Set(yearsIn(userTurns).filter((year) => year > sessionYear)),
  ].sort((a, b) => a - b)
  if (years.length === 0) return undefined
  return {
    years,
    sessionYear,
    reason: `names ${years.join(' and ')}; the chat is from ${sessionYear}`,
  }
}
