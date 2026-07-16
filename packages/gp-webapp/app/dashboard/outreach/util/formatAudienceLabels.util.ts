import { AUDIENCE_LABELS_MAPPING } from 'app/dashboard/outreach/constants'
import { AUDIENCE_FILTER_CAMEL_KEYS } from 'app/dashboard/outreach/util/audienceFilterKeyMap'
import { VoterFileFilters } from 'helpers/types'

export const formatAudienceLabels = (
  filters: VoterFileFilters = {},
): string[] =>
  AUDIENCE_FILTER_CAMEL_KEYS.filter((k) => Boolean(filters[k]))
    .map((k) => AUDIENCE_LABELS_MAPPING[k])
    .filter((label): label is string => Boolean(label))
