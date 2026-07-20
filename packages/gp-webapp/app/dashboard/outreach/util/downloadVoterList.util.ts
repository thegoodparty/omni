import { noop } from '@shared/utils/noop'
import { voterFileDownload } from 'helpers/voterFileDownload'
import { VoterFileFilters } from 'helpers/types'
import { AudienceState } from 'app/dashboard/components/tasks/flows/util/flowHandlers.util'
import type { AudienceFilterKey } from 'app/dashboard/components/tasks/flows/CustomVoterAudienceFilters'

interface DownloadVoterListParams {
  voterFileFilter?: VoterFileFilters | AudienceState
  outreachType?: string
}

// TODO: Fix the keys for the audience values in the CustomVoterAudienceFilters:
//  https://goodparty.atlassian.net/browse/WEB-4277
// If making a change, also update:
// gp-webapp/app/dashboard/outreach/util/downloadVoterList.util.ts
// gp-webapp/app/dashboard/components/tasks/flows/util/flowHandlers.util.ts
// gp-webapp/app/dashboard/outreach/util/convertAudienceFiltersForModal.util.ts
// gp-webapp/app/dashboard/outreach/util/formatAudienceLabels.util.ts
// gp-webapp/app/dashboard/outreach/constants.tsx
// Maps each underscore filter key the API expects to its VoterFileFilters
// camelCase equivalent. Task flows (DownloadStep) pass AudienceState, which is
// already keyed by these underscore names; outreach actions pass
// VoterFileFilters, which uses the camelCase names.
const AUDIENCE_FILTER_KEY_MAP: Record<
  Exclude<AudienceFilterKey, 'audience_request'>,
  keyof VoterFileFilters
> = {
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
}

const AUDIENCE_STATE_KEYS = Object.keys(AUDIENCE_FILTER_KEY_MAP) as Array<
  Exclude<AudienceFilterKey, 'audience_request'>
>

// AudienceState is keyed by the underscore filter names; VoterFileFilters never
// is (it uses camelCase like age18_25). So the presence of any underscore key
// reliably identifies the AudienceState shape — including age/gender-only
// selections that omit the audience_/party_ groups.
const isAudienceState = (
  filter: VoterFileFilters | AudienceState,
): filter is AudienceState => AUDIENCE_STATE_KEYS.some((key) => key in filter)

export const downloadVoterList = async (
  { voterFileFilter = {}, outreachType = '' }: DownloadVoterListParams = {},
  setLoading: (loading: boolean) => void = noop,
  errorSnackbar: (message: string) => void = noop,
): Promise<void> => {
  setLoading(true)

  const selectedAudience = isAudienceState(voterFileFilter)
    ? AUDIENCE_STATE_KEYS.filter((key) => voterFileFilter[key] === true)
    : AUDIENCE_STATE_KEYS.filter(
        (key) => voterFileFilter[AUDIENCE_FILTER_KEY_MAP[key]] === true,
      )

  try {
    await voterFileDownload(outreachType, { filters: selectedAudience })
  } catch {
    errorSnackbar('Error downloading voter file')
  }

  setLoading(false)
}
