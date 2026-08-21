import { noop } from '@shared/utils/noop'
import { VoterFileFilters } from 'helpers/types'
import { AudienceState } from 'app/dashboard/components/tasks/flows/util/flowHandlers.util'
import {
  AUDIENCE_FILTER_SNAKE_KEYS,
  snakeToCamelAudienceKey,
} from 'app/dashboard/outreach/util/audienceFilterKeyMap'
import { dateUsHelper } from 'helpers/dateHelper'
import { deleteCookie } from 'helpers/cookieHelper'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import {
  DOWNLOAD_COOKIE_NAME,
  DOWNLOAD_COOKIE_POLL_MS,
  DOWNLOAD_FALLBACK_TIMEOUT_MS,
  readDownloadCookie,
} from 'app/dashboard/contacts/crm/shared/useContactsDownload'

// The two download surfaces this util serves. The third surface on the
// Voter Data - List Exported event, 'listDetail', fires from ListDetailSheet
// and never routes through here.
export type VoterListExportSurface = 'outreachWizard' | 'outreachTable'

interface DownloadVoterListParams {
  voterFileFilter?: VoterFileFilters | AudienceState
  outreachType?: string
  // ENG-10765: a saved list's current membership (activity/support
  // conditions included) can only be resolved server-side — GET
  // /v1/voters/voter-file only understands the checkbox filter keys. When
  // set, this takes the segment-export branch instead and voterFileFilter is
  // ignored entirely.
  savedListId?: number
  // Required, not optional: an unlabelled export is indistinguishable from an
  // untracked one in Amplitude, which is how these two surfaces went dark for
  // seven weeks after the CRM rollout.
  surface: VoterListExportSurface
}

// AudienceState is keyed by the underscore filter names; VoterFileFilters never
// is (it uses camelCase like age18_25). So the presence of any underscore key
// reliably identifies the AudienceState shape — including age/gender-only
// selections that omit the audience_/party_ groups.
const isAudienceState = (
  filter: VoterFileFilters | AudienceState,
): filter is AudienceState =>
  AUDIENCE_FILTER_SNAKE_KEYS.some((key) => key in filter)

// A top-level download navigation exposes no programmatic completion, so
// this mirrors useContactsDownload's cookie handshake instead of resolving
// synchronously: poll the gp_download cookie gp-api sets when it starts
// streaming, and give up after the same 15s fallback if the handshake never
// arrives. Callers must await this before clearing their own loading state —
// resolving immediately after the click (the ENG-10765 delegate finding)
// left the Download button's disabled guard cleared in the same JS task, so
// a second click could fire a duplicate download on a slow server.
//
// `cookieBeforeClick` must be snapshotted by the caller BEFORE triggering the
// download navigation (same ordering useContactsDownload uses) — snapshotting
// it in here instead would risk capturing gp-api's own fresh cookie if the
// response is fast enough to land before this function runs, permanently
// hiding the real "started" transition.
//
// Resolves true only when the cookie handshake confirmed the download started,
// false when the fallback timed out. The analytics fire is gated on that
// distinction so these surfaces count exactly like ListDetailSheet's, which
// also fires only from the confirmed branch — counting the ambiguous fallback
// here would inflate outreach exports relative to CRM ones.
const awaitDownloadStarted = (
  cookieBeforeClick: string | null,
): Promise<boolean> =>
  new Promise((resolve) => {
    const finish = (confirmed: boolean) => {
      clearInterval(pollInterval)
      clearTimeout(fallbackTimeout)
      deleteCookie(DOWNLOAD_COOKIE_NAME)
      resolve(confirmed)
    }

    const pollInterval = setInterval(() => {
      const current = readDownloadCookie()
      if (current && current !== cookieBeforeClick) {
        finish(true)
      }
    }, DOWNLOAD_COOKIE_POLL_MS)

    const fallbackTimeout = setTimeout(
      () => finish(false),
      DOWNLOAD_FALLBACK_TIMEOUT_MS,
    )
  })

export const downloadVoterList = async (
  {
    voterFileFilter = {},
    outreachType = '',
    savedListId,
    surface,
  }: DownloadVoterListParams,
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
    const cookieBeforeClick = readDownloadCookie()

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

    // Keeps `loading` (and DownloadStep's disabled guard) true until gp-api
    // confirms it started streaming or the fallback gives up — see
    // awaitDownloadStarted for why.
    if (await awaitDownloadStarted(cookieBeforeClick)) {
      trackEvent(EVENTS.VoterData.ListExported, { surface })
    }

    setLoading(false)
    return
  }

  const selectedAudience = isAudienceState(voterFileFilter)
    ? AUDIENCE_FILTER_SNAKE_KEYS.filter((key) => voterFileFilter[key] === true)
    : AUDIENCE_FILTER_SNAKE_KEYS.filter(
        (key) => voterFileFilter[snakeToCamelAudienceKey(key)] === true,
      )

  try {
    // Stream directly via a top-level navigation (same cookie handshake as the
    // savedListId branch above) instead of buffering the whole CSV into a JS
    // Blob through voterFileDownload — a statewide export can be hundreds of MB
    // and the buffered fetch times out mid-download. Mirrors the
    // GET /voters/voter-file request voterFileDownload built (type +
    // customFilters JSON), as a direct /api/v1 navigation so auth and the
    // x-organization-slug header are added automatically by the Next.js
    // request-rewrite middleware.
    const cookieBeforeClick = readDownloadCookie()

    const query = new URLSearchParams({ type: outreachType })
    query.set('customFilters', JSON.stringify({ filters: selectedAudience }))

    const link = document.createElement('a')
    link.href = `/api/v1/voters/voter-file?${query.toString()}`
    link.setAttribute(
      'download',
      `${outreachType}-${dateUsHelper(new Date()).replace(/ /g, '_')}.csv`,
    )
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()

    if (await awaitDownloadStarted(cookieBeforeClick)) {
      trackEvent(EVENTS.VoterData.ListExported, { surface })
    }
  } catch {
    errorSnackbar('Error downloading voter file')
  }

  setLoading(false)
}
