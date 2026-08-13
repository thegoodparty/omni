import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getCookie, deleteCookie } from 'helpers/cookieHelper'

vi.mock('helpers/cookieHelper', () => ({
  getCookie: vi.fn(),
  deleteCookie: vi.fn(),
}))

import { downloadVoterList } from './downloadVoterList.util'

const mockedGetCookie = vi.mocked(getCookie)
const mockedDeleteCookie = vi.mocked(deleteCookie)

describe('downloadVoterList', () => {
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

  // Resolve the cookie handshake so a download promise settles (both branches
  // await it — see awaitDownloadStarted).
  const confirmDownload = async () => {
    mockedGetCookie.mockReturnValue('fresh-token')
    await vi.advanceTimersByTimeAsync(250)
  }

  // The checkbox branch now streams via a top-level navigation to the
  // voter-file endpoint (ENG: statewide exports OOM/time out when buffered),
  // mirroring the GET /voters/voter-file request voterFileDownload used to
  // build (type + customFilters JSON) — so assert on the anchor's URL.
  const parseCheckboxRequest = () => {
    const url = new URL(capturedHref)
    return {
      pathname: url.pathname,
      type: url.searchParams.get('type'),
      customFilters: JSON.parse(url.searchParams.get('customFilters') ?? '{}'),
    }
  }

  it('applies AudienceState (underscore) filters from task flows', async () => {
    const downloadPromise = downloadVoterList({
      voterFileFilter: {
        audience_superVoters: true,
        audience_likelyVoters: false,
        party_democrat: true,
        age_18_25: false,
        gender_female: true,
      },
      outreachType: 'doorKnocking',
    })

    const req = parseCheckboxRequest()
    expect(req.pathname).toBe('/api/v1/voters/voter-file')
    expect(req.type).toBe('doorKnocking')
    expect(req.customFilters).toEqual({
      filters: ['audience_superVoters', 'party_democrat', 'gender_female'],
    })

    await confirmDownload()
    await downloadPromise
  })

  it('applies AudienceState with only age/gender keys (no audience_/party_ sentinel)', async () => {
    const downloadPromise = downloadVoterList({
      voterFileFilter: {
        age_18_25: true,
        gender_female: true,
      },
      outreachType: 'doorKnocking',
    })

    expect(parseCheckboxRequest().customFilters).toEqual({
      filters: ['age_18_25', 'gender_female'],
    })

    await confirmDownload()
    await downloadPromise
  })

  it('applies VoterFileFilters (camelCase) filters from outreach actions', async () => {
    const downloadPromise = downloadVoterList({
      voterFileFilter: {
        audienceSuperVoters: true,
        partyRepublican: true,
        genderUnknown: true,
      },
      outreachType: 'phoneBanking',
    })

    const req = parseCheckboxRequest()
    expect(req.type).toBe('phoneBanking')
    expect(req.customFilters).toEqual({
      filters: ['audience_superVoters', 'party_republican', 'gender_unknown'],
    })

    await confirmDownload()
    await downloadPromise
  })

  it('sends no filters when none are selected', async () => {
    const downloadPromise = downloadVoterList({
      voterFileFilter: {},
      outreachType: 'doorKnocking',
    })

    expect(parseCheckboxRequest().customFilters).toEqual({ filters: [] })

    await confirmDownload()
    await downloadPromise
  })

  it('surfaces an error via the snackbar when building the download throws', async () => {
    clickSpy.mockImplementationOnce(() => {
      throw new Error('download failed')
    })
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

  // ENG-10765: the saved-list branch downloads via the segment export
  // (GET /v1/contacts/download?segment=<id>) instead of the checkbox
  // voter-file endpoint, so the CSV reflects the list's current membership.
  // The cookie handshake below mirrors useContactsDownload's — a delegate
  // finding on the first pass of this branch caught setLoading(false) firing
  // synchronously right after the click, which left the Download button's
  // disabled guard cleared in the same JS task (a slow-server double click
  // could fire a duplicate download).
  describe('saved-list branch (segment export)', () => {
    it('hits the segment download with the saved list id and skips the checkbox path entirely', async () => {
      const downloadPromise = downloadVoterList({
        savedListId: 42,
        outreachType: 'phoneBanking',
        voterFileFilter: { audience_superVoters: true },
      })

      expect(capturedHref).toContain('/api/v1/contacts/download?segment=42')
      expect(capturedHref).not.toContain('/api/v1/voters/voter-file')
      expect(capturedDownloadAttr).toMatch(/^contacts_.*\.csv$/)

      await confirmDownload()
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

      await confirmDownload()
      await downloadPromise
    })

    it('takes the checkbox path when savedListId is not provided', async () => {
      const downloadPromise = downloadVoterList({
        outreachType: 'phoneBanking',
        voterFileFilter: { audience_superVoters: true },
      })

      const req = parseCheckboxRequest()
      expect(req.pathname).toBe('/api/v1/voters/voter-file')
      expect(capturedHref).not.toContain('/api/v1/contacts/download')
      expect(req.customFilters).toEqual({ filters: ['audience_superVoters'] })

      await confirmDownload()
      await downloadPromise
    })
  })
})
