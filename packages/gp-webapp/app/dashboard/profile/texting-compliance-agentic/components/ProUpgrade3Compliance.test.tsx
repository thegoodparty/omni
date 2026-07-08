import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  PeerlyCvVerificationStatus,
  type ComplianceStateOutput,
} from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import type { TcrCompliance, TcrComplianceStatus } from 'helpers/types'
import ProUpgrade3Compliance from './ProUpgrade3Compliance'

const mockGetTcrCompliance = vi.fn<() => Promise<TcrCompliance | null>>()
const mockGetComplianceState =
  vi.fn<() => Promise<ComplianceStateOutput | null>>()
vi.mock(
  'app/dashboard/profile/texting-compliance/util/tcrCompliance.util',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('app/dashboard/profile/texting-compliance/util/tcrCompliance.util')
      >()
    return {
      ...actual,
      getTcrCompliance: () => mockGetTcrCompliance(),
      getComplianceState: () => mockGetComplianceState(),
    }
  },
)

const stateWith = (
  peerlyCvStatus: ComplianceStateOutput['peerlyCvStatus'],
  pinDelivery: ComplianceStateOutput['pinDelivery'] = null,
): ComplianceStateOutput => ({
  stage: 'awaiting_pin',
  domain: null,
  websiteId: null,
  peerlyVerificationId: 'cv-1',
  peerlyCvStatus,
  pinDelivery,
})

const mockSuccessSnackbar = vi.fn()
const mockErrorSnackbar = vi.fn()
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    successSnackbar: mockSuccessSnackbar,
    errorSnackbar: mockErrorSnackbar,
  }),
}))

const mockUseUser = vi.fn(() => [{ email: 'jane@example.com' }, vi.fn(), false])
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => mockUseUser(),
}))

const baseTcrCompliance: TcrCompliance = {
  id: 'tcr-1',
  ein: '12-3456789',
  postalAddress: '123 Main St',
  committeeName: 'Jane for Council',
  websiteDomain: 'janeforcouncil.org',
  filingUrl: 'https://example.com/filing',
  phone: '5551234567',
  email: 'jane@example.com',
  status: 'submitted',
  createdAt: new Date(),
  updatedAt: new Date(),
  campaignId: 1,
}

const tcrWith = (status: TcrComplianceStatus | null): TcrCompliance => ({
  ...baseTcrCompliance,
  status,
})

// InputOTP renders a single accessible input (not one per digit), so the PIN
// entry is present iff that input is in the document.
const getPinInput = (): HTMLInputElement | null =>
  screen.queryByRole('textbox', { name: 'PIN' }) as HTMLInputElement | null

beforeEach(() => {
  mockGetTcrCompliance.mockReset()
  mockGetComplianceState.mockReset()
  // Default to a PIN-issued CV so the `submitted` → PIN-entry surface renders;
  // gating tests override this per-case.
  mockGetComplianceState.mockResolvedValue(
    stateWith(PeerlyCvVerificationStatus.APPROVED),
  )
  mockSuccessSnackbar.mockReset()
  mockErrorSnackbar.mockReset()
})

// The PIN form uses input-otp, whose selection-sync effect schedules
// setTimeout(…, 0/10/50ms) on mount and on every value change but never clears
// them on unmount. Under the full parallel suite a fast test can finish and
// tear down jsdom before the 50ms timer fires, so its setState runs against a
// gone `window` — surfacing as an unhandled "window is not defined" that fails
// the whole run. Drain them here (a >50ms macrotask is dequeued after the
// already-scheduled input-otp timers) while the window still exists.
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 60))
})

describe('ProUpgrade3Compliance — status → state mapping', () => {
  it('renders the PIN entry form when status is `submitted` and CV is APPROVED', async () => {
    mockGetTcrCompliance.mockResolvedValue(tcrWith('submitted'))
    mockGetComplianceState.mockResolvedValue(
      stateWith(PeerlyCvVerificationStatus.APPROVED),
    )
    render(<ProUpgrade3Compliance />)

    await waitFor(() => {
      expect(getPinInput()).not.toBeNull()
    })
    expect(screen.getByText('Enter your PIN')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument()
  })

  it('shows the real delivery channel + masked destination when Peerly reports it', async () => {
    mockGetTcrCompliance.mockResolvedValue(tcrWith('submitted'))
    mockGetComplianceState.mockResolvedValue(
      stateWith(PeerlyCvVerificationStatus.APPROVED, {
        method: 'text',
        destination: '3126851162',
      }),
    )
    render(<ProUpgrade3Compliance />)

    await waitFor(() => expect(getPinInput()).not.toBeNull())
    expect(
      screen.getByText('We sent your PIN by text to (312) •••-1162.'),
    ).toBeInTheDocument()
  })

  it('falls back to the generic PIN instructions when no delivery is reported', async () => {
    mockGetTcrCompliance.mockResolvedValue(tcrWith('submitted'))
    mockGetComplianceState.mockResolvedValue(
      stateWith(PeerlyCvVerificationStatus.APPROVED, null),
    )
    render(<ProUpgrade3Compliance />)

    await waitFor(() => expect(getPinInput()).not.toBeNull())
    expect(
      screen.getByText(/You will be sent a PIN within 7 business days/i),
    ).toBeInTheDocument()
  })

  it('renders the PIN entry form when CV is VERIFIED (PIN already entered)', async () => {
    mockGetTcrCompliance.mockResolvedValue(tcrWith('submitted'))
    mockGetComplianceState.mockResolvedValue(
      stateWith(PeerlyCvVerificationStatus.VERIFIED),
    )
    render(<ProUpgrade3Compliance />)

    await waitFor(() => {
      expect(getPinInput()).not.toBeNull()
    })
  })

  it.each<[ComplianceStateOutput['peerlyCvStatus']]>([
    [PeerlyCvVerificationStatus.REQUESTED],
    [PeerlyCvVerificationStatus.IN_REVIEW],
    [null],
  ])(
    'hides the PIN box for a `submitted` record whose CV is %s (no PIN sent yet)',
    async (cvStatus) => {
      mockGetTcrCompliance.mockResolvedValue(tcrWith('submitted'))
      mockGetComplianceState.mockResolvedValue(stateWith(cvStatus))
      render(<ProUpgrade3Compliance />)

      await waitFor(() => {
        expect(
          screen.getByText('Your registration is being verified'),
        ).toBeInTheDocument()
      })
      expect(getPinInput()).toBeNull()
      expect(screen.queryByRole('button', { name: /submit/i })).toBeNull()
    },
  )

  it('holds the loading shell (never flashes the PIN box) while CV status loads', () => {
    mockGetTcrCompliance.mockResolvedValue(tcrWith('submitted'))
    mockGetComplianceState.mockReturnValue(
      new Promise(() => {
        /* never resolves */
      }),
    )
    const { container } = render(<ProUpgrade3Compliance />)

    expect(getPinInput()).toBeNull()
    // Once the TCR query settles the component must not show the PIN box until
    // the CV status resolves; assert the shell is what shows in the meantime.
    return waitFor(() => {
      expect(container.querySelector('.animate-pulse')).not.toBeNull()
    }).then(() => {
      expect(getPinInput()).toBeNull()
    })
  })

  it('renders the in-review state when status is `pending`', async () => {
    mockGetTcrCompliance.mockResolvedValue(tcrWith('pending'))
    render(<ProUpgrade3Compliance />)

    await waitFor(() => {
      expect(
        screen.getByText('Your candidate profile is being reviewed'),
      ).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /submit/i })).toBeNull()
  })

  it('renders the approved state when status is `approved`', async () => {
    mockGetTcrCompliance.mockResolvedValue(tcrWith('approved'))
    render(<ProUpgrade3Compliance />)

    await waitFor(() => {
      expect(
        screen.getByText('Your profile has been approved!'),
      ).toBeInTheDocument()
    })
  })

  it('renders the denied state when status is `rejected`', async () => {
    mockGetTcrCompliance.mockResolvedValue(tcrWith('rejected'))
    render(<ProUpgrade3Compliance />)

    await waitFor(() => {
      expect(
        screen.getByText('Your profile needs updates before sending texts'),
      ).toBeInTheDocument()
    })
    // Gives the candidate the concrete next step from the Figma annotation.
    const supportLink = screen.getByRole('link', {
      name: 'campaignsuccess@goodparty.org',
    })
    expect(supportLink).toHaveAttribute(
      'href',
      'mailto:campaignsuccess@goodparty.org',
    )
  })

  it.each<[TcrComplianceStatus | null]>([['error'], [null]])(
    'offers the election-filing CTA for status %s (no usable record yet)',
    async (status) => {
      mockGetTcrCompliance.mockResolvedValue(
        status === null ? null : tcrWith(status),
      )
      render(<ProUpgrade3Compliance />)

      // A candidate with no usable record gets an actionable entry into the
      // agentic flow, not a dead-end placeholder (ENG-10473). The CTA must
      // point at election-filing, which calls createAgentic.
      const cta = await screen.findByRole('link', { name: 'Get started' })
      expect(cta).toHaveAttribute(
        'href',
        '/dashboard/profile/texting-compliance/election-filing',
      )
      expect(screen.getByText('Set up texting compliance')).toBeInTheDocument()
      expect(getPinInput()).toBeNull()
      expect(
        screen.queryByText('Your profile needs updates before sending texts'),
      ).toBeNull()
    },
  )

  it('shows the loading skeleton (not the CTA) while the TCR query is pending', () => {
    // Never-resolving query keeps the component in the isPending branch.
    mockGetTcrCompliance.mockReturnValue(
      new Promise(() => {
        /* never resolves */
      }),
    )
    const { container } = render(<ProUpgrade3Compliance />)

    // The skeleton shows animated placeholders, not the start-state CTA.
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
    expect(screen.queryByRole('link', { name: 'Get started' })).toBeNull()
    expect(getPinInput()).toBeNull()
  })
})

describe('ProUpgrade3Compliance — PIN submit', () => {
  it('submits the PIN via the existing submit-cv-pin endpoint and transitions to in-review', async () => {
    const user = userEvent.setup()
    // First fetch: mount with `submitted` → PIN form. Every fetch after the
    // post-submit invalidateQueries returns `pending`, so the test verifies the
    // card actually transitions off PIN entry (not just that the snackbar fired).
    mockGetTcrCompliance.mockResolvedValueOnce(tcrWith('submitted'))
    mockGetTcrCompliance.mockResolvedValue(tcrWith('pending'))

    let receivedBody: { pin?: string } = {}
    api.mock(
      'POST /v1/campaigns/tcr-compliance/:tcrComplianceId/submit-cv-pin',
      ({ body, params }) => {
        receivedBody = body
        expect(params.tcrComplianceId).toBe('tcr-1')
        return { status: 200, data: undefined }
      },
    )

    render(<ProUpgrade3Compliance />)
    await waitFor(() => expect(getPinInput()).not.toBeNull())

    await user.type(getPinInput()!, '123456')
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(mockSuccessSnackbar).toHaveBeenCalledWith(
        expect.stringMatching(/PIN submitted/i),
      )
    })
    expect(receivedBody).toEqual({ pin: '123456' })
    expect(mockErrorSnackbar).not.toHaveBeenCalled()

    // The invalidated query refetches `pending`, so the card must leave PIN
    // entry for the in-review state — this fails if invalidateQueries is dropped.
    await waitFor(() => {
      expect(
        screen.getByText('Your candidate profile is being reviewed'),
      ).toBeInTheDocument()
    })
    expect(getPinInput()).toBeNull()
  })

  it('clears and re-enables the PIN form after success when the status has not yet left `submitted`', async () => {
    const user = userEvent.setup()
    // Every fetch — including the post-submit refetch — returns `submitted`, the
    // race where the backend hasn't transitioned yet. The card stays mounted, so
    // the form must reset (no stale PIN left on screen) and re-enable.
    mockGetTcrCompliance.mockResolvedValue(tcrWith('submitted'))

    api.mock(
      'POST /v1/campaigns/tcr-compliance/:tcrComplianceId/submit-cv-pin',
      { status: 200, data: undefined },
    )

    render(<ProUpgrade3Compliance />)
    await waitFor(() => expect(getPinInput()).not.toBeNull())

    await user.type(getPinInput()!, '123456')
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(mockSuccessSnackbar).toHaveBeenCalledWith(
        expect.stringMatching(/PIN submitted/i),
      )
    })

    // Input reset: empty (no submitted PIN lingering) and editable rather than
    // frozen disabled in a loading state.
    await waitFor(() => {
      const refreshed = getPinInput()
      expect(refreshed).not.toBeNull()
      expect(refreshed!.value).toBe('')
    })
    expect(getPinInput()).toBeEnabled()
  })

  it('surfaces a mismatch error on a 400 without claiming success', async () => {
    const user = userEvent.setup()
    mockGetTcrCompliance.mockResolvedValue(tcrWith('submitted'))

    api.mock(
      'POST /v1/campaigns/tcr-compliance/:tcrComplianceId/submit-cv-pin',
      { status: 400, data: { message: 'invalid PIN' } },
    )

    render(<ProUpgrade3Compliance />)
    await waitFor(() => expect(getPinInput()).not.toBeNull())

    await user.type(getPinInput()!, '123456')
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /that PIN didn’t match/i,
      )
    })
    expect(mockSuccessSnackbar).not.toHaveBeenCalled()
    // Form re-enabled so the candidate can retry.
    expect(screen.getByRole('button', { name: /submit/i })).toBeEnabled()
  })

  it('rejects non-digit characters so a non-numeric PIN can never be submitted', async () => {
    const user = userEvent.setup()
    mockGetTcrCompliance.mockResolvedValue(tcrWith('submitted'))

    render(<ProUpgrade3Compliance />)
    await waitFor(() => expect(getPinInput()).not.toBeNull())

    await user.type(getPinInput()!, 'abcdef')

    // The digit-only pattern drops the input, so nothing accumulates and Submit
    // stays disabled — the API never receives a non-numeric PIN.
    expect(getPinInput()!.value).toBe('')
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled()
  })
})
