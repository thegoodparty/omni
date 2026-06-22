import { noop } from '@shared/utils/noop'
import { voterFileDownload } from 'helpers/voterFileDownload'
import { VoterFileFilters } from 'helpers/types'
import { AudienceState } from 'app/dashboard/components/tasks/flows/util/flowHandlers.util'
import type { AudienceFilterKey } from 'app/dashboard/voter-records/components/CustomVoterAudienceFilters'

interface DownloadVoterListParams {
  voterFileFilter?: VoterFileFilters | AudienceState
  outreachType?: string
}

// Task flows (DownloadStep) pass AudienceState, whose keys already match the
// underscore filter names the API expects. Outreach actions pass
// VoterFileFilters, which uses camelCase and must be mapped. AudienceState is
// always seeded with these keys by CustomVoterAudienceFilters, so their
// presence reliably distinguishes the two shapes.
const isAudienceState = (
  filter: VoterFileFilters | AudienceState,
): filter is AudienceState =>
  'audience_superVoters' in filter || 'party_independent' in filter

export const downloadVoterList = async (
  { voterFileFilter = {}, outreachType = '' }: DownloadVoterListParams = {},
  setLoading: (loading: boolean) => void = noop,
  errorSnackbar: (message: string) => void = noop,
): Promise<void> => {
  setLoading(true)

  // TODO: Fix the keys for the audience values in the CustomVoterAudienceFilters:
  //  https://goodparty.atlassian.net/browse/WEB-4277
  // If making a change, also update:
  // gp-webapp/app/dashboard/outreach/util/downloadVoterList.util.ts
  // gp-webapp/app/dashboard/components/tasks/flows/util/flowHandlers.util.ts
  // gp-webapp/app/dashboard/outreach/util/convertAudienceFiltersForModal.util.ts
  // gp-webapp/app/dashboard/outreach/util/formatAudienceLabels.util.ts
  // gp-webapp/app/dashboard/outreach/constants.tsx
  const audience: Record<
    Exclude<AudienceFilterKey, 'audience_request'>,
    boolean | undefined
  > = isAudienceState(voterFileFilter)
    ? {
        audience_superVoters: voterFileFilter.audience_superVoters,
        audience_likelyVoters: voterFileFilter.audience_likelyVoters,
        audience_unreliableVoters: voterFileFilter.audience_unreliableVoters,
        audience_unlikelyVoters: voterFileFilter.audience_unlikelyVoters,
        audience_firstTimeVoters: voterFileFilter.audience_firstTimeVoters,
        party_independent: voterFileFilter.party_independent,
        party_democrat: voterFileFilter.party_democrat,
        party_republican: voterFileFilter.party_republican,
        age_18_25: voterFileFilter.age_18_25,
        age_25_35: voterFileFilter.age_25_35,
        age_35_50: voterFileFilter.age_35_50,
        age_50_plus: voterFileFilter.age_50_plus,
        gender_male: voterFileFilter.gender_male,
        gender_female: voterFileFilter.gender_female,
        gender_unknown: voterFileFilter.gender_unknown,
      }
    : {
        audience_superVoters: voterFileFilter.audienceSuperVoters,
        audience_likelyVoters: voterFileFilter.audienceLikelyVoters,
        audience_unreliableVoters: voterFileFilter.audienceUnreliableVoters,
        audience_unlikelyVoters: voterFileFilter.audienceUnlikelyVoters,
        audience_firstTimeVoters: voterFileFilter.audienceFirstTimeVoters,
        party_independent: voterFileFilter.partyIndependent,
        party_democrat: voterFileFilter.partyDemocrat,
        party_republican: voterFileFilter.partyRepublican,
        age_18_25: voterFileFilter.age18_25,
        age_25_35: voterFileFilter.age25_35,
        age_35_50: voterFileFilter.age35_50,
        age_50_plus: voterFileFilter.age50Plus,
        gender_male: voterFileFilter.genderMale,
        gender_female: voterFileFilter.genderFemale,
        gender_unknown: voterFileFilter.genderUnknown,
      }
  const selectedAudience = Object.entries(audience)
    .filter(([, value]) => value === true)
    .map(([key]) => key)

  try {
    await voterFileDownload(outreachType, { filters: selectedAudience })
  } catch {
    errorSnackbar('Error downloading voter file')
  }

  setLoading(false)
}
