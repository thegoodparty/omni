import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { clientFetch } from 'gpApi/clientFetch'
import { clientRequest } from 'gpApi/typed-request'
import { useSnackbar } from 'helpers/useSnackbar'
import FollowOnFlow from './FollowOnFlow'

// The office picker mocks clientFetch / clientRequest directly (see
// OfficeSelectionStep.test), so the new-office path is tested here with the
// same module mocks rather than MSW — driving the real picker UI through to
// the follow-on create call.
vi.mock('gpApi/clientFetch', () => ({ clientFetch: vi.fn() }))
vi.mock('gpApi/typed-request', () => ({ clientRequest: vi.fn() }))
vi.mock('helpers/useSnackbar', () => ({ useSnackbar: vi.fn() }))

const mockClientFetch = vi.mocked(clientFetch)
const mockClientRequest = vi.mocked(clientRequest)

const noOfficeEligibility = {
  hasActiveCampaign: false,
  holdsOffice: false,
  canStartCampaign: true,
  canGainOffice: true,
  reelectionOfficeSlug: null,
}

const searchRace = {
  id: 'race-1',
  brPositionId: 'br-pos-1',
  position: {
    id: 'pos-1',
    name: 'City Council',
    level: 'local',
    state: 'WY',
    electionFrequencies: [{ frequency: 4 }],
  },
  election: { id: 'elec-1', electionDay: '2026-11-03', state: 'WY' },
  filingPeriods: [{ startOn: '2026-01-01', endOn: '2026-06-01' }],
  city: 'Cheyenne',
}

const renderFlow = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <FollowOnFlow intent="new-office" />
    </QueryClientProvider>,
  )

beforeEach(() => {
  mockClientFetch.mockReset()
  mockClientRequest.mockReset()
  vi.mocked(useSnackbar).mockReturnValue({
    errorSnackbar: vi.fn(),
    successSnackbar: vi.fn(),
    displaySnackbar: vi.fn(),
  })

  // Route the typed client by endpoint; default keeps post-creation steps
  // (path-to-victory fetches) from throwing.
  mockClientRequest.mockImplementation((route: string) => {
    if (route === 'GET /v1/eligibility') {
      return Promise.resolve({ data: noOfficeEligibility } as never)
    }
    if (route === 'GET /v1/organizations') {
      return Promise.resolve({ data: { organizations: [] } } as never)
    }
    if (route === 'GET /v1/elections/race-by-position') {
      return Promise.resolve({ data: searchRace } as never)
    }
    if (route === 'POST /v1/campaigns/follow-on') {
      return Promise.resolve({
        data: { id: 4242, slug: 'campaign-4242' },
      } as never)
    }
    return Promise.resolve({ data: {} } as never)
  })

  mockClientFetch.mockResolvedValue({
    data: [searchRace],
    ok: true,
  } as never)
})

describe('FollowOnFlow — new office', () => {
  it('creates the campaign via follow-on with the structured-office payload', async () => {
    renderFlow()

    const continueButton = await screen.findByRole('button', {
      name: /continue/i,
    })

    // welcome -> ballot-status
    fireEvent.click(continueButton)
    fireEvent.click(await screen.findByLabelText(/officially on the ballot/i))
    // ballot-status -> party-affiliation
    fireEvent.click(continueButton)
    fireEvent.click(await screen.findByLabelText(/nonpartisan race/i))
    // party-affiliation -> office-selection
    fireEvent.click(continueButton)

    // Search and pick a structured office.
    fireEvent.change(await screen.findByLabelText(/zip code/i), {
      target: { value: '82001' },
    })
    fireEvent.click(screen.getByRole('button', { name: /search/i }))
    // Match the race card by its city to disambiguate from the "City Council"
    // filter pill (also role=radio).
    fireEvent.click(await screen.findByRole('radio', { name: /cheyenne/i }))

    // Wait for hydration to resolve and Continue to re-enable.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled(),
    )
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() =>
      expect(mockClientRequest).toHaveBeenCalledWith(
        'POST /v1/campaigns/follow-on',
        expect.objectContaining({
          intent: 'new-office',
          ballotReadyPositionId: 'br-pos-1',
          details: expect.objectContaining({
            raceId: 'race-1',
            state: 'WY',
            city: 'Cheyenne',
            electionDate: '2026-11-03',
          }),
        }),
      ),
    )
  })
})
