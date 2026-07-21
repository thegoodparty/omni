import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { clientFetch } from 'gpApi/clientFetch'
import { clientRequest } from 'gpApi/typed-request'
import { useSnackbar } from 'helpers/useSnackbar'
import { router } from 'helpers/test-utils/router-mocking'
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

// Drive welcome -> ballot-status -> party-affiliation -> office-selection,
// recording on-ballot + nonpartisan so the early-attrs flush has values.
const advanceToOfficeSelection = async () => {
  const continueButton = await screen.findByRole('button', {
    name: /continue/i,
  })
  fireEvent.click(continueButton)
  fireEvent.click(await screen.findByLabelText(/officially on the ballot/i))
  fireEvent.click(continueButton)
  fireEvent.click(await screen.findByLabelText(/nonpartisan race/i))
  fireEvent.click(continueButton)
  // Search so the office list (and the "can't find my office" link) renders.
  fireEvent.change(await screen.findByLabelText(/zip code/i), {
    target: { value: '82001' },
  })
  fireEvent.click(screen.getByRole('button', { name: /search/i }))
}

// Drive the manual-office path from office-selection through creation to the
// pledge step (p2v is skipped on the manual path).
const fillManualOfficeToPledge = async () => {
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
  // Creates the campaign and advances to the pledge step.
  fireEvent.click(screen.getByRole('button', { name: /continue/i }))
  await screen.findByText(/i pledge to be/i)
}

beforeEach(() => {
  mockClientFetch.mockReset()
  mockClientRequest.mockReset()
  if (router.push) vi.mocked(router.push).mockClear()
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

  // Route the legacy client by path: race search returns the race list; every
  // other call (the post-create updateCampaign PUT /campaigns/mine) returns a
  // campaign-shaped ok response so the early-attrs flush isn't fed race data.
  mockClientFetch.mockImplementation((endpoint: { path: string }) => {
    if (endpoint.path.includes('races-by-year')) {
      return Promise.resolve({ data: [searchRace], ok: true } as never)
    }
    return Promise.resolve({ data: { id: 4242 }, ok: true } as never)
  })
})

describe('FollowOnFlow — new office', () => {
  it('creates the campaign via follow-on with the structured-office payload and flushes early answers', async () => {
    renderFlow()
    await advanceToOfficeSelection()

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

    // The party + ballot-status answers collected before creation must be
    // flushed onto the new campaign via updateCampaign (PUT /campaigns/mine).
    await waitFor(() =>
      expect(mockClientFetch).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/campaigns/mine' }),
        expect.objectContaining({
          details: expect.objectContaining({
            party: 'nonpartisan',
            ballotStatus: 'on-ballot',
          }),
        }),
      ),
    )
  })

  it('creates the campaign via follow-on with the manual-office payload', async () => {
    renderFlow()
    await advanceToOfficeSelection()

    // Fall back to manual entry.
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

    await waitFor(() =>
      expect(mockClientRequest).toHaveBeenCalledWith(
        'POST /v1/campaigns/follow-on',
        expect.objectContaining({
          intent: 'new-office',
          customPositionName: 'Town Dogcatcher',
          details: expect.objectContaining({
            raceId: null,
            state: 'NC',
            city: 'Asheville',
            electionDate: '2026-11-03',
          }),
        }),
      ),
    )
  })

  it('surfaces an error when the early-answers flush fails after creation', async () => {
    // POST follow-on succeeds, but the follow-up updateCampaign flush rejects
    // (updateCampaign returns false only when its clientFetch throws). The
    // party / ballot answers must not be silently lost.
    mockClientFetch.mockImplementation((endpoint: { path: string }) =>
      endpoint.path.includes('races-by-year')
        ? Promise.resolve({ data: [searchRace], ok: true } as never)
        : Promise.reject(new Error('network')),
    )

    renderFlow()
    await advanceToOfficeSelection()
    fireEvent.click(await screen.findByRole('radio', { name: /cheyenne/i }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled(),
    )
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /something went wrong saving your answers/i,
    )
  })

  it('launches and routes to the dashboard on pledge', async () => {
    renderFlow()
    await advanceToOfficeSelection()
    await fillManualOfficeToPledge()

    fireEvent.click(
      screen.getByRole('button', { name: /agree & create my plan/i }),
    )

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/dashboard'))
    // The launch endpoint was hit as part of completing the pledge.
    expect(mockClientFetch).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/campaigns/launch' }),
    )
  })

  it('surfaces an error and does not redirect when launch fails', async () => {
    mockClientFetch.mockImplementation((endpoint: { path: string }) => {
      if (endpoint.path.includes('races-by-year')) {
        return Promise.resolve({ data: [searchRace], ok: true } as never)
      }
      if (endpoint.path === '/campaigns/launch') {
        return Promise.resolve({ data: {}, ok: false, status: 500 } as never)
      }
      return Promise.resolve({ data: { id: 4242 }, ok: true } as never)
    })

    renderFlow()
    await advanceToOfficeSelection()
    await fillManualOfficeToPledge()

    fireEvent.click(
      screen.getByRole('button', { name: /agree & create my plan/i }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /something went wrong finishing your campaign/i,
    )
    expect(router.push).not.toHaveBeenCalled()
  })
})
