import type { AudienceFilterKey } from 'app/dashboard/components/tasks/flows/CustomVoterAudienceFilters'
import type { VoterFileFilters } from 'helpers/types'

// The audience form (CustomVoterAudienceFilters / AudienceState) keys its checkbox
// state with underscore snake_case names, while VoterFileFilters — the API/persistence
// shape — uses camelCase. These two vocabularies must be kept in lockstep, so the
// single source of truth for that translation lives here (WEB-4277 previously required
// hand-syncing the same mapping across ~6 files).

// Snake_case audience keys, excluding `audience_request` which is free text with no
// camelCase VoterFileFilters counterpart.
export type AudienceFilterSnakeKey = Exclude<
  AudienceFilterKey,
  'audience_request'
>

// Maps each snake_case audience key to its camelCase VoterFileFilters equivalent.
// `satisfies` guarantees the keys cover exactly AudienceFilterSnakeKey and every value
// is a real VoterFileFilters field, while `as const` preserves the literal value types
// so the camelCase union can be derived from the map itself.
export const AUDIENCE_FILTER_KEY_MAP = {
  audience_superVoters: 'audienceSuperVoters',
  audience_likelyVoters: 'audienceLikelyVoters',
  audience_unreliableVoters: 'audienceUnreliableVoters',
  audience_unlikelyVoters: 'audienceUnlikelyVoters',
  audience_firstTimeVoters: 'audienceFirstTimeVoters',
  party_independent: 'partyIndependent',
  party_democrat: 'partyDemocrat',
  party_republican: 'partyRepublican',
  age_18_25: 'age18_25',
  age_25_35: 'age25_35',
  age_35_50: 'age35_50',
  age_50_plus: 'age50Plus',
  age_18_24: 'age18_24',
  age_25_34: 'age25_34',
  age_35_49: 'age35_49',
  age_50_64: 'age50_64',
  age_65_plus: 'age65Plus',
  gender_male: 'genderMale',
  gender_female: 'genderFemale',
  gender_unknown: 'genderUnknown',
} as const satisfies Record<AudienceFilterSnakeKey, keyof VoterFileFilters>

// CamelCase VoterFileFilters keys that participate in audience mapping.
export type AudienceFilterCamelKey =
  (typeof AUDIENCE_FILTER_KEY_MAP)[AudienceFilterSnakeKey]

// Inverse (camelCase -> snake_case) derived from the canonical map so the two can
// never drift apart.
export const VOTER_FILE_FILTER_KEY_MAP = Object.fromEntries(
  Object.entries(AUDIENCE_FILTER_KEY_MAP).map(([snakeKey, camelKey]) => [
    camelKey,
    snakeKey,
  ]),
) as Record<AudienceFilterCamelKey, AudienceFilterSnakeKey>

// Ordered key lists (insertion order of the canonical map) for callers that iterate.
export const AUDIENCE_FILTER_SNAKE_KEYS = Object.keys(
  AUDIENCE_FILTER_KEY_MAP,
) as AudienceFilterSnakeKey[]

export const AUDIENCE_FILTER_CAMEL_KEYS = Object.values(
  AUDIENCE_FILTER_KEY_MAP,
) as AudienceFilterCamelKey[]

export const snakeToCamelAudienceKey = (
  key: AudienceFilterSnakeKey,
): AudienceFilterCamelKey => AUDIENCE_FILTER_KEY_MAP[key]

export const camelToSnakeAudienceKey = (
  key: AudienceFilterCamelKey,
): AudienceFilterSnakeKey => VOTER_FILE_FILTER_KEY_MAP[key]
