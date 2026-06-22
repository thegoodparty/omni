import { describe, it, expect, vi, beforeEach } from 'vitest'

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
})
