import { noop } from '@shared/utils/noop'
import { voterFileDownload } from 'helpers/voterFileDownload'
import { VoterFileFilters } from 'helpers/types'
import { AudienceState } from 'app/dashboard/components/tasks/flows/util/flowHandlers.util'
import {
  AUDIENCE_FILTER_SNAKE_KEYS,
  snakeToCamelAudienceKey,
} from 'app/dashboard/outreach/util/audienceFilterKeyMap'
import { dateUsHelper } from 'helpers/dateHelper'

interface DownloadVoterListParams {
  voterFileFilter?: VoterFileFilters | AudienceState
  outreachType?: string
  // ENG-10765: a saved list's current membership (activity/support
  // conditions included) can only be resolved server-side — GET
  // /v1/voters/voter-file only understands the checkbox filter keys. When
  // set, this takes the segment-export branch instead and voterFileFilter is
  // ignored entirely.
  savedListId?: number
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
  {
    voterFileFilter = {},
    outreachType = '',
    savedListId,
  }: DownloadVoterListParams = {},
  setLoading: (loading: boolean) => void = noop,
  errorSnackbar: (message: string) => void = noop,
): Promise<void> => {
  setLoading(true)

  if (savedListId !== undefined) {
    // Same endpoint + href shape as the CRM list-detail download
    // (useContactsDownload) so the two surfaces can't drift: a top-level
    // navigation to /api/v1/... so auth + the x-organization-slug header are
    // added automatically by the Next.js request-rewrite middleware. Known
    // quirk (not fixed here): this does not re-apply a stored `search` term,
    // so a saved list with one can download more rows than it displays.
    const link = document.createElement('a')
    link.href = `/api/v1/contacts/download?segment=${encodeURIComponent(String(savedListId))}`
    link.setAttribute(
      'download',
      `contacts_${dateUsHelper(new Date()).replace(/ /g, '_')}.csv`,
    )
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()

    setLoading(false)
    return
  }

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
