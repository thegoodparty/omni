import { RaceListItem } from '@goodparty_org/contracts'

export type RaceTimeframe = 'future' | 'past'

// Test state pins a real office for its district and voter data, never its
// election date: the caller sets that from a preset. So an office whose
// election has passed still resolves, to its most recent past race, and the
// lookup only fails when the office does not exist at that zip at all.
//
// Imported by the judge sweep (src/chats/evals/judge), which runs outside the
// Nest app, so this file stays free of `@/` imports and Nest providers.
export const resolveFixtureRace = async (
  office: string,
  search: (timeframe: RaceTimeframe) => Promise<RaceListItem[]>,
): Promise<RaceListItem | undefined> => {
  const upcoming = (await search('future')).find(
    (race) => race.position.name === office,
  )
  if (upcoming) {
    return upcoming
  }
  const past = (await search('past')).filter(
    (race) => race.position.name === office,
  )
  // electionDay is yyyy-MM-dd, so string order is date order.
  return past.sort((a, b) =>
    b.election.electionDay.localeCompare(a.election.electionDay),
  )[0]
}
