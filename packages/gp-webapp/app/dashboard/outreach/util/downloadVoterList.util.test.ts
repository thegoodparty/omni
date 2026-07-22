import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const voterFileDownloadMock = vi.fn()
vi.mock('helpers/voterFileDownload', () => ({
  voterFileDownload: (...args: unknown[]) => voterFileDownloadMock(...args),
}))

import { downloadVoterList } from './downloadVoterList.util'

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
  describe('saved-list branch (segment export)', () => {
    let clickSpy: ReturnType<typeof vi.spyOn>
    let capturedHref: string
    let capturedDownloadAttr: string | null

    beforeEach(() => {
      capturedHref = ''
      capturedDownloadAttr = null
      clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(function (this: HTMLAnchorElement) {
          capturedHref = this.href
          capturedDownloadAttr = this.getAttribute('download')
        })
    })

    afterEach(() => {
      clickSpy.mockRestore()
    })

    it('hits the segment download with the saved list id and skips the checkbox path entirely', async () => {
      await downloadVoterList({
        savedListId: 42,
        outreachType: 'phoneBanking',
        voterFileFilter: { audience_superVoters: true },
      })

      expect(capturedHref).toContain('/api/v1/contacts/download?segment=42')
      expect(capturedDownloadAttr).toMatch(/^contacts_.*\.csv$/)
      expect(voterFileDownloadMock).not.toHaveBeenCalled()
    })

    it('toggles loading around the segment download the same as the checkbox path', async () => {
      const setLoading = vi.fn()

      await downloadVoterList(
        { savedListId: 42, outreachType: 'phoneBanking' },
        setLoading,
      )

      expect(setLoading).toHaveBeenNthCalledWith(1, true)
      expect(setLoading).toHaveBeenLastCalledWith(false)
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
