import type { Race } from '../../generated/prisma'

export type RaceForNextElection = Pick<
  Race,
  'electionDate' | 'isPrimary' | 'isRunoff'
>

// The election a re-election candidate runs in next is the position's nearest
// *future* general election — primaries and runoffs are excluded because the
// general is the seat's decisive race. Unlike pickRelevantRace, this never
// falls back to a past race: "no upcoming election" must stay null so callers
// can detect it rather than silently target an election that already happened.
export const pickNextUpcomingRace = (
  races: RaceForNextElection[],
  now: Date,
): RaceForNextElection | null => {
  const general = races.filter((r) => !r.isPrimary && !r.isRunoff)
  const pool = general.length > 0 ? general : races
  const future = pool
    .filter((r) => r.electionDate.getTime() >= now.getTime())
    .sort((a, b) => a.electionDate.getTime() - b.electionDate.getTime())
  return future[0] ?? null
}
