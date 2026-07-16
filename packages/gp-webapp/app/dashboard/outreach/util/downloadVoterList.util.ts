import { noop } from '@shared/utils/noop'
import { voterFileDownload } from 'helpers/voterFileDownload'
import { VoterFileFilters } from 'helpers/types'
import { AudienceState } from 'app/dashboard/components/tasks/flows/util/flowHandlers.util'
import {
  AUDIENCE_FILTER_SNAKE_KEYS,
  snakeToCamelAudienceKey,
} from 'app/dashboard/outreach/util/audienceFilterKeyMap'

interface DownloadVoterListParams {
  voterFileFilter?: VoterFileFilters | AudienceState
  outreachType?: string
}

// AudienceState is keyed by the underscore filter names; VoterFileFilters never
// is (it uses camelCase like age18_25). So the presence of any underscore key
// reliably identifies the AudienceState shape — including age/gender-only
// selections that omit the audience_/party_ groups.
const isAudienceState = (
  filter: VoterFileFilters | AudienceState,
): filter is AudienceState =>
  AUDIENCE_FILTER_SNAKE_KEYS.some((key) => key in filter)

export const downloadVoterList = async (
  { voterFileFilter = {}, outreachType = '' }: DownloadVoterListParams = {},
  setLoading: (loading: boolean) => void = noop,
  errorSnackbar: (message: string) => void = noop,
): Promise<void> => {
  setLoading(true)

  const selectedAudience = isAudienceState(voterFileFilter)
    ? AUDIENCE_FILTER_SNAKE_KEYS.filter((key) => voterFileFilter[key] === true)
    : AUDIENCE_FILTER_SNAKE_KEYS.filter(
        (key) => voterFileFilter[snakeToCamelAudienceKey(key)] === true,
      )

  try {
    await voterFileDownload(outreachType, { filters: selectedAudience })
  } catch {
    errorSnackbar('Error downloading voter file')
  }

  setLoading(false)
}
