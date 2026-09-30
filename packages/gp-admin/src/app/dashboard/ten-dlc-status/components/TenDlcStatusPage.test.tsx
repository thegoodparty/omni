import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  TenDlcStatusBucketKey,
  TenDlcStatusEntry,
  TenDlcStatusSnapshot,
} from '@goodparty_org/sdk'
import { TenDlcStatusPage } from './TenDlcStatusPage'

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver =
  ResizeObserverMock as unknown as typeof ResizeObserver

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

const mockCaptureException = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}))

const mockGetTenDlcStatusSnapshot = vi.fn()
vi.mock('../actions', () => ({
  getTenDlcStatusSnapshot: (...args: unknown[]) =>
    mockGetTenDlcStatusSnapshot(...args),
}))

const mockResendCvPin = vi.fn()
const mockOverrideCvValidationAndResubmit = vi.fn()
vi.mock('@/app/dashboard/campaigns/actions', () => ({
  resendCvPin: (...args: unknown[]) => mockResendCvPin(...args),
  overrideCvValidationAndResubmit: (...args: unknown[]) =>
    mockOverrideCvValidationAndResubmit(...args),
}))

const BUCKET_KEYS: TenDlcStatusBucketKey[] = [
  'stuckSubmission',
  'kickoffError',
  'rejected',
  'billingBlocked',
  'domainPurchaseIncomplete',
  'domainNotResolving',
  'cvInReviewStalled',
  'finalizeStalled',
  'dispatchDeferred',
  'awaitingPin',
  'cvUnissued',
]

const entry = (overrides: Partial<TenDlcStatusEntry>): TenDlcStatusEntry => ({
  campaignId: 1,
  campaignSlug: 'test-camp',
  userId: 11,
  committeeName: 'Friends of Test',
  peerlyIdentityId: null,
  filingUrl: null,
  since: new Date('2026-09-20T00:00:00Z').toISOString(),
  agenticRunId: null,
  runStatus: null,
  domainName: null,
  domainStatus: null,
  escalatedAt: null,
  peerlyCvStatus: null,
  cvValidationFailedAt: null,
  missingUser: false,
  ...overrides,
})

const snapshot = (
  populated: Partial<Record<TenDlcStatusBucketKey, TenDlcStatusEntry[]>> = {}
): TenDlcStatusSnapshot => ({
  generatedAt: new Date('2026-09-30T12:00:00Z').toISOString(),
  buckets: BUCKET_KEYS.map((key) => ({
    key,
    entries: populated[key] ?? [],
  })),
})

describe('TenDlcStatusPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHas.mockReturnValue(true)
    mockUseAuth.mockReturnValue({
      isSignedIn: true,
      orgId: 'org_123',
      has: mockHas,
    })
    mockGetTenDlcStatusSnapshot.mockResolvedValue(snapshot())
    mockResendCvPin.mockResolvedValue({ error: null })
    mockOverrideCvValidationAndResubmit.mockResolvedValue({
      retriedRunId: 'run-9',
      retryError: null,
    })
  })

  it('shows the all-clear state when every bucket is empty', async () => {
    render(<TenDlcStatusPage />)

    expect(await screen.findByText('No campaigns stuck')).toBeInTheDocument()
    expect(
      screen.getByText('Every registration is moving. Nothing to triage.')
    ).toBeInTheDocument()
  })

  it('counts red and amber buckets toward the stuck total, never nudges', async () => {
    mockGetTenDlcStatusSnapshot.mockResolvedValue(
      snapshot({
        rejected: [entry({ campaignId: 1, campaignSlug: 'rejected-camp' })],
        billingBlocked: [
          entry({ campaignId: 2, campaignSlug: 'billing-camp' }),
        ],
        // Amber (escalated to Peerly) counts as stuck, exactly like the
        // nightly report's header counts its escalation mirror sections.
        cvInReviewStalled: [
          entry({
            campaignId: 4,
            campaignSlug: 'escalated-camp',
            peerlyIdentityId: 'ident-4',
          }),
        ],
        // Nudge bucket — reported, never counted.
        awaitingPin: [entry({ campaignId: 3, campaignSlug: 'pin-camp' })],
      })
    )

    render(<TenDlcStatusPage />)

    expect(await screen.findByText('3 stuck')).toBeInTheDocument()
    expect(screen.getByText('rejected-camp')).toBeInTheDocument()
    expect(screen.getByText('escalated-camp')).toBeInTheDocument()
    expect(screen.getByText('pin-camp')).toBeInTheDocument()
  })

  it('surfaces a load failure instead of rendering an empty page', async () => {
    mockGetTenDlcStatusSnapshot.mockRejectedValue(new Error('api down'))

    render(<TenDlcStatusPage />)

    expect(await screen.findByText(/api down/)).toBeInTheDocument()
  })

  it('resends the CV PIN from an awaiting-PIN row and reports success', async () => {
    mockGetTenDlcStatusSnapshot.mockResolvedValue(
      snapshot({
        awaitingPin: [
          entry({
            campaignId: 42,
            campaignSlug: 'pin-camp',
            peerlyIdentityId: 'ident-42',
          }),
        ],
      })
    )

    render(<TenDlcStatusPage />)
    const button = await screen.findByRole('button', {
      name: 'Resend CV PIN',
    })
    await userEvent.click(button)

    await waitFor(() => expect(mockResendCvPin).toHaveBeenCalledWith(42))
    expect(mockShowToast).toHaveBeenCalledWith('CV PIN resent')
    expect(screen.getByRole('button', { name: 'PIN resent' })).toBeDisabled()
  })

  it('shows the API error when the resend fails', async () => {
    mockGetTenDlcStatusSnapshot.mockResolvedValue(
      snapshot({ awaitingPin: [entry({ campaignId: 42 })] })
    )
    mockResendCvPin.mockResolvedValue({ error: 'PIN already verified' })

    render(<TenDlcStatusPage />)
    await userEvent.click(
      await screen.findByRole('button', { name: 'Resend CV PIN' })
    )

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith('PIN already verified')
    )
  })

  it('offers override-and-resubmit only on held stuck submissions', async () => {
    mockGetTenDlcStatusSnapshot.mockResolvedValue(
      snapshot({
        stuckSubmission: [
          entry({
            campaignId: 7,
            campaignSlug: 'held-camp',
            cvValidationFailedAt: new Date(
              '2026-09-25T00:00:00Z'
            ).toISOString(),
          }),
          entry({ campaignId: 8, campaignSlug: 'plain-stuck-camp' }),
        ],
      })
    )

    render(<TenDlcStatusPage />)
    const buttons = await screen.findAllByRole('button', {
      name: 'Override hold & resubmit',
    })
    expect(buttons).toHaveLength(1)
    await userEvent.click(buttons[0])

    await waitFor(() =>
      expect(mockOverrideCvValidationAndResubmit).toHaveBeenCalledWith(7)
    )
    expect(mockShowToast).toHaveBeenCalledWith(
      'Hold cleared — registration resubmitted'
    )
  })

  it('renders each bucket-specific context column', async () => {
    mockGetTenDlcStatusSnapshot.mockResolvedValue(
      snapshot({
        stuckSubmission: [
          entry({
            campaignId: 1,
            campaignSlug: 'run-camp',
            agenticRunId: 'run-77',
            runStatus: 'FAILED',
          }),
        ],
        domainNotResolving: [
          entry({
            campaignId: 2,
            campaignSlug: 'held-domain-camp',
            domainName: 'vote-held.site',
            domainStatus: 'registered',
          }),
        ],
        cvInReviewStalled: [
          entry({
            campaignId: 3,
            campaignSlug: 'stall-camp',
            peerlyIdentityId: 'ident-3',
            escalatedAt: null,
          }),
        ],
        dispatchDeferred: [
          entry({
            campaignId: 4,
            campaignSlug: 'deferred-camp',
            missingUser: true,
          }),
        ],
        cvUnissued: [
          entry({
            campaignId: 5,
            campaignSlug: 'unissued-camp',
            peerlyIdentityId: 'ident-5',
            peerlyCvStatus: 'IN_REVIEW',
          }),
        ],
      })
    )

    render(<TenDlcStatusPage />)

    expect(await screen.findByText('run run-77 (FAILED)')).toBeInTheDocument()
    expect(screen.getByText('vote-held.site (registered)')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Radix unsuspension' })
    ).toHaveAttribute('href', 'https://abuse.radix.website/unsuspension')
    expect(screen.getByText(/ident-3 · escalation pending/)).toBeInTheDocument()
    expect(
      screen.getByText('missing user association (data repair)')
    ).toBeInTheDocument()
    expect(screen.getByText(/ident-5 · CV IN_REVIEW/)).toBeInTheDocument()
  })

  it('labels rejected rows with the recovery path the identity dictates', async () => {
    mockGetTenDlcStatusSnapshot.mockResolvedValue(
      snapshot({
        rejected: [
          entry({
            campaignId: 1,
            campaignSlug: 'with-identity',
            peerlyIdentityId: 'ident-1',
          }),
          entry({ campaignId: 2, campaignSlug: 'no-identity' }),
        ],
      })
    )

    render(<TenDlcStatusPage />)

    expect(
      await screen.findByText('identity minted — escalate to Peerly')
    ).toBeInTheDocument()
    expect(
      screen.getByText('no identity — repair data, then reset status')
    ).toBeInTheDocument()
  })
})
