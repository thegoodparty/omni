import { AUDIENCE_LABELS_MAPPING } from 'app/dashboard/outreach/constants'
import { AUDIENCE_FILTER_CAMEL_KEYS } from 'app/dashboard/outreach/util/audienceFilterKeyMap'
import { VoterFileFilters } from 'helpers/types'

// Voter Likelihood is Win-only. gp-api reads a Serve list saved before that
// rule without it, so on Serve these chips would name a cut the list never
// applies.
const VOTER_LIKELIHOOD_KEYS = new Set<string>([
  'audienceSuperVoters',
  'audienceLikelyVoters',
  'audienceUnreliableVoters',
  'audienceUnlikelyVoters',
  'audienceUnknown',
])

export const formatAudienceLabels = (
  filters: VoterFileFilters = {},
  isServe = false,
): string[] =>
  AUDIENCE_FILTER_CAMEL_KEYS.filter(
    (k) => Boolean(filters[k]) && !(isServe && VOTER_LIKELIHOOD_KEYS.has(k)),
  )
    .map((k) => AUDIENCE_LABELS_MAPPING[k])
    .filter((label): label is string => Boolean(label))
