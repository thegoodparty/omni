import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getCookie, deleteCookie } from 'helpers/cookieHelper'

const voterFileDownloadMock = vi.fn()
vi.mock('helpers/voterFileDownload', () => ({
  voterFileDownload: (...args: unknown[]) => voterFileDownloadMock(...args),
}))
vi.mock('helpers/cookieHelper', () => ({
  getCookie: vi.fn(),
  deleteCookie: vi.fn(),
}))

import { downloadVoterList } from './downloadVoterList.util'

const mockedGetCookie = vi.mocked(getCookie)
const mockedDeleteCookie = vi.mocked(deleteCookie)

describe('downloadVoterList', () => {
  beforeEach(() => {
    voterFileDownloadMock.mockReset()
    voterFileDownloadMock.mockResolvedValue(undefined)
  })

  it('applies AudienceState (underscore) filters from task flows', async () => {
    await downloadVoterList({
      voterFileFilter: {
        audience_superVoters: true,
        audience_likelyVoters: false,
        party_democrat: true,
        age_18_25: false,
        gender_female: true,
      },
      outreachType: 'doorKnocking',
    })

    expect(voterFileDownloadMock).toHaveBeenCalledWith('doorKnocking', {
      filters: ['audience_superVoters', 'party_democrat', 'gender_female'],
    })
  })

  it('applies AudienceState with only age/gender keys (no audience_/party_ sentinel)', async () => {
    await downloadVoterList({
      voterFileFilter: {
        age_18_25: true,
        gender_female: true,
      },
      outreachType: 'doorKnocking',
    })

    expect(voterFileDownloadMock).toHaveBeenCalledWith('doorKnocking', {
      filters: ['age_18_25', 'gender_female'],
    })
  })

  it('applies VoterFileFilters (camelCase) filters from outreach actions', async () => {
    await downloadVoterList({
      voterFileFilter: {
        audienceSuperVoters: true,
        partyRepublican: true,
        genderUnknown: true,
      },
      outreachType: 'phoneBanking',
    })

    expect(voterFileDownloadMock).toHaveBeenCalledWith('phoneBanking', {
      filters: ['audience_superVoters', 'party_republican', 'gender_unknown'],
    })
  })

  it('sends no filters when none are selected', async () => {
    await downloadVoterList({
      voterFileFilter: {},
      outreachType: 'doorKnocking',
    })

    expect(voterFileDownloadMock).toHaveBeenCalledWith('doorKnocking', {
      filters: [],
    })
  })

  it('surfaces an error via the snackbar when the download fails', async () => {
    voterFileDownloadMock.mockRejectedValue(new Error('download failed'))
    const errorSnackbar = vi.fn()
    const setLoading = vi.fn()

    await downloadVoterList(
      {
        voterFileFilter: { audience_superVoters: true },
        outreachType: 'doorKnocking',
      },
      setLoading,
      errorSnackbar,
    )

    expect(errorSnackbar).toHaveBeenCalledWith('Error downloading voter file')
    expect(setLoading).toHaveBeenNthCalledWith(1, true)
    expect(setLoading).toHaveBeenLastCalledWith(false)
  })

  // ENG-10765: phone banking's saved-list branch downloads via the segment
  // export (GET /v1/contacts/download?segment=<id>) instead of the checkbox
  // voter-file endpoint, so the CSV reflects the list's current membership.
  // The cookie handshake below mirrors useContactsDownload's — a delegate
  // finding on the first pass of this branch caught setLoading(false) firing
  // synchronously right after the click, which left the Download button's
  // disabled guard cleared in the same JS task (a slow-server double click
  // could fire a duplicate download).
  describe('saved-list branch (segment export)', () => {
    let clickSpy: ReturnType<typeof vi.spyOn>
    let capturedHref: string
    let capturedDownloadAttr: string | null

    beforeEach(() => {
      vi.useFakeTimers()
      capturedHref = ''
      capturedDownloadAttr = null
      mockedGetCookie.mockReturnValue(false)
      mockedDeleteCookie.mockClear()
      clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(function (this: HTMLAnchorElement) {
          capturedHref = this.href
          capturedDownloadAttr = this.getAttribute('download')
        })
    })

    afterEach(() => {
      clickSpy.mockRestore()
      vi.useRealTimers()
    })

    it('hits the segment download with the saved list id and skips the checkbox path entirely', async () => {
      const downloadPromise = downloadVoterList({
        savedListId: 42,
        outreachType: 'phoneBanking',
        voterFileFilter: { audience_superVoters: true },
      })

      expect(capturedHref).toContain('/api/v1/contacts/download?segment=42')
      expect(capturedDownloadAttr).toMatch(/^contacts_.*\.csv$/)
      expect(voterFileDownloadMock).not.toHaveBeenCalled()

      // Confirm via the cookie handshake so the promise settles.
      mockedGetCookie.mockReturnValue('fresh-token')
      await vi.advanceTimersByTimeAsync(250)
      await downloadPromise
    })

    it('keeps loading true until the cookie confirms the download started (does not clear synchronously after the click)', async () => {
      const setLoading = vi.fn()

      const downloadPromise = downloadVoterList(
        { savedListId: 42, outreachType: 'phoneBanking' },
        setLoading,
      )

      // The exact bug delegate flagged: setLoading(false) must NOT have
      // fired yet immediately after the click, in the same JS task.
      expect(setLoading).toHaveBeenCalledTimes(1)
      expect(setLoading).toHaveBeenCalledWith(true)

      await vi.advanceTimersByTimeAsync(100)
      expect(setLoading).toHaveBeenCalledTimes(1)

      mockedGetCookie.mockReturnValue('fresh-token')
      await vi.advanceTimersByTimeAsync(250)
      await downloadPromise

      expect(setLoading).toHaveBeenCalledTimes(2)
      expect(setLoading).toHaveBeenLastCalledWith(false)
      expect(mockedDeleteCookie).toHaveBeenCalledWith('gp_download')
    })

    it('falls back and clears loading after 15s when the cookie handshake never arrives', async () => {
      const setLoading = vi.fn()

      const downloadPromise = downloadVoterList(
        { savedListId: 42, outreachType: 'phoneBanking' },
        setLoading,
      )

      await vi.advanceTimersByTimeAsync(15000)
      await downloadPromise

      expect(setLoading).toHaveBeenLastCalledWith(false)
    })

    // ENG-10784: door knocking's saved-list branch behaves identically to
    // phone banking's — the branch is keyed on savedListId presence, not
    // outreachType.
    it('hits the segment download for door knocking with a saved list selected', async () => {
      const downloadPromise = downloadVoterList({
        savedListId: 42,
        outreachType: 'doorKnocking',
      })

      expect(capturedHref).toContain('/api/v1/contacts/download?segment=42')
      expect(capturedDownloadAttr).toMatch(/^contacts_.*\.csv$/)
      expect(voterFileDownloadMock).not.toHaveBeenCalled()

      mockedGetCookie.mockReturnValue('fresh-token')
      await vi.advanceTimersByTimeAsync(250)
      await downloadPromise
    })

    it('takes the checkbox path when savedListId is not provided', async () => {
      await downloadVoterList({
        outreachType: 'phoneBanking',
        voterFileFilter: { audience_superVoters: true },
      })

      expect(voterFileDownloadMock).toHaveBeenCalledWith('phoneBanking', {
        filters: ['audience_superVoters'],
      })
      expect(clickSpy).not.toHaveBeenCalled()
    })
  })
})
