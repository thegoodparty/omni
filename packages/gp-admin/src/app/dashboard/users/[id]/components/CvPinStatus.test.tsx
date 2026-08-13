import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComplianceStateOutput, User } from '@goodparty_org/sdk'
import { CvPinStatus } from './CvPinStatus'
import { UserProvider } from '../context/UserContext'

const mockHas = vi.fn()
const mockUseAuth = vi.fn()

vi.mock('@clerk/nextjs', () => ({
  useAuth: () => mockUseAuth(),
  ClerkLoading: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  ClerkLoaded: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const mockShowToast = vi.fn()
vi.mock('@/components/Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}))

const mockListCampaigns = vi.fn()
const mockGetCampaignComplianceState = vi.fn()
const mockResendCvPin = vi.fn()
const mockSetInternalTestingApproval = vi.fn()

vi.mock('@/app/dashboard/campaigns/actions', () => ({
  listCampaigns: (...args: unknown[]) => mockListCampaigns(...args),
  getCampaignComplianceState: (...args: unknown[]) =>
    mockGetCampaignComplianceState(...args),
  resendCvPin: (...args: unknown[]) => mockResendCvPin(...args),
  setInternalTestingApproval: (...args: unknown[]) =>
    mockSetInternalTestingApproval(...args),
}))

const mockUser: User = {
  id: 123,
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  hasPassword: true,
  createdAt: new Date('2024-01-01'),
  avatar: null,
  zip: null,
  phone: null,
}

const internalUser: User = {
  ...mockUser,
  email: 'staff@goodparty.org',
}

const awaitingPinState: ComplianceStateOutput = {
  stage: 'awaiting_pin',
  domain: null,
  websiteId: null,
  peerlyVerificationId: 'cv-1',
  peerlyCvStatus: 'APPROVED',
  pinDelivery: { method: 'email', displayString: 'j•••@example.com' },
  internalTestingApprovedAt: null,
  hasComplianceRecord: true,
}

function renderWidget(user: User = mockUser) {
  return render(
    <UserProvider user={user}>
      <CvPinStatus />
    </UserProvider>
  )
}

describe('CvPinStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHas.mockReturnValue(true)
    mockUseAuth.mockReturnValue({
      isSignedIn: true,
      orgId: 'org_123',
      has: mockHas,
    })
    mockListCampaigns.mockResolvedValue({
      data: [{ id: 7, isPro: true }],
      meta: { total: 1, offset: 0, limit: 10 },
    })
    mockGetCampaignComplianceState.mockResolvedValue(awaitingPinState)
    mockResendCvPin.mockResolvedValue(undefined)
  })

  it('renders nothing when the user has no pro campaign', async () => {
    mockListCampaigns.mockResolvedValue({
      data: [{ id: 7, isPro: false }],
      meta: { total: 1, offset: 0, limit: 10 },
    })

    const { container } = renderWidget()

    await waitFor(() => expect(mockListCampaigns).toHaveBeenCalledWith(123))
    expect(mockGetCampaignComplianceState).not.toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the compliance-state fetch fails', async () => {
    mockGetCampaignComplianceState.mockRejectedValue(new Error('boom'))

    const { container } = renderWidget()

    await waitFor(() =>
      expect(mockGetCampaignComplianceState).toHaveBeenCalledWith(7)
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the resend button and PIN delivery info while awaiting PIN entry', async () => {
    renderWidget()

    expect(
      await screen.findByRole('button', { name: /resend cv pin/i })
    ).toBeInTheDocument()
    expect(
      screen.getByText('PIN sent via email to j•••@example.com')
    ).toBeInTheDocument()
  })

  it('falls back to generic copy when no delivery info is available', async () => {
    mockGetCampaignComplianceState.mockResolvedValue({
      ...awaitingPinState,
      pinDelivery: null,
    })

    renderWidget()

    expect(
      await screen.findByText('PIN sent, not yet entered')
    ).toBeInTheDocument()
  })

  it('shows the exact 10DLC status instead of the button when the PIN is not outstanding', async () => {
    mockGetCampaignComplianceState.mockResolvedValue({
      ...awaitingPinState,
      stage: 'tcr_in_review',
      peerlyCvStatus: null,
      pinDelivery: null,
    })

    renderWidget()

    expect(
      await screen.findByText('10DLC: In carrier review')
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /resend cv pin/i })
    ).not.toBeInTheDocument()
  })

  it('shows the status badge when the CV has not issued a PIN yet', async () => {
    mockGetCampaignComplianceState.mockResolvedValue({
      ...awaitingPinState,
      peerlyCvStatus: 'IN_REVIEW',
      pinDelivery: null,
    })

    renderWidget()

    expect(await screen.findByText('10DLC: Awaiting PIN')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /resend cv pin/i })
    ).not.toBeInTheDocument()
  })

  it('resends the PIN for the pro campaign and confirms with a toast', async () => {
    const user = userEvent.setup()
    renderWidget()

    const button = await screen.findByRole('button', {
      name: /resend cv pin/i,
    })
    await user.click(button)

    await waitFor(() => expect(mockResendCvPin).toHaveBeenCalledWith(7))
    expect(mockShowToast).toHaveBeenCalledWith('CV PIN resent')
    expect(screen.getByRole('button', { name: /pin resent/i })).toBeDisabled()
  })

  it('surfaces a resend failure via toast and keeps the button enabled', async () => {
    mockResendCvPin.mockRejectedValue(new Error('Peerly is down'))
    const user = userEvent.setup()
    renderWidget()

    const button = await screen.findByRole('button', {
      name: /resend cv pin/i,
    })
    await user.click(button)

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith('Peerly is down')
    )
    expect(screen.getByRole('button', { name: /resend cv pin/i })).toBeEnabled()
  })

  it('hides everything without read_campaigns permission', async () => {
    mockHas.mockImplementation(
      ({ permission }: { permission: string }) =>
        permission !== 'org:admin_portal:read_campaigns'
    )

    const { container } = renderWidget()

    expect(container).toBeEmptyDOMElement()
    expect(mockListCampaigns).not.toHaveBeenCalled()
  })

  it('hides the resend button without write_campaigns permission', async () => {
    mockHas.mockImplementation(
      ({ permission }: { permission: string }) =>
        permission !== 'org:admin_portal:write_campaigns'
    )

    renderWidget()

    expect(
      await screen.findByText('PIN sent via email to j•••@example.com')
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /resend cv pin/i })
    ).not.toBeInTheDocument()
  })

  describe('internal testing approval toggle', () => {
    const noRecordState: ComplianceStateOutput = {
      ...awaitingPinState,
      stage: 'needs_filing',
      peerlyCvStatus: null,
      pinDelivery: null,
      hasComplianceRecord: false,
    }

    beforeEach(() => {
      mockGetCampaignComplianceState.mockResolvedValue(noRecordState)
      mockSetInternalTestingApproval.mockResolvedValue(undefined)
    })

    it('is hidden for non-internal emails', async () => {
      renderWidget()

      expect(
        await screen.findByText('10DLC: Filing details needed')
      ).toBeInTheDocument()
      expect(
        screen.queryByText('10DLC approved (internal testing)')
      ).not.toBeInTheDocument()
    })

    it('is hidden without write_campaigns permission', async () => {
      mockHas.mockImplementation(
        ({ permission }: { permission: string }) =>
          permission !== 'org:admin_portal:write_campaigns'
      )

      renderWidget(internalUser)

      expect(
        await screen.findByText('10DLC: Filing details needed')
      ).toBeInTheDocument()
      expect(
        screen.queryByText('10DLC approved (internal testing)')
      ).not.toBeInTheDocument()
    })

    it('grants approval, refetches, and confirms with a toast', async () => {
      const approvedState: ComplianceStateOutput = {
        ...noRecordState,
        stage: 'tcr_approved',
        internalTestingApprovedAt: '2026-07-24T00:00:00Z',
        hasComplianceRecord: true,
      }
      mockGetCampaignComplianceState
        .mockResolvedValueOnce(noRecordState)
        .mockResolvedValueOnce(approvedState)
      const user = userEvent.setup()
      renderWidget(internalUser)

      const checkbox = await screen.findByRole('checkbox')
      expect(checkbox).not.toBeChecked()
      await user.click(checkbox)

      await waitFor(() =>
        expect(mockSetInternalTestingApproval).toHaveBeenCalledWith(7, true)
      )
      expect(mockShowToast).toHaveBeenCalledWith(
        'Marked as 10DLC approved for internal testing'
      )
      expect(await screen.findByText('10DLC: Approved')).toBeInTheDocument()
      expect(screen.getByRole('checkbox')).toBeChecked()
    })

    it('revokes approval when unchecked', async () => {
      const approvedState: ComplianceStateOutput = {
        ...noRecordState,
        stage: 'tcr_approved',
        internalTestingApprovedAt: '2026-07-24T00:00:00Z',
        hasComplianceRecord: true,
      }
      mockGetCampaignComplianceState
        .mockResolvedValueOnce(approvedState)
        .mockResolvedValueOnce(noRecordState)
      const user = userEvent.setup()
      renderWidget(internalUser)

      const checkbox = await screen.findByRole('checkbox')
      expect(checkbox).toBeChecked()
      await user.click(checkbox)

      await waitFor(() =>
        expect(mockSetInternalTestingApproval).toHaveBeenCalledWith(7, false)
      )
      expect(mockShowToast).toHaveBeenCalledWith(
        'Internal testing approval removed'
      )
    })

    it('is disabled when the campaign has a real compliance record', async () => {
      mockGetCampaignComplianceState.mockResolvedValue({
        ...noRecordState,
        stage: 'tcr_in_review',
        hasComplianceRecord: true,
      })

      renderWidget(internalUser)

      expect(await screen.findByRole('checkbox')).toBeDisabled()
      expect(mockSetInternalTestingApproval).not.toHaveBeenCalled()
    })

    it('surfaces a grant failure via toast and stays unchecked', async () => {
      mockSetInternalTestingApproval.mockRejectedValue(
        new Error('Internal testing approval is limited to internal accounts')
      )
      const user = userEvent.setup()
      renderWidget(internalUser)

      const checkbox = await screen.findByRole('checkbox')
      await user.click(checkbox)

      await waitFor(() =>
        expect(mockShowToast).toHaveBeenCalledWith(
          'Internal testing approval is limited to internal accounts'
        )
      )
      expect(screen.getByRole('checkbox')).not.toBeChecked()
    })
  })
})
