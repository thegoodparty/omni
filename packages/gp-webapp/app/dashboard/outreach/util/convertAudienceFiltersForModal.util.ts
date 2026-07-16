import { AudienceFiltersState } from 'app/dashboard/voter-records/components/CustomVoterAudienceFilters'
import { VoterFileFilters } from 'helpers/types'
import { VOTER_FILE_FILTER_KEY_MAP } from 'app/dashboard/outreach/util/audienceFilterKeyMap'

const isConvertibleFilterKey = (
  key: string,
): key is keyof typeof VOTER_FILE_FILTER_KEY_MAP =>
  key in VOTER_FILE_FILTER_KEY_MAP

export const convertAudienceFiltersForModal = (
  filters: VoterFileFilters = {},
): AudienceFiltersState => {
  const result: AudienceFiltersState = {}
  for (const key of Object.keys(filters)) {
    if (isConvertibleFilterKey(key)) {
      const convertedKey = VOTER_FILE_FILTER_KEY_MAP[key]
      const value = filters[key]
      if (convertedKey && typeof value === 'boolean') {
        result[convertedKey] = value
      }
    }
  }
  return result
}
