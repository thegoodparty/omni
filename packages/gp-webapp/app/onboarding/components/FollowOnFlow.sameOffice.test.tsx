import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { clientFetch } from 'gpApi/clientFetch'
import { clientRequest } from 'gpApi/typed-request'
import { useSnackbar } from 'helpers/useSnackbar'
import FollowOnFlow from './FollowOnFlow'

// PathToVictoryStep reads the org's resolved district so it can skip a stats fetch
// that could only 400 (and skip the Sentry report for that expected state).
// useOrganization throws outside its provider, and these flow tests render without
// the root layout that supplies it.
vi.mock('@shared/organization-picker', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/organization-picker')>()),
  useOrganization: () => ({
    slug: 'campaign-1',
    positionName: 'Mayor',
    district: { id: 'd1', l2Type: 'City', l2Name: 'Austin' },
  }),
}))

// Module mocks (rather than MSW) so the legacy updateCampaign clientFetch
// calls can be asserted directly — mirrors FollowOnFlow.newOffice.test.tsx.
vi.mock('gpApi/clientFetch', () => ({ clientFetch: vi.fn() }))
vi.mock('gpApi/typed-request', () => ({ clientRequest: vi.fn() }))
vi.mock('helpers/useSnackbar', () => ({ useSnackbar: vi.fn() }))
// Stub the network-bound tracker so step components don't hit Segment.
vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

const mockClientFetch = vi.mocked(clientFetch)
const mockClientRequest = vi.mocked(clientRequest)

const heldOfficeEligibility = {
  hasActiveCampaign: false,
  holdsOffice: true,
  canStartCampaign: true,
  canGainOffice: false,
  reelectionOfficeSlug: 'eo-1',
}

const heldOfficeOrg = {
  slug: 'eo-1',
  name: 'City Council Member',
  positionName: 'City Council Member',
  position: null,
  district: null,
  electedOfficeId: 'eo-1',
  campaignId: null,
  status: 'active' as const,
}

beforeEach(() => {
  mockClientFetch.mockReset()
  mockClientRequest.mockReset()
  vi.mocked(useSnackbar).mockReturnValue({
    errorSnackbar: vi.fn(),
    successSnackbar: vi.fn(),
    displaySnackbar: vi.fn(),
  })

  mockClientRequest.mockImplementation((route: string) => {
    if (route === 'GET /v1/eligibility') {
      return Promise.resolve({ data: heldOfficeEligibility } as never)
    }
    if (route === 'GET /v1/organizations') {
      return Promise.resolve({
        data: { organizations: [heldOfficeOrg] },
      } as never)
    }
    if (route === 'POST /v1/campaigns/follow-on') {
      return Promise.resolve({
        data: { id: 4242, slug: 'campaign-4242' },
      } as never)
    }
    return Promise.resolve({ data: {} } as never)
  })

  // Every updateCampaign (PUT /campaigns/mine) succeeds, so the per-step save
  // path advances rather than halting on a false return.
  mockClientFetch.mockResolvedValue({ data: { id: 4242 }, ok: true } as never)
})

describe('FollowOnFlow — same office', () => {
  it('persists ballot-status and party answers onto the new campaign after creation', async () => {
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <FollowOnFlow intent="same-office" fromOrganizationSlug="eo-1" />
      </QueryClientProvider>,
    )

    const continueButton = await screen.findByRole('button', {
      name: /continue/i,
    })

    // welcome -> creates the campaign (office picker skipped) -> ballot-status
    fireEvent.click(continueButton)
    await waitFor(() =>
      expect(mockClientRequest).toHaveBeenCalledWith(
        'POST /v1/campaigns/follow-on',
        expect.objectContaining({
          intent: 'same-office',
          fromOrganizationSlug: 'eo-1',
        }),
      ),
    )

    fireEvent.click(await screen.findByLabelText(/officially on the ballot/i))
    // ballot-status -> party-affiliation (saves ballotStatus on the way)
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    fireEvent.click(await screen.findByLabelText(/nonpartisan race/i))
    // party-affiliation -> path-to-victory (saves party on the way)
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() =>
      expect(mockClientFetch).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/campaigns/mine' }),
        expect.objectContaining({
          details: expect.objectContaining({ ballotStatus: 'on-ballot' }),
        }),
      ),
    )
    await waitFor(() =>
      expect(mockClientFetch).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/campaigns/mine' }),
        expect.objectContaining({
          details: expect.objectContaining({ party: 'nonpartisan' }),
        }),
      ),
    )
  })
})
