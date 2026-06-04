import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Theme } from '@radix-ui/themes'
import { EditCampaignClient } from './EditCampaignClient'
import type { Campaign } from '@goodparty_org/sdk'
import {
  CampaignLaunchStatus,
  OnboardingStep,
  BallotReadyPositionLevel,
  ElectionLevel,
} from '@goodparty_org/sdk'

const mockPush = vi.fn()
const mockShowToast = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

vi.mock('@/components/Toast', () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
}))

vi.mock('next-navigation-guard', () => ({
  useNavigationGuard: vi.fn(),
}))

class ResizeObserverMock {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
globalThis.ResizeObserver =
  ResizeObserverMock as unknown as typeof ResizeObserver

const mockUpdateCampaign = vi.fn()

vi.mock('@/app/dashboard/campaigns/actions', () => ({
  updateCampaign: (...args: unknown[]) => mockUpdateCampaign(...args),
}))

const mockCampaign: Campaign = {
  id: 42,
  createdAt: new Date('2023-04-02T05:51:59.450Z'),
  updatedAt: new Date('2026-01-29T03:50:12.433Z'),
  slug: 'test-campaign',
  userId: 100,
  isActive: true,
  isVerified: false,
  isPro: false,
  isDemo: false,
  didWin: false,
  dateVerified: null,
  tier: null,
  canDownloadFederal: false,
  completedTaskIds: [],
  hasFreeTextsOffer: false,
  aiContent: {},
  data: {
    name: 'My Campaign',
    launchStatus: CampaignLaunchStatus.launched,
    currentStep: OnboardingStep.complete,
  },
  details: {
    state: 'CA',
    office: 'Mayor',
    ballotLevel: BallotReadyPositionLevel.CITY,
    level: ElectionLevel.city,
  },
}

describe('EditCampaignClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the campaign form', () => {
    render(
      <Theme>
        <EditCampaignClient campaign={mockCampaign} />
      </Theme>
    )

    expect(screen.getByDisplayValue('My Campaign')).toBeInTheDocument()
    expect(screen.getByText('Campaign Status')).toBeInTheDocument()
  })

  it('navigates to campaign list on cancel', async () => {
    render(
      <Theme>
        <EditCampaignClient campaign={mockCampaign} />
      </Theme>
    )
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(mockPush).toHaveBeenCalledWith('/dashboard/users/100/campaign')
  })

  it('calls updateCampaign and shows success toast on save', async () => {
    mockUpdateCampaign.mockResolvedValue(mockCampaign)
    render(
      <Theme>
        <EditCampaignClient campaign={mockCampaign} />
      </Theme>
    )
    const user = userEvent.setup()

    // Make form dirty
    const nameInput = screen.getByDisplayValue('My Campaign')
    await user.clear(nameInput)
    await user.type(nameInput, 'Updated')

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /save changes/i })
      ).toBeEnabled()
    })

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(mockUpdateCampaign).toHaveBeenCalledWith(
        42,
        100,
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Updated' }),
        })
      )
    })

    expect(mockShowToast).toHaveBeenCalledWith('Campaign saved')
    expect(mockPush).toHaveBeenCalledWith('/dashboard/users/100/campaign')
  })

  it('shows error toast when save fails', async () => {
    mockUpdateCampaign.mockRejectedValue(new Error('Network error'))
    render(
      <Theme>
        <EditCampaignClient campaign={mockCampaign} />
      </Theme>
    )
    const user = userEvent.setup()

    const nameInput = screen.getByDisplayValue('My Campaign')
    await user.clear(nameInput)
    await user.type(nameInput, 'Updated')

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /save changes/i })
      ).toBeEnabled()
    })

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('Failed to save campaign')
    })

    // Should not navigate on failure
    expect(mockPush).not.toHaveBeenCalledWith('/dashboard/users/100/campaign')
  })
})
