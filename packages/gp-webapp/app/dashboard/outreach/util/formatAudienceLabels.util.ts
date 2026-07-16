import { AUDIENCE_LABELS_MAPPING } from 'app/dashboard/outreach/constants'
import { AUDIENCE_FILTER_CAMEL_KEYS } from 'app/dashboard/outreach/util/audienceFilterKeyMap'
import { VoterFileFilters } from 'helpers/types'

export const formatAudienceLabels = ({
  audienceSuperVoters,
  audienceLikelyVoters,
  audienceUnreliableVoters,
  audienceUnlikelyVoters,
  audienceFirstTimeVoters,
  partyIndependent,
  partyDemocrat,
  partyRepublican,
  age18_25,
  age25_35,
  age35_50,
  age50Plus,
  genderMale,
  genderFemale,
  genderUnknown,
}: VoterFileFilters = {}): string[] => {
  const filtersFields: VoterFileFilters = {
    audienceSuperVoters,
    audienceLikelyVoters,
    audienceUnreliableVoters,
    audienceUnlikelyVoters,
    audienceFirstTimeVoters,
    partyIndependent,
    partyDemocrat,
    partyRepublican,
    age18_25,
    age25_35,
    age35_50,
    age50Plus,
    genderMale,
    genderFemale,
    genderUnknown,
  }
  return AUDIENCE_FILTER_CAMEL_KEYS.filter((k) => Boolean(filtersFields[k]))
    .map((k) => AUDIENCE_LABELS_MAPPING[k])
    .filter((label): label is string => Boolean(label))
}
