import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { clientFetch } from 'gpApi/clientFetch'
import { clientRequest } from 'gpApi/typed-request'
import { useSnackbar } from 'helpers/useSnackbar'
import { router } from 'helpers/test-utils/router-mocking'
import OnboardingFlow from './OnboardingFlow'

// The shared router mock omits refresh; OnboardingFlow calls it after the
// office persist step, so patch it here to keep the async post-assert path
// from tripping vitest's unhandled-rejection guard.
;(router as { refresh?: () => void }).refresh = vi.fn()

// Mirrors OfficeSelectionStep.test / FollowOnFlow.newOffice.test so the real
// office picker drives through to the campaign-create call, and the request
// body sent to POST /campaigns can be asserted against.
vi.mock('gpApi/clientFetch', () => ({ clientFetch: vi.fn() }))
vi.mock('gpApi/typed-request', () => ({ clientRequest: vi.fn() }))
vi.mock('helpers/useSnackbar', () => ({ useSnackbar: vi.fn() }))

const mockClientFetch = vi.mocked(clientFetch)
const mockClientRequest = vi.mocked(clientRequest)

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
      <OnboardingFlow />
    </QueryClientProvider>,
  )

const advanceToOfficeSelection = async () => {
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
  fireEvent.change(await screen.findByLabelText(/zip code/i), {
    target: { value: '82001' },
  })
  fireEvent.click(screen.getByRole('button', { name: /search/i }))
}

beforeEach(() => {
  mockClientFetch.mockReset()
  mockClientRequest.mockReset()
  vi.mocked(useSnackbar).mockReturnValue({
    errorSnackbar: vi.fn(),
    successSnackbar: vi.fn(),
    displaySnackbar: vi.fn(),
  })

  // The office picker calls GET /v1/elections/race-by-position to hydrate the
  // clicked race; POST /v1/campaigns returns the created campaign so the flow
  // proceeds past creation.
  mockClientRequest.mockImplementation((route: string) => {
    if (route === 'GET /v1/elections/race-by-position') {
      return Promise.resolve({ data: searchRace } as never)
    }
    if (route === 'GET /v1/campaigns/mine') {
      return Promise.resolve({ data: { id: 4242 } } as never)
    }
    return Promise.resolve({ data: {} } as never)
  })

  mockClientFetch.mockImplementation((endpoint: { path: string }) => {
    if (endpoint.path.includes('races-by-year')) {
      return Promise.resolve({ data: [searchRace], ok: true } as never)
    }
    // POST /campaigns and everything else returns a stub campaign.
    return Promise.resolve({ data: { id: 4242 }, ok: true } as never)
  })
})

describe('OnboardingFlow — persists ZIP into new campaign', () => {
  it('sends details.zip when creating the campaign from a structured office pick', async () => {
    renderFlow()
    await advanceToOfficeSelection()

    fireEvent.click(await screen.findByRole('radio', { name: /cheyenne/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled(),
    )
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    // The office ZIP the candidate typed into the picker must land on
    // `details.zip` in the campaign create payload — HubSpot's Company sync
    // reads that field, and Peerly line rental derives DID area codes from
    // it. Without it new candidates end up with no area code and can't rent
    // a robocall line (ENG-10618).
    await waitFor(() => {
      const createCall = mockClientFetch.mock.calls.find(
        ([endpoint]) =>
          typeof endpoint === 'object' &&
          endpoint !== null &&
          'path' in endpoint &&
          endpoint.path === '/campaigns',
      )
      expect(createCall).toBeDefined()
      expect(createCall?.[1]).toEqual(
        expect.objectContaining({
          details: expect.objectContaining({ zip: '82001' }),
        }),
      )
    })
  })

  it('sends details.zip when creating the campaign from a manual office entry', async () => {
    renderFlow()
    await advanceToOfficeSelection()

    fireEvent.click(
      await screen.findByRole('button', { name: /don.t see my office/i }),
    )

    fireEvent.change(await screen.findByLabelText(/office name/i), {
      target: { value: 'Town Dogcatcher' },
    })
    fireEvent.click(screen.getByRole('combobox', { name: /state/i }))
    fireEvent.click(screen.getByRole('option', { name: 'NC' }))
    fireEvent.change(screen.getByLabelText(/city, town or county/i), {
      target: { value: 'Asheville' },
    })
    fireEvent.click(screen.getByRole('combobox', { name: /term length/i }))
    fireEvent.click(screen.getByRole('option', { name: '4 years' }))
    fireEvent.change(screen.getByLabelText(/general election date/i), {
      target: { value: '2026-11-03' },
    })

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled(),
    )
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    // Manual entry doesn't ask for ZIP directly; the office-selection step
    // captured it before "I don't see my office" was clicked. That ZIP still
    // needs to persist so HubSpot / Peerly have an area code.
    await waitFor(() => {
      const createCall = mockClientFetch.mock.calls.find(
        ([endpoint]) =>
          typeof endpoint === 'object' &&
          endpoint !== null &&
          'path' in endpoint &&
          endpoint.path === '/campaigns',
      )
      expect(createCall).toBeDefined()
      expect(createCall?.[1]).toEqual(
        expect.objectContaining({
          details: expect.objectContaining({ zip: '82001' }),
        }),
      )
    })
  })
})
