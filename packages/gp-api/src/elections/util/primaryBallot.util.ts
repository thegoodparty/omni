// States whose partisan primaries put every candidate on one ballot,
// whatever their party.
const ALL_CANDIDATE_PRIMARY_STATES = new Set(['AK', 'CA', 'LA', 'WA'])

// Onboarding turns away major-party candidates, so in a partisan race ours
// reach the general ballot by petition and never run in the party primary,
// except in the states above. Ballot-qualified minor parties that hold their
// own primaries (NY Conservative, some Libertarian state parties) are caught
// too, because onboarding records them as independent.
export const candidateRunsInPrimary = (
  state: string | null | undefined,
  partisanType: string | null | undefined,
): boolean =>
  partisanType !== 'partisan' ||
  ALL_CANDIDATE_PRIMARY_STATES.has((state ?? '').toUpperCase())
