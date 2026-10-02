import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Theme } from '@radix-ui/themes'
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

// Radix Select needs the pointer-capture APIs jsdom lacks (same stubs as
// CampaignForm.test.tsx) or the dropdown never opens.
Element.prototype.hasPointerCapture = vi.fn(() => false)
Element.prototype.setPointerCapture = vi.fn()
Element.prototype.releasePointerCapture = vi.fn()
HTMLElement.prototype.scrollIntoView = vi.fn()

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
const mockUpdateFilingUrlAndResubmit = vi.fn()
vi.mock('@/app/dashboard/campaigns/actions', () => ({
  resendCvPin: (...args: unknown[]) => mockResendCvPin(...args),
  overrideCvValidationAndResubmit: (...args: unknown[]) =>
    mockOverrideCvValidationAndResubmit(...args),
  updateFilingUrlAndResubmit: (...args: unknown[]) =>
    mockUpdateFilingUrlAndResubmit(...args),
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
  assignedPa: null,
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

// Select.Content resolves theme tokens at render, so the page needs the
// Radix Theme context even in jsdom.
const renderPage = () =>
  render(
    <Theme>
      <TenDlcStatusPage />
    </Theme>
  )

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
    renderPage()

    expect(
      await screen.findByText(
        'Every registration is moving. Nothing to triage.'
      )
    ).toBeInTheDocument()
    const stuckTile = screen.getByRole('group', { name: 'Stuck now' })
    expect(within(stuckTile).getByText('0')).toBeInTheDocument()
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

    renderPage()

    expect(await screen.findByText('rejected-camp')).toBeInTheDocument()
    const stuckTile = screen.getByRole('group', { name: 'Stuck now' })
    expect(within(stuckTile).getByText('3')).toBeInTheDocument()
    expect(screen.getByText('escalated-camp')).toBeInTheDocument()
    expect(screen.getByText('pin-camp')).toBeInTheDocument()
  })

  it('filters to one bucket via its chart bar and clears on second click', async () => {
    mockGetTenDlcStatusSnapshot.mockResolvedValue(
      snapshot({
        rejected: [entry({ campaignId: 1, campaignSlug: 'rejected-camp' })],
        awaitingPin: [entry({ campaignId: 3, campaignSlug: 'pin-camp' })],
      })
    )

    renderPage()
    await screen.findByText('rejected-camp')

    const bar = screen.getByRole('button', {
      name: /Rejected by Peerly\/CampaignVerify/,
    })
    await userEvent.click(bar)

    expect(screen.getByText('rejected-camp')).toBeInTheDocument()
    expect(screen.queryByText('pin-camp')).not.toBeInTheDocument()
    expect(screen.getByText('Showing 1 of 2 registrations')).toBeInTheDocument()

    await userEvent.click(bar)
    expect(screen.getByText('pin-camp')).toBeInTheDocument()
  })

  it('narrows rows across buckets with the search box', async () => {
    mockGetTenDlcStatusSnapshot.mockResolvedValue(
      snapshot({
        rejected: [
          entry({
            campaignId: 1,
            campaignSlug: 'jane-doe-for-council',
            committeeName: 'Friends of Jane Doe',
          }),
          entry({ campaignId: 2, campaignSlug: 'other-camp' }),
        ],
        awaitingPin: [entry({ campaignId: 3, campaignSlug: 'pin-camp' })],
      })
    )

    renderPage()
    await screen.findByText('jane-doe-for-council')

    await userEvent.type(
      screen.getByPlaceholderText('Search candidate, campaign, or committee'),
      'jane doe'
    )

    // Committee-name match keeps the row; everything else filters out.
    expect(screen.getByText('jane-doe-for-council')).toBeInTheDocument()
    expect(screen.queryByText('other-camp')).not.toBeInTheDocument()
    expect(screen.queryByText('pin-camp')).not.toBeInTheDocument()
    expect(screen.getByText('Showing 1 of 3 registrations')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByText('other-camp')).toBeInTheDocument()
  })

  it('filters rows by assignee, including Unassigned, and clears', async () => {
    mockGetTenDlcStatusSnapshot.mockResolvedValue(
      snapshot({
        rejected: [
          entry({
            campaignId: 1,
            campaignSlug: 'janes-camp',
            assignedPa: 'Jane Smith',
          }),
          entry({
            campaignId: 2,
            campaignSlug: 'bobs-camp',
            assignedPa: 'Bob Ross',
          }),
        ],
        awaitingPin: [entry({ campaignId: 3, campaignSlug: 'orphan-camp' })],
      })
    )

    renderPage()
    await screen.findByText('janes-camp')

    await userEvent.click(
      screen.getByRole('combobox', { name: 'Assignee filter' })
    )
    await userEvent.click(
      await screen.findByRole('option', { name: 'Jane Smith' })
    )

    expect(screen.getByText('janes-camp')).toBeInTheDocument()
    expect(screen.queryByText('bobs-camp')).not.toBeInTheDocument()
    expect(screen.queryByText('orphan-camp')).not.toBeInTheDocument()
    expect(screen.getByText('Showing 1 of 3 registrations')).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('combobox', { name: 'Assignee filter' })
    )
    await userEvent.click(
      await screen.findByRole('option', { name: 'Unassigned' })
    )

    expect(screen.getByText('orphan-camp')).toBeInTheDocument()
    expect(screen.queryByText('janes-camp')).not.toBeInTheDocument()
    expect(screen.getByText('Showing 1 of 3 registrations')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByText('janes-camp')).toBeInTheDocument()
    expect(screen.getByText('bobs-camp')).toBeInTheDocument()
    expect(screen.getByText('orphan-camp')).toBeInTheDocument()
  })

  it('surfaces a load failure instead of rendering an empty page', async () => {
    mockGetTenDlcStatusSnapshot.mockRejectedValue(new Error('api down'))

    renderPage()

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

    renderPage()
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

    renderPage()
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

    renderPage()
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

  it('offers the filing-link edit only before a Peerly identity exists', async () => {
    mockGetTenDlcStatusSnapshot.mockResolvedValue(
      snapshot({
        stuckSubmission: [
          entry({
            campaignId: 7,
            campaignSlug: 'held-camp',
            filingUrl: 'https://sos.example.gov/old-filing',
            cvValidationFailedAt: new Date(
              '2026-09-25T00:00:00Z'
            ).toISOString(),
          }),
        ],
        // Identity already minted: CampaignVerify consumed the URL, so the
        // row keeps the view-only Filing link and no edit affordance.
        cvUnissued: [
          entry({
            campaignId: 9,
            campaignSlug: 'submitted-camp',
            peerlyIdentityId: 'ident-9',
            filingUrl: 'https://sos.example.gov/submitted-filing',
            peerlyCvStatus: 'IN_REVIEW',
          }),
        ],
      })
    )

    renderPage()
    expect(await screen.findAllByRole('link', { name: /Filing/ })).toHaveLength(
      2
    )
    expect(
      screen.getAllByRole('button', { name: 'Edit filing link' })
    ).toHaveLength(1)
  })

  it('edits the filing link from a row and goes dead after saving', async () => {
    mockUpdateFilingUrlAndResubmit.mockResolvedValue({
      error: null,
      retriedRunId: 'run-3',
      retryError: null,
    })
    mockGetTenDlcStatusSnapshot.mockResolvedValue(
      snapshot({
        stuckSubmission: [
          entry({
            campaignId: 7,
            campaignSlug: 'held-camp',
            filingUrl: 'https://sos.example.gov/old-filing',
            cvValidationFailedAt: new Date(
              '2026-09-25T00:00:00Z'
            ).toISOString(),
          }),
        ],
      })
    )

    renderPage()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Edit filing link' })
    )
    const input = screen.getByRole('textbox')
    await userEvent.clear(input)
    await userEvent.type(input, 'https://sos.example.gov/corrected-filing')
    await userEvent.click(
      screen.getByRole('button', { name: 'Save and resubmit' })
    )

    await waitFor(() =>
      expect(mockUpdateFilingUrlAndResubmit).toHaveBeenCalledWith(
        7,
        'https://sos.example.gov/corrected-filing'
      )
    )
    expect(mockShowToast).toHaveBeenCalledWith(
      'Filing link updated — registration resubmitted'
    )
    // The snapshot isn't refetched here, so the trigger must go dead — a
    // second save from the stale row would resubmit against the old URL.
    expect(
      screen.getByRole('button', { name: 'Filing updated' })
    ).toBeDisabled()
    expect(mockUpdateFilingUrlAndResubmit).toHaveBeenCalledTimes(1)
  })

  it('surfaces a filing-link rejection and keeps the dialog editable', async () => {
    mockUpdateFilingUrlAndResubmit.mockResolvedValue({
      error: 'Filing URL must be an official election-authority filing record',
      retriedRunId: null,
      retryError: null,
    })
    mockGetTenDlcStatusSnapshot.mockResolvedValue(
      snapshot({
        stuckSubmission: [
          entry({
            campaignId: 7,
            campaignSlug: 'held-camp',
            filingUrl: 'https://sos.example.gov/old-filing',
            cvValidationFailedAt: new Date(
              '2026-09-25T00:00:00Z'
            ).toISOString(),
          }),
        ],
      })
    )

    renderPage()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Edit filing link' })
    )
    const input = screen.getByRole('textbox')
    await userEvent.clear(input)
    await userEvent.type(input, 'https://goodparty.org/candidate/held')
    await userEvent.click(
      screen.getByRole('button', { name: 'Save and resubmit' })
    )

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        'Filing URL must be an official election-authority filing record'
      )
    )
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('renders a bucket-specific explanation row under each entry', async () => {
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

    renderPage()

    // No-hold stuck row: the explanation points at the agent run by link.
    const runLink = await screen.findByRole('link', { name: 'run run-77' })
    expect(runLink).toHaveAttribute('href', '/dashboard/agent-runs/run-77')
    expect(
      screen.getByText(/No CV hold — it stopped inside/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/vote-held\.site \(registered\) — no DNS delegation/)
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Radix unsuspension' })
    ).toHaveAttribute('href', 'https://abuse.radix.website/unsuspension')
    expect(
      screen.getByText(/ident-3 — CampaignVerify has been reviewing/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Escalation posts to the shared Peerly channel/)
    ).toBeInTheDocument()
    expect(
      screen.getByText('missing user association (data repair)')
    ).toBeInTheDocument()
    expect(
      screen.getByText(/ident-5 — CV IN_REVIEW: CampaignVerify/)
    ).toBeInTheDocument()
  })

  it('shows the assigned success person, or Unassigned when there is none', async () => {
    mockGetTenDlcStatusSnapshot.mockResolvedValue(
      snapshot({
        rejected: [
          entry({
            campaignId: 1,
            campaignSlug: 'owned-camp',
            assignedPa: 'Jane Smith',
          }),
          entry({
            campaignId: 2,
            campaignSlug: 'orphan-camp',
            assignedPa: null,
          }),
        ],
      })
    )

    renderPage()

    expect(await screen.findByText('Assigned to')).toBeInTheDocument()
    expect(screen.getByText('Jane Smith')).toBeInTheDocument()
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
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

    renderPage()

    expect(
      await screen.findByText(
        /ident-1 — CampaignVerify rejected after submission/
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Rejected before any Peerly identity existed/)
    ).toBeInTheDocument()
  })
})
