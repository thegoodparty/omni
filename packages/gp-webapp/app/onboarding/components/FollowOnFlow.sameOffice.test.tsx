import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { clientFetch } from 'gpApi/clientFetch'
import { clientRequest } from 'gpApi/typed-request'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import FollowOnFlow from './FollowOnFlow'

// Module mocks (rather than MSW) so the legacy updateCampaign clientFetch
// calls can be asserted directly — mirrors FollowOnFlow.newOffice.test.tsx.
vi.mock('gpApi/clientFetch', () => ({ clientFetch: vi.fn() }))
vi.mock('gpApi/typed-request', () => ({ clientRequest: vi.fn() }))
vi.mock('helpers/useSnackbar', () => ({ useSnackbar: vi.fn() }))
// Keep EVENTS real; stub the network-bound tracker.
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

  vi.mocked(trackEvent).mockClear()
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

    // intent -> creates the campaign (office picker skipped) -> welcome
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

    // welcome -> ballot-status
    fireEvent.click(await screen.findByRole('button', { name: /continue/i }))
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

  it('tracks the intent step viewed on mount and completed on advance', async () => {
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <FollowOnFlow intent="same-office" fromOrganizationSlug="eo-1" />
      </QueryClientProvider>,
    )

    // The office-holder lands on the intent step; viewed fires once it renders.
    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.OnboardingV2.NewCampaignContextViewed,
      ),
    )

    // Advancing past intent commits the choice with the resolved intent.
    fireEvent.click(await screen.findByRole('button', { name: /continue/i }))
    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.OnboardingV2.NewCampaignContextCompleted,
        { intent: 'same-office' },
      ),
    )
  })

  it('fires the intent viewed and completed events once across back-navigation', async () => {
    // Held-office user who picks "new office": the campaign is not created on
    // leaving intent (that happens at the office step), so Back stays enabled
    // and the intent step is reachable a second time.
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <FollowOnFlow intent="new-office" />
      </QueryClientProvider>,
    )

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.OnboardingV2.NewCampaignContextViewed,
      ),
    )

    fireEvent.click(await screen.findByLabelText(/running for a new office/i))
    const continueButton = await screen.findByRole('button', {
      name: /continue/i,
    })
    await waitFor(() => expect(continueButton).toBeEnabled())
    // intent -> welcome (no creation on the new-office intent step).
    fireEvent.click(continueButton)
    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.OnboardingV2.NewCampaignContextCompleted,
        { intent: 'new-office' },
      ),
    )

    // Back to intent, then forward again — neither event should re-fire.
    fireEvent.click(await screen.findByRole('button', { name: /back/i }))
    fireEvent.click(await screen.findByRole('button', { name: /continue/i }))
    // Anchor on landing back on welcome (the intent radios are gone) so the
    // counts are read only after the second navigation has settled.
    await waitFor(() =>
      expect(
        screen.queryByLabelText(/running for a new office/i),
      ).not.toBeInTheDocument(),
    )

    const countOf = (name: string) =>
      vi.mocked(trackEvent).mock.calls.filter((call) => call[0] === name).length
    expect(countOf(EVENTS.OnboardingV2.NewCampaignContextViewed)).toBe(1)
    expect(countOf(EVENTS.OnboardingV2.NewCampaignContextCompleted)).toBe(1)
  })
})
