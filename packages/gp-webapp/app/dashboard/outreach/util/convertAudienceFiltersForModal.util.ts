import { AudienceFiltersState } from 'app/dashboard/components/tasks/flows/CustomVoterAudienceFilters'
import { VoterFileFilters } from 'helpers/types'
import {
  VOTER_FILE_FILTER_KEY_MAP,
  camelToSnakeAudienceKey,
} from 'app/dashboard/outreach/util/audienceFilterKeyMap'

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
      const value = filters[key]
      if (typeof value === 'boolean') {
        result[camelToSnakeAudienceKey(key)] = value
      }
    }
  }
  return result
}
