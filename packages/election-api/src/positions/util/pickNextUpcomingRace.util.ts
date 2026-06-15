import type { Race } from '../../generated/prisma'

export type RaceForNextElection = Pick<
  Race,
  'electionDate' | 'isPrimary' | 'isRunoff'
>

// The election a re-election candidate runs in next is the position's nearest
// *future* general election. Primaries and runoffs are excluded outright (not
// just deprioritized): the general is the seat's decisive race, and dating a
// campaign to a primary would be wrong. Returns null when no future general
// exists — "no upcoming election" must stay null so callers can detect it
// rather than silently target a primary or an election that already happened.
export const pickNextUpcomingRace = (
  races: RaceForNextElection[],
  now: Date,
): RaceForNextElection | null => {
  // Compare on the UTC calendar day, not the instant. electionDate is stored at
  // UTC midnight, so an instant comparison would flip a same-day election to
  // "past" once the UTC clock ticks past midnight on election day — while polls
  // are still open across US timezones. Truncate now to its UTC midnight.
  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  )
  const future = races
    .filter((r) => !r.isPrimary && !r.isRunoff)
    .filter((r) => r.electionDate.getTime() >= todayUtc)
    .sort((a, b) => a.electionDate.getTime() - b.electionDate.getTime())
  return future[0] ?? null
}
